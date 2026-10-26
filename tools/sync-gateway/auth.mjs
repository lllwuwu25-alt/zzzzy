import { createHmac, randomUUID } from "node:crypto";
import { randomSecret, hashSecret, equalSecret, seal, open, gatewayError } from "./crypto.mjs";
import { DeviceBindings } from "./bindings.mjs";
const fail = (code, message, status = 400) => {
    throw gatewayError(code, message, status);
};
export class GatewayAuth {
    constructor(config, db, oauth, providerFactory, now = Date.now) {
        this.config = config;
        this.db = db;
        this.oauth = oauth;
        this.providerFactory = providerFactory;
        this.now = now;
        this.refreshLocks = new Map();
        this.bindings = new DeviceBindings(config, db, now);
    }
    start(input = {}) {
        if (!["native", "web"].includes(input.client))
            fail("INVALID_REQUEST", "请选择有效的客户端类型。");
        if (input.redirectUri || input.returnUrl)
            fail("INVALID_REQUEST", "客户端不可指定授权回调。");
        this.db.transaction(() => {
            for (const namespace of ["oauth_attempts", "sessions", "bindings"]) {
                for (const record of this.db.list(namespace)) {
                    if (record.expiresAt <= this.now()) this.db.remove(namespace, record.id);
                }
            }
        });
        const state = randomSecret(), pollToken = randomSecret(), id = randomUUID();
        const binding = input.binding ? this.bindings.validateIntent(input.binding.bindingId, input.binding.token) : null;
        const proofHash = input.deviceProof ? hashSecret(input.deviceProof) : null;
        const a = {
            id,
            stateHash: hashSecret(state),
            pollHash: hashSecret(pollToken),
            client: input.client,
            origin: input.origin,
            deviceName: String(input.deviceName ?? "我的设备").slice(0, 80),
            deviceType: ["desktop", "mobile"].includes(input.deviceType) ? input.deviceType : "desktop",
            proofHash,
            bindingId: binding?.id,
            bindingTokenHash: binding?.tokenHash,
            status: "pending",
            createdAt: this.now(),
            expiresAt: this.now() + 600000
        };
        this.db.put("oauth_attempts", id, a);
        const u = new URL("https://accounts.feishu.cn/open-apis/authen/v1/authorize");
        u.searchParams.set("client_id", this.config.feishuAppId);
        u.searchParams.set("redirect_uri", this.config.feishuRedirectUri);
        u.searchParams.set("response_type", "code");
        u.searchParams.set("scope", this.config.feishuScopes.join(" "));
        u.searchParams.set("state", state);
        return {
            attemptId: id,
            pollToken,
            authorizationUrl: u.href,
            expiresAt: a.expiresAt
        };
    }
    recover(session, input = {}) {
        if (input.confirm !== true) {
            fail("RECOVERY_CONFIRMATION_REQUIRED", "恢复将撤销全部旧设备和会话，并保留本地与云端题库。请确认后继续。");
        }
        const account = this.db.get("accounts", session.accountId);
        const device = this.db.get("devices", session.deviceId);
        const library = this.db.get("libraries", session.accountId);
        if (!account || !device || device.accountId !== account.id || device.status === "revoked") {
            fail("DEVICE_REVOKED", "此设备已被撤销，请重新登录。", 403);
        }
        if (!library || library.accountId !== account.id || library.state !== "ready") {
            fail("BOOTSTRAP_INCOMPLETE", "原题库不可核实；请联系部署人员恢复映射，不会创建空题库。", 409);
        }
        const attempt = this.start({
            client: session.client,
            deviceName: device.name,
            deviceType: device.type,
            origin: input.origin
        });
        const authorizationUrl = new URL(attempt.authorizationUrl);
        authorizationUrl.searchParams.set("prompt", "consent");
        attempt.authorizationUrl = authorizationUrl.href;
        const record = this.db.get("oauth_attempts", attempt.attemptId);
        this.db.put("oauth_attempts", record.id, {
            ...record,
            purpose: "recover",
            recoverySessionId: session.id,
            recoveryAccountId: account.id,
            recoveryDeviceId: device.id,
            recoveryIdentityKey: account.identityKey,
            recoveryLibraryId: library.id,
            recoveryGeneration: account.recoveryGeneration ?? 0,
        });
        return attempt;
    }
    async completeRecovery(attempt, identityKey, tokens) {
        const account = this.db.get("accounts", attempt.recoveryAccountId);
        const library = this.db.get("libraries", attempt.recoveryAccountId);
        if (!account || identityKey !== attempt.recoveryIdentityKey || account.identityKey !== identityKey) {
            fail("RECOVERY_IDENTITY_MISMATCH", "请重新授权同一飞书身份；未更改任何旧设备权限。", 403);
        }
        if (!library || library.id !== attempt.recoveryLibraryId || library.accountId !== account.id || library.state !== "ready") {
            fail("LIBRARY_ACCESS_DENIED", "无法核实原题库，不会创建空题库。", 403);
        }
        // Management must be proven with the NEW user credential from this
        // OAuth round trip; read access or a previous product session is not proof.
        const provider = await this.providerFactory(tokens.accessToken, account);
        if (typeof provider.checkManagement !== "function") {
            fail("RECOVERY_NOT_IMPLEMENTED", "当前接入无法核实原题库管理权限，已停止自助恢复。", 501);
        }
        if (await provider.checkManagement(library) !== true) {
            fail("LIBRARY_ACCESS_DENIED", "当前飞书身份未证明原题库的管理权限，已停止恢复。", 403);
        }
        // Activation, old-authority revocation and token replacement commit together.
        this.db.transaction(() => {
            const current = this.db.get("accounts", account.id);
            const device = this.db.get("devices", attempt.recoveryDeviceId);
            const currentLibrary = this.db.get("libraries", account.id);
            const originSession = this.db.get("sessions", attempt.recoverySessionId);
            const currentAttempt = this.db.get("oauth_attempts", attempt.id);
            if (!current || current.identityKey !== identityKey || (current.recoveryGeneration ?? 0) !== attempt.recoveryGeneration || currentAttempt?.status !== "processing" || !originSession || originSession.revoked || originSession.expiresAt <= this.now() || originSession.accountId !== account.id || originSession.deviceId !== device?.id || !device || device.accountId !== account.id || device.status === "revoked" || currentLibrary?.id !== library.id || currentLibrary?.state !== "ready") {
                fail("RECOVERY_INVALID", "恢复请求已失效；请从当前设备重新开始。", 409);
            }
            for (const old of this.db.list("devices").filter(value => value.accountId === account.id)) {
                this.db.put("devices", old.id, {
                    ...old,
                    status: old.id === device.id ? "active" : "revoked",
                    proofHash: null,
                    ...(old.id === device.id ? {
                        activatedAt: this.now()
                    } : {
                        revokedAt: this.now()
                    }),
                });
            }
            for (const old of this.db.list("sessions").filter(value => value.accountId === account.id))
                this.db.remove("sessions", old.id);
            for (const old of this.db.list("bindings").filter(value => value.accountId === account.id))
                this.db.put("bindings", old.id, {
                    ...old,
                    status: "cancelled"
                });
            for (const old of this.db.list("oauth_attempts").filter(value => value.id !== attempt.id && value.recoveryAccountId === account.id)) {
                this.db.put("oauth_attempts", old.id, {
                    ...old,
                    stateHash: null,
                    status: "failed",
                    errorCode: "RECOVERY_INVALID"
                });
            }
            this.db.put("accounts", account.id, {
                ...current,
                connectionStatus: "connected",
                recoveryGeneration: attempt.recoveryGeneration + 1
            });
            this.storeTokens(account.id, tokens);
            this.db.put("oauth_attempts", attempt.id, {
                ...attempt,
                stateHash: null,
                proofHash: null,
                status: "complete",
                accountId: account.id,
                deviceId: device.id
            });
            const eventId = randomUUID();
            this.db.put("security_events", eventId, {
                id: eventId,
                kind: "account_access_recovered",
                accountId: account.id,
                deviceId: device.id,
                at: this.now()
            });
        });
    }
    async callback({ state, code, error }) {
        const a = this.db.list("oauth_attempts").find(x => equalSecret(x.stateHash, hashSecret(state)));
        if (!a || a.status !== "pending" || a.expiresAt <= this.now())
            fail("OAUTH_STATE_INVALID", "授权已过期或已使用，请重新连接。");
        this.db.put("oauth_attempts", a.id, {
            ...a,
            status: "processing",
            stateHash: null
        });
        try {
            if (error || !code)
                fail("OAUTH_DENIED", "飞书授权已取消或未获批准。");
            const tokens = await this.oauth.exchange(code);
            const identity = await this.oauth.identity(tokens.accessToken);
            if (!identity.openId || !identity.tenantKey)
                fail("IDENTITY_INVALID", "飞书未返回完整的身份标识。");
            if (!this.config.allowedTenantKeys.includes(identity.tenantKey))
                fail("TENANT_NOT_ALLOWED", "当前飞书组织不在获准的测试范围内。", 403);
            const identityKey = hashSecret(JSON.stringify(["feishu", this.config.feishuAppId, identity.tenantKey, identity.openId]));
            if (a.purpose === "recover") {
                await this.completeRecovery(a, identityKey, tokens);
                return {
                    client: a.client
                };
            }
            this.db.transaction(() => {
                const mapping = this.db.get("identities", identityKey);
                let account = mapping && this.db.get("accounts", mapping.accountId);
                if (mapping && !account) {
                    fail("ACCOUNT_STATE_INVALID", "账号持久化状态不完整，请由部署人员从备份核对恢复。", 503);
                }
                // First admission is committed only with the first successful exchange.
                // A callback abandoned before a client receives credentials must not strand onboarding.
                if (!account) {
                    account = {
                        id: randomUUID(),
                        name: identity.name ?? "飞书用户",
                        tenantKey: identity.tenantKey,
                        identityKey,
                        createdAt: this.now(),
                        firstDeviceAdmitted: false,
                        connectionStatus: "connected"
                    };
                    this.db.put("identities", identityKey, {
                        id: identityKey,
                        accountId: account.id
                    });
                }
                else
                    account = {
                        ...account,
                        name: identity.name ?? account.name,
                        connectionStatus: "connected"
                    };
                account.feishu = {
                    provider: "feishu",
                    appId: this.config.feishuAppId,
                    tenantKey: identity.tenantKey,
                    openId: identity.openId,
                };
                let device = a.proofHash ? this.db.list("devices").find(x => x.accountId === account.id && x.status === "active" && equalSecret(x.proofHash, a.proofHash)) : null;
                if (!device)
                    device = {
                        id: randomUUID(),
                        accountId: account.id,
                        name: a.deviceName,
                        type: a.deviceType,
                        status: "pending_device",
                        createdAt: this.now(),
                        lastSeenAt: this.now()
                    };
                this.db.put("accounts", account.id, account);
                this.db.put("devices", device.id, device);
                this.storeTokens(account.id, tokens);
                if (a.bindingId) {
                    const b = this.db.get("bindings", a.bindingId);
                    if (!b || b.accountId !== account.id)
                        fail("BINDING_IDENTITY_MISMATCH", "请使用同一飞书身份。", 403);
                    if (b.expiresAt <= this.now() || b.tokenHash !== a.bindingTokenHash || b.status !== "created" || this.db.get("devices", b.initiatorDeviceId)?.status !== "active" || device.status !== "pending_device")
                        fail("BINDING_INVALID", "绑定已失效，请重新生成二维码。", 403);
                    this.db.put("bindings", b.id, {
                        ...b,
                        status: "claimed",
                        pendingDeviceId: device.id
                    });
                }
                this.db.put("oauth_attempts", a.id, {
                    ...a,
                    stateHash: null,
                    proofHash: null,
                    status: "complete",
                    accountId: account.id,
                    deviceId: device.id,
                    authenticatedAt: this.now()
                });
            });
            return {
                client: a.client
            };
        }
        catch (e) {
            this.db.put("oauth_attempts", a.id, {
                ...a,
                stateHash: null,
                proofHash: null,
                status: "failed",
                errorCode: e.code ?? "OAUTH_FAILED"
            });
            throw e;
        }
    }
    storeTokens(accountId, tokens) {
        if (!tokens.accessToken || !Number.isFinite(tokens.expiresIn) || tokens.expiresIn <= 0)
            fail("TOKEN_INVALID", "飞书返回了无效授权。", 502);
        this.db.put("tokens", accountId, {
            id: accountId,
            version: randomUUID(),
            encrypted: seal({
                ...tokens,
                expiresAt: this.now() + tokens.expiresIn * 1000,
                refreshExpiresAt: tokens.refreshExpiresIn ? this.now() + tokens.refreshExpiresIn * 1000 : null
            }, this.config.encryptionKey, `${this.config.environment}:${accountId}`)
        });
    }
    exchange({ attemptId, pollToken }, client, origin) {
        const a = this.db.get("oauth_attempts", attemptId);
        if (!a || !equalSecret(a.pollHash, hashSecret(pollToken)) || a.expiresAt <= this.now() || client && a.client !== client || a.origin && a.origin !== origin)
            fail("EXCHANGE_INVALID", "授权交换凭证无效或已过期。", 403);
        if (a.status === "consumed")
            fail("EXCHANGE_CONSUMED", "授权结果已使用，请重新连接。", 409);
        if (a.status === "failed")
            fail(a.errorCode, "授权未完成，请重新连接。", 403);
        if (a.status !== "complete")
            return {
                status: "pending"
            };
        return this.db.transaction(() => {
            const token = randomSecret(), proof = randomSecret();
            const session = {
                id: hashSecret(token),
                accountId: a.accountId,
                deviceId: a.deviceId,
                client: a.client,
                createdAt: this.now(),
                expiresAt: this.now() + this.config.sessionTtlSeconds * 1000
            };
            let device = this.db.get("devices", a.deviceId);
            if (!device || device.status === "revoked")
                fail("DEVICE_REVOKED", "此设备已被撤销。", 403);
            const account = this.db.get('accounts', a.accountId);
            if (!account || device.accountId !== account.id) fail('ACCOUNT_STATE_INVALID', '账号状态不完整，请从备份核对。', 503);
            if (account.firstDeviceAdmitted === false && device.type === 'desktop') {
                if (this.db.list('devices').some(value => value.accountId === account.id && value.status === 'active')) fail('ACCOUNT_STATE_INVALID', '首台设备记录不一致，请核对恢复。', 503);
                device = { ...device, status: 'active', activatedAt: this.now() };
                this.db.put('accounts', account.id, { ...account, firstDeviceAdmitted: true });
            }
            this.db.put("sessions", session.id, session);
            this.db.put("devices", device.id, {
                ...device,
                proofHash: hashSecret(proof),
                lastSeenAt: this.now()
            });
            this.db.put("oauth_attempts", a.id, {
                id: a.id,
                pollHash: a.pollHash,
                status: "consumed",
                expiresAt: a.expiresAt
            });
            const authenticated = this.authenticate(token);
            return {
                status: "complete",
                sessionToken: token,
                deviceProof: proof,
                csrfToken: this.csrf(authenticated),
                session: this.me(authenticated),
                client: a.client
            };
        });
    }
    authenticate(token) {
        if (!token)
            fail("AUTH_REQUIRED", "请先连接飞书。", 401);
        const session = this.db.get("sessions", hashSecret(token));
        if (session?.revoked)
            fail("DEVICE_REVOKED", "此设备已被撤销。", 403);
        if (!session || session.expiresAt <= this.now())
            fail("AUTH_REQUIRED", "会话已过期，请重新连接。", 401);
        const device = this.db.get("devices", session.deviceId);
        if (!device || device.accountId !== session.accountId || device.status === "revoked")
            fail("DEVICE_REVOKED", "此设备已被撤销。", 403);
        if (this.now() - device.lastSeenAt >= 10000) {
            this.db.put("devices", device.id, {...device,lastSeenAt:this.now()});
        }
        return {
            ...session,
            status: device.status
        };
    }
    csrf(session) {
        return createHmac("sha256", this.config.signingKey).update(`${this.config.environment}:${session.id}`).digest("base64url");
    }
    requireActive(session) {
        if (session.status !== "active")
            fail("DEVICE_PENDING", "请先由已有设备确认加入。", 403);
    }
    me(session) {
        const account = this.db.get("accounts", session.accountId), device = this.db.get("devices", session.deviceId), library = session.status === "active" ? this.db.get("libraries", session.accountId) : null;
        return {
            environment: this.config.environment,
            account: {
                id: account.id,
                name: account.name,
                tenantKey: account.tenantKey
            },
            device: {
                id: device.id,
                status: device.status,
                name: device.name,
                type: device.type
            },
            connection: {
                status: account.connectionStatus
            },
            csrfToken: this.csrf(session),
            ...(library ? {
                library: {
                    id: library.id,
                    name: library.name,
                    url: library.url,
                    epoch: library.epoch,
                    state: library.state
                }
            } : {})
        };
    }
    devices(session) {
        this.requireActive(session);
        return this.db.list("devices").filter(x => x.accountId === session.accountId).map(x => ({
            id: x.id,
            name: x.name,
            type: x.type,
            status: x.status,
            createdAt: x.createdAt,
            lastSeenAt: x.lastSeenAt,
            current: x.id === session.deviceId
        }));
    }
    rename(session, id, name) {
        this.requireActive(session);
        const device = this.db.get("devices", id);
        if (device?.accountId !== session.accountId)
            fail("DEVICE_NOT_FOUND", "找不到此设备。", 404);
        if (typeof name !== "string" || !name.trim() || name.length > 80)
            fail("INVALID_REQUEST", "设备名称须为 1 至 80 个字符。");
        this.db.put("devices", id, {
            ...device,
            name: name.trim()
        });
        return {
            status: "renamed"
        };
    }
    revoke(session, id) {
        this.requireActive(session);
        const device = this.db.get("devices", id);
        if (device?.accountId !== session.accountId)
            fail("DEVICE_NOT_FOUND", "找不到此设备。", 404);
        this.db.transaction(() => {
            this.db.put("devices", id, {
                ...device,
                status: "revoked",
                proofHash: null,
                revokedAt: this.now()
            });
            for (const s of this.db.list("sessions").filter(x => x.deviceId === id))
                this.db.put("sessions", s.id, {
                    ...s,
                    revoked: true
                });
            for (const b of this.db.list("bindings").filter(x => x.initiatorDeviceId === id || x.pendingDeviceId === id))
                this.db.put("bindings", b.id, {
                    ...b,
                    status: "cancelled"
                });
        });
        return {
            status: "revoked"
        };
    }
    logout(session) {
        this.db.remove("sessions", session.id);
        return {
            status: "logged_out"
        };
    }
    disconnect(session) {
        this.requireActive(session);
        this.db.transaction(() => {
            this.db.remove("tokens", session.accountId);
            const a = this.db.get("accounts", session.accountId);
            this.db.put("accounts", a.id, {
                ...a,
                connectionStatus: "disconnected"
            });
            for (const s of this.db.list("sessions").filter(x => x.accountId === session.accountId))
                this.db.remove("sessions", s.id);
            for (const b of this.db.list("bindings").filter(x => x.accountId === session.accountId))
                this.db.put("bindings", b.id, {
                    ...b,
                    status: "cancelled"
                });
        });
        return {
            status: "disconnected",
            providerRevocation: "not_supported",
            cloudDataDeleted: false
        };
    }
    async getProvider(accountId) {
        const previous = this.refreshLocks.get(accountId) ?? Promise.resolve();
        const current = previous.catch(() => {
        }).then(async () => {
            const account = this.db.get("accounts", accountId);
            if (!account || account.connectionStatus !== "connected")
                fail("REAUTH_REQUIRED", "请重新授权飞书连接。", 401);
            const record = this.db.get("tokens", accountId);
            if (!record)
                fail("REAUTH_REQUIRED", "请重新授权飞书连接。", 401);
            let tokens = open(record.encrypted, this.config.encryptionKey, `${this.config.environment}:${accountId}`);
            if (tokens.expiresAt <= this.now() + 5000) {
                let refreshed;
                let refreshError;
                try {
                    if (!tokens.refreshToken || tokens.refreshExpiresAt && tokens.refreshExpiresAt <= this.now())
                        throw Error("Refresh expired");
                    refreshed = await this.oauth.refresh(tokens.refreshToken);
                }
                catch (error) {
                    refreshError = error;
                }
                // An OAuth callback or disconnect may complete during the network
                // await. Never overwrite newer credentials or resurrect a connection.
                const currentAccount = this.db.get("accounts", accountId);
                const currentRecord = this.db.get("tokens", accountId);
                if (currentAccount?.connectionStatus !== "connected" || !currentRecord) {
                    fail("REAUTH_REQUIRED", "飞书连接已断开，请重新连接。", 401);
                }
                if (currentRecord.version !== record.version) {
                    tokens = open(currentRecord.encrypted, this.config.encryptionKey, `${this.config.environment}:${accountId}`);
                }
                else if (refreshError) {
                    if (refreshError.retryable && !refreshError.unknownOutcome) {
                        throw Object.assign(gatewayError(refreshError.code ?? "REMOTE_UNAVAILABLE", "飞书暂未完成授权刷新，请稍后重试。", refreshError.status ?? 503, true), {
                            retry_after: Math.min(3600, Math.max(1, Number(refreshError.retryAfter ?? refreshError.retry_after) || 30)),
                        });
                    }
                    this.db.put("accounts", accountId, {
                        ...currentAccount,
                        connectionStatus: "reauth_required"
                    });
                    fail("REAUTH_REQUIRED", "飞书授权已失效，请重新连接；本地数据不受影响。", 401);
                }
                else {
                    this.storeTokens(accountId, refreshed);
                    tokens = refreshed;
                }
            }
            return this.providerFactory(tokens.accessToken, account);
        });
        this.refreshLocks.set(accountId, current);
        try {
            return await current;
        }
        finally {
            if (this.refreshLocks.get(accountId) === current)
                this.refreshLocks.delete(accountId);
        }
    }
}
