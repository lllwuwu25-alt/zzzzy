import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { GatewayDB } from "./db.mjs";
import { GatewayAuth } from "./auth.mjs";
import { DeviceBindings } from "./bindings.mjs";
const config = {
    environment: "staging",
    feishuAppId: "cli_test",
    feishuRedirectUri: "https://api.test/v1/auth/feishu/callback",
    feishuScopes: ["offline_access"],
    allowedTenantKeys: ["tenant-a"],
    encryptionKey: randomBytes(32),
    signingKey: randomBytes(32),
    sessionTtlSeconds: 60,
    publicAppUrl: "https://app.test",
    bindingTtlSeconds: 300
};
function fixture() {
    let time = 1000000;
    const db = new GatewayDB(":memory:", "staging");
    let refreshes = 0;
    const oauth = {
        async exchange(code) {
            return {
                accessToken: `access-${code}`,
                refreshToken: "refresh-secret",
                expiresIn: 30,
                refreshExpiresIn: 3600
            };
        },
        async identity(token) {
            return {
                openId: token.includes("other") ? "other" : "owner",
                tenantKey: token.includes("wrongtenant") ? "tenant-b" : "tenant-a",
                name: "User"
            };
        },
        async refresh() {
            refreshes++;
            await new Promise(r => setTimeout(r, 5));
            return {
                accessToken: "renewed",
                refreshToken: "rotated",
                expiresIn: 3600,
                refreshExpiresIn: 7200
            };
        }
    };
    const auth = new GatewayAuth(config, db, oauth, token => ({
        token
    }), () => time);
    const bindings = new DeviceBindings(config, db, () => time);
    async function login(code = "owner", extra = {}) {
        const start = auth.start({
            client: "native",
            deviceName: "Laptop",
            deviceType: "desktop",
            ...extra
        });
        const state = new URL(start.authorizationUrl).searchParams.get("state");
        await auth.callback({
            state,
            code
        });
        return {
            ...auth.exchange({
                attemptId: start.attemptId,
                pollToken: start.pollToken
            }),
            start,
            state
        };
    }
    return {
        db,
        auth,
        bindings,
        login,
        advance: n => time += n,
        refreshes: () => refreshes
    };
}
test('a phone-first login stays pending and does not strand the first desktop admission', async () => {
    const f = fixture();
    try {
        const phone = await f.login('owner', { deviceType: 'mobile', deviceName: 'HONOR 90' });
        assert.equal(phone.session.device.status, 'pending_device');
        assert.throws(() => f.auth.requireActive(f.auth.authenticate(phone.sessionToken)), { code: 'DEVICE_PENDING' });
        const desktop = await f.login();
        assert.equal(desktop.session.device.status, 'active');
        assert.equal(desktop.session.account.id, phone.session.account.id);
        assert.equal(f.auth.authenticate(phone.sessionToken).status, 'pending_device');
        assert.equal(f.db.list('devices').filter(device => device.status === 'active').length, 1);
    } finally { f.db.close(); }
});
test('interrupted initial OAuth cannot permanently strand the first account before any session was admitted', async () => {
    const f = fixture();
    try {
        const interrupted = f.auth.start({ client: 'native', deviceName: 'Interrupted', deviceType: 'desktop' });
        await f.auth.callback({ state: new URL(interrupted.authorizationUrl).searchParams.get('state'), code: 'owner' });
        const originalAccount = f.db.list('accounts')[0].id;
        f.advance(600001);
        const resumed = await f.login();
        assert.equal(resumed.session.account.id, originalAccount);
        assert.equal(resumed.session.device.status, 'active');
        assert.equal(f.db.list('devices').filter(device => device.status === 'active').length, 1);
        const later = await f.login();
        assert.equal(later.session.device.status, 'pending_device');
    } finally { f.db.close(); }
});
test("OAuth state and exchange are single-use, only first device active, and persisted credentials are encrypted", async () => {
    const f = fixture();
    try {
        const first = await f.login();
        assert.equal(first.session.device.status, "active");
        assert.ok(first.sessionToken);
        assert.ok(first.deviceProof);
        assert.throws(() => f.auth.exchange({
            attemptId: first.start.attemptId,
            pollToken: first.start.pollToken
        }), {
            code: "EXCHANGE_CONSUMED"
        });
        await assert.rejects(f.auth.callback({
            state: first.state,
            code: "owner"
        }), {
            code: "OAUTH_STATE_INVALID"
        });
        const next = await f.login();
        assert.equal(next.session.device.status, "pending_device");
        const forged = await f.login("owner", {
            deviceId: first.session.device.id
        });
        assert.equal(forged.session.device.status, "pending_device");
        const restored = await f.login("owner", {
            deviceProof: first.deviceProof
        });
        assert.equal(restored.session.device.id, first.session.device.id);
        assert.equal(restored.session.device.status, "active");
        const raw = JSON.stringify(f.db.list("tokens")) + JSON.stringify(f.db.list("sessions")) + JSON.stringify(f.db.list("oauth_attempts"));
        assert.ok(!raw.includes("refresh-secret"));
        assert.ok(!raw.includes(first.sessionToken));
        assert.ok(!raw.includes(first.start.pollToken));
    }
    finally {
        f.db.close();
    }
});
test("OAuth mismatch, expiry and wrong tenant fail without creating active sessions", async () => {
    const f = fixture();
    try {
        const a = f.auth.start({
            client: "native"
        });
        assert.throws(() => f.auth.exchange({
            attemptId: a.attemptId,
            pollToken: "forged"
        }), {
            code: "EXCHANGE_INVALID"
        });
        await assert.rejects(f.auth.callback({
            state: "forged",
            code: "owner"
        }), {
            code: "OAUTH_STATE_INVALID"
        });
        f.advance(601000);
        await assert.rejects(f.auth.callback({
            state: new URL(a.authorizationUrl).searchParams.get("state"),
            code: "owner"
        }), {
            code: "OAUTH_STATE_INVALID"
        });
        await assert.rejects(f.login("wrongtenant"), {
            code: "TENANT_NOT_ALLOWED"
        });
        assert.equal(f.db.list("accounts").length, 0);
    }
    finally {
        f.db.close();
    }
});
test("token refresh serializes concurrent readers and refuses refresh after permanent failure", async () => {
    const f = fixture();
    try {
        const login = await f.login();
        const id = login.session.account.id;
        f.advance(31000);
        const providers = await Promise.all([f.auth.getProvider(id), f.auth.getProvider(id)]);
        assert.deepEqual(providers.map(x => x.token), ["renewed", "renewed"]);
        assert.equal(f.refreshes(), 1);
        f.auth.oauth.refresh = async () => {
            throw Error("invalid grant");
        };
        f.advance(4000000);
        await assert.rejects(f.auth.getProvider(id), {
            code: "REAUTH_REQUIRED"
        });
        await assert.rejects(f.auth.getProvider(id), {
            code: "REAUTH_REQUIRED"
        });
        assert.equal(f.db.get("accounts", id).connectionStatus, "reauth_required");
    }
    finally {
        f.db.close();
    }
});
test("binding needs owner approval, rejects other accounts, replay, expiration and revoked initiator", async () => {
    const f = fixture();
    try {
        const a = await f.login(), phone = await f.login(), other = await f.login("other");
        const active = f.auth.authenticate(a.sessionToken);
        const pending = f.auth.authenticate(phone.sessionToken);
        const stranger = f.auth.authenticate(other.sessionToken);
        f.db.put("libraries", active.accountId, {
            id: "lib",
            accountId: active.accountId,
            state: "ready",
            name: "Library"
        });
        const created = f.bindings.create(active);
        assert.throws(() => f.bindings.claim(stranger, created.bindingId, created.token), {
            code: "BINDING_IDENTITY_MISMATCH"
        });
        f.bindings.claim(pending, created.bindingId, created.token);
        assert.equal(f.auth.authenticate(phone.sessionToken).status, "pending_device");
        assert.throws(() => f.bindings.confirm(pending, created.bindingId, pending.deviceId), {
            code: "DEVICE_PENDING"
        });
        f.bindings.confirm(active, created.bindingId, pending.deviceId);
        assert.equal(f.auth.authenticate(phone.sessionToken).status, "active");
        assert.throws(() => f.bindings.claim(pending, created.bindingId, created.token), {
            code: "BINDING_INVALID"
        });
        const expired = f.bindings.create(active);
        f.advance(301000);
        assert.throws(() => f.bindings.claim(pending, expired.bindingId, expired.token), {
            code: "BINDING_INVALID"
        });
        f.auth.revoke(active, pending.deviceId);
        assert.throws(() => f.auth.authenticate(phone.sessionToken), {
            code: "DEVICE_REVOKED"
        });
    }
    finally {
        f.db.close();
    }
});
test("binding OAuth intent is checked server-side and refresh invalidates former QR", async () => {
    const f = fixture();
    try {
        const first = await f.login();
        const active = f.auth.authenticate(first.sessionToken);
        f.db.put("libraries", active.accountId, {
            id: "lib",
            accountId: active.accountId,
            state: "ready"
        });
        const old = f.bindings.create(active), current = f.bindings.create(active);
        assert.throws(() => f.bindings.validateIntent(old.bindingId, old.token), {
            code: "BINDING_INVALID"
        });
        const linked = await f.login("owner", {
            binding: {
                bindingId: current.bindingId,
                token: current.token
            }
        });
        assert.equal(f.db.get("bindings", current.bindingId).pendingDeviceId, linked.session.device.id);
        assert.equal(linked.session.device.status, "pending_device");
        const claim = f.db.get("bindings", current.bindingId);
        assert.ok(!JSON.stringify(claim).includes(current.token));
    }
    finally {
        f.db.close();
    }
});
test("account retains verified identity for resource management and revoked proof cannot restore active access", async () => {
    const f = fixture();
    try {
        const first = await f.login();
        const account = f.db.get("accounts", first.session.account.id);
        assert.equal(account.feishu.openId, "owner");
        assert.equal(account.feishu.tenantKey, "tenant-a");
        f.auth.revoke(f.auth.authenticate(first.sessionToken), first.session.device.id);
        const next = await f.login("owner", {
            deviceProof: first.deviceProof
        });
        assert.equal(next.session.device.status, "pending_device");
        assert.notEqual(next.session.device.id, first.session.device.id);
    }
    finally {
        f.db.close();
    }
});
test("disconnect during in-flight refresh cannot resurrect stored authorization", async () => {
    const f = fixture();
    try {
        const first = await f.login();
        const session = f.auth.authenticate(first.sessionToken);
        let started, release;
        const begun = new Promise(resolve => {
            started = resolve;
        });
        const delayed = new Promise(resolve => {
            release = resolve;
        });
        f.auth.oauth.refresh = async () => {
            started();
            await delayed;
            return {
                accessToken: "stale-access",
                refreshToken: "stale-refresh",
                expiresIn: 3600
            };
        };
        f.advance(31000);
        const refresh = f.auth.getProvider(session.accountId);
        await begun;
        f.auth.disconnect(session);
        release();
        await assert.rejects(refresh, {
            code: "REAUTH_REQUIRED"
        });
        assert.equal(f.db.get("tokens", session.accountId), null);
        assert.equal(f.db.get("accounts", session.accountId).connectionStatus, "disconnected");
    }
    finally {
        f.db.close();
    }
});
test("fresh OAuth takes precedence over older in-flight refresh result", async () => {
    const f = fixture();
    try {
        const first = await f.login();
        let started, release;
        const begun = new Promise(resolve => {
            started = resolve;
        });
        const delayed = new Promise(resolve => {
            release = resolve;
        });
        f.auth.oauth.refresh = async () => {
            started();
            await delayed;
            return {
                accessToken: "stale-access",
                refreshToken: "stale-refresh",
                expiresIn: 3600
            };
        };
        f.advance(31000);
        const refresh = f.auth.getProvider(first.session.account.id);
        await begun;
        await f.login("owner", {
            deviceProof: first.deviceProof
        });
        release();
        assert.equal((await refresh).token, "access-owner");
        assert.equal((await f.auth.getProvider(first.session.account.id)).token, "access-owner");
    }
    finally {
        f.db.close();
    }
});
test("known rate-limited refresh keeps valid connection and surfaces bounded retry hint", async () => {
    const f = fixture();
    try {
        const first = await f.login();
        f.advance(31000);
        f.auth.oauth.refresh = async () => {
            throw Object.assign(new Error("Temporary rate limit"), {
                code: "RATE_LIMITED",
                status: 429,
                retryable: true,
                retryAfter: 30
            });
        };
        await assert.rejects(f.auth.getProvider(first.session.account.id), {
            code: "RATE_LIMITED",
            retry_after: 30
        });
        assert.equal(f.db.get("accounts", first.session.account.id).connectionStatus, "connected");
        f.auth.oauth.refresh = async () => ({
            accessToken: "retried",
            expiresIn: 3600
        });
        assert.equal((await f.auth.getProvider(first.session.account.id)).token, "retried");
    }
    finally {
        f.db.close();
    }
});
test("missing persisted account behind known identity never becomes a new first active device", async () => {
    const f = fixture();
    try {
        const first = await f.login();
        f.db.remove("accounts", first.session.account.id);
        await assert.rejects(f.login(), {
            code: "ACCOUNT_STATE_INVALID"
        });
        assert.equal(f.db.list("devices").length, 1);
    }
    finally {
        f.db.close();
    }
});
test("explicit recovery requires fresh matching OAuth and management permission before atomic device replacement", async () => {
    const f = fixture();
    try {
        const first = await f.login(), pending = await f.login();
        const owner = f.auth.authenticate(first.sessionToken), target = f.auth.authenticate(pending.sessionToken);
        f.db.put("libraries", owner.accountId, {
            id: "lib",
            accountId: owner.accountId,
            state: "ready"
        });
        const binding = f.bindings.create(owner);
        let allowManagement = false;
        f.auth.providerFactory = () => ({
            checkManagement: async () => allowManagement
        });
        assert.throws(() => f.auth.recover(target, {
            confirm: false
        }), {
            code: "RECOVERY_CONFIRMATION_REQUIRED"
        });
        let attempt = f.auth.recover(target, {
            confirm: true
        });
        assert.equal(new URL(attempt.authorizationUrl).searchParams.get("prompt"), "consent");
        let state = new URL(attempt.authorizationUrl).searchParams.get("state");
        await assert.rejects(f.auth.callback({
            state,
            code: "other"
        }), {
            code: "RECOVERY_IDENTITY_MISMATCH"
        });
        assert.equal(f.auth.authenticate(first.sessionToken).status, "active");
        attempt = f.auth.recover(target, {
            confirm: true
        });
        state = new URL(attempt.authorizationUrl).searchParams.get("state");
        await assert.rejects(f.auth.callback({
            state,
            code: "owner"
        }), {
            code: "LIBRARY_ACCESS_DENIED"
        });
        assert.equal(f.auth.authenticate(first.sessionToken).status, "active");
        assert.equal(f.auth.authenticate(pending.sessionToken).status, "pending_device");
        assert.equal(f.db.get("bindings", binding.bindingId).status, "created");
        allowManagement = true;
        attempt = f.auth.recover(target, {
            confirm: true
        });
        state = new URL(attempt.authorizationUrl).searchParams.get("state");
        await f.auth.callback({
            state,
            code: "owner"
        });
        assert.throws(() => f.auth.authenticate(first.sessionToken), {
            code: "AUTH_REQUIRED"
        });
        assert.throws(() => f.auth.authenticate(pending.sessionToken), {
            code: "AUTH_REQUIRED"
        });
        assert.equal(f.db.get("devices", owner.deviceId).status, "revoked");
        assert.equal(f.db.get("devices", owner.deviceId).proofHash, null);
        assert.equal(f.db.get("bindings", binding.bindingId).status, "cancelled");
        const restored = f.auth.exchange(attempt);
        assert.equal(restored.session.device.id, target.deviceId);
        assert.equal(restored.session.device.status, "active");
        assert.throws(() => f.auth.exchange(attempt), {
            code: "EXCHANGE_CONSUMED"
        });
        const proofLogin = await f.login("owner", {
            deviceProof: first.deviceProof
        });
        assert.equal(proofLogin.session.device.status, "pending_device");
        assert.equal(f.db.list("security_events").filter(e => e.kind === "account_access_recovered").length, 1);
    }
    finally {
        f.db.close();
    }
});
test("recovery management exception and stale second recovery never revoke current owner", async () => {
    const f = fixture();
    try {
        const first = await f.login(), pending = await f.login();
        const owner = f.auth.authenticate(first.sessionToken), target = f.auth.authenticate(pending.sessionToken);
        f.db.put("libraries", owner.accountId, {
            id: "lib",
            accountId: owner.accountId,
            state: "ready"
        });
        f.auth.providerFactory = () => ({
            checkManagement: async () => {
                throw Error("network unavailable");
            }
        });
        let attempt = f.auth.recover(target, {
            confirm: true
        });
        await assert.rejects(f.auth.callback({
            state: new URL(attempt.authorizationUrl).searchParams.get("state"),
            code: "owner"
        }));
        assert.equal(f.auth.authenticate(first.sessionToken).status, "active");
        f.auth.providerFactory = () => ({
            checkManagement: async () => true
        });
        const older = f.auth.recover(target, {
            confirm: true
        });
        attempt = f.auth.recover(target, {
            confirm: true
        });
        await f.auth.callback({
            state: new URL(attempt.authorizationUrl).searchParams.get("state"),
            code: "owner"
        });
        const recovered = f.auth.exchange(attempt);
        await assert.rejects(f.auth.callback({
            state: new URL(older.authorizationUrl).searchParams.get("state"),
            code: "owner"
        }));
        assert.equal(f.auth.authenticate(recovered.sessionToken).status, "active");
    }
    finally {
        f.db.close();
    }
});
test("SQLite abort after recovery authority writes rolls back old-device revocation and credentials together", async () => {
    const f = fixture();
    try {
        const first = await f.login(), pending = await f.login();
        const owner = f.auth.authenticate(first.sessionToken), target = f.auth.authenticate(pending.sessionToken);
        f.db.put("libraries", owner.accountId, {
            id: "lib",
            accountId: owner.accountId,
            state: "ready"
        });
        const oldVersion = f.db.get("tokens", owner.accountId).version;
        f.auth.providerFactory = () => ({
            checkManagement: async () => true
        });
        const attempt = f.auth.recover(target, {
            confirm: true
        });
        f.db.sqlite.exec("CREATE TEMP TRIGGER inject_recovery_abort BEFORE INSERT ON gateway_records WHEN NEW.namespace='security_events' BEGIN SELECT RAISE(ABORT,'injected failure'); END");
        await assert.rejects(f.auth.callback({
            state: new URL(attempt.authorizationUrl).searchParams.get("state"),
            code: "owner"
        }));
        assert.equal(f.auth.authenticate(first.sessionToken).status, "active");
        assert.equal(f.auth.authenticate(pending.sessionToken).status, "pending_device");
        assert.equal(f.db.get("tokens", owner.accountId).version, oldVersion);
    }
    finally {
        f.db.close();
    }
});
test('online device timestamps advance and expired short-lived coordination records are removed on next auth start',async()=>{
    const f=fixture();
    try {
        const first=await f.login();
        const session=f.auth.authenticate(first.sessionToken);
        const before=f.db.get('devices',session.deviceId);
        f.advance(11000);
        f.auth.authenticate(first.sessionToken);
        assert.ok(f.db.get('devices',session.deviceId).lastSeenAt>before.lastSeenAt);
        f.db.put('libraries',session.accountId,{id:'lib',accountId:session.accountId,state:'ready'});
        const binding=f.bindings.create(session);
        f.auth.start({client:'native'});
        f.advance(601000);
        f.auth.start({client:'native'});
        assert.equal(f.db.list('oauth_attempts').length,1);
        assert.equal(f.db.list('sessions').length,0);
        assert.equal(f.db.get('bindings',binding.bindingId),null);
    }finally{f.db.close();}
});
