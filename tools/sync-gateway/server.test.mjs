import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { GatewayDB } from "./db.mjs";
import { createGateway } from "./server.mjs";
import { requestHandler } from './test-http.mjs';
const config = {
    environment: "staging",
    feishuAppId: "cli_test",
    feishuRedirectUri: "https://api.test/v1/auth/feishu/callback",
    feishuScopes: ["offline_access"],
    allowedTenantKeys: ["tenant-a"],
    encryptionKey: randomBytes(32),
    signingKey: randomBytes(32),
    sessionTtlSeconds: 3600,
    publicAppUrl: "https://app.test",
    apiPublicUrl: "https://api.test",
    allowedOrigins: ["https://app.test", "tauri://localhost"],
    bindingTtlSeconds: 300,
    secureCookies: true,
    maxBodyBytes: 1024
};
async function setup(t) {
    const db = new GatewayDB(":memory:", "staging");
    const oauth = {
        async exchange() {
            return {
                accessToken: "secret",
                refreshToken: "refresh",
                expiresIn: 3600
            };
        },
        async identity() {
            return {
                openId: "owner",
                tenantKey: "tenant-a",
                name: "Alice"
            };
        }
    };
    const handler = createGateway({
        config,
        db,
        oauth,
        syncService: {
            async handle(method, path, url, body, session) {
                return {
                    body: {
                        dataAllowed: session.status === "active"
                    }
                };
            }
        }
    });
    await handler.ready;
    const inProcess = process.env.GATEWAY_TEST_TRANSPORT === 'memory';
    const server = inProcess ? null : createServer(handler);
    if (server) await new Promise(r => server.listen(0, "127.0.0.1", r));
    t.after(async () => {
        if (server) await new Promise(r => server.close(r));
        db.close();
    });
    const base = server ? `http://127.0.0.1:${server.address().port}` : 'http://gateway.test';
    const req = async (path, { method = "GET", body, headers = {} } = {}) => {
        const response = await (inProcess ? (url, options) => requestHandler(handler, url, options) : fetch)(base + path, {
            method,
            body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
            headers: {
                ...(body === undefined ? {} : {
                    "Content-Type": "application/json"
                }),
                ...headers
            },
            redirect: "manual"
        });
        let json;
        try {
            json = await response.json();
        }
        catch {
        }
        return {
            status: response.status,
            json,
            headers: response.headers
        };
    };
    async function login(client = "native", cookie) {
        const start = await req("/v1/auth/feishu/start", {
            method: "POST",
            body: {
                client
            },
            headers: {
                Origin: client === "web" ? "https://app.test" : "tauri://localhost",
                ...(cookie ? {
                    Cookie: cookie
                } : {})
            }
        });
        assert.equal(start.status, 200);
        const state = new URL(start.json.authorizationUrl).searchParams.get("state");
        const callback = await req(`/v1/auth/feishu/callback?state=${state}&code=one`);
        assert.equal(callback.status, client === 'native' ? 200 : 302);
        if (client === 'native') {
            assert.match(callback.headers.get('content-type'), /^text\/html/);
            assert.equal(callback.headers.get('location'), null);
        }
        return req("/v1/auth/exchange", {
            method: "POST",
            body: {
                attemptId: start.json.attemptId,
                pollToken: start.json.pollToken,
                client
            },
            headers: {
                Origin: client === "web" ? "https://app.test" : "tauri://localhost",
                ...(cookie ? {
                    Cookie: cookie
                } : {})
            }
        });
    }
    return {
        db,
        req,
        login,
        handler
    };
}
test("HTTP web session only uses secure HttpOnly cookies, protects mutations with CSRF and forbids browser bearer exchange", async (t) => {
    const f = await setup(t);
    const login = await f.login("web");
    assert.equal(login.status, 200);
    assert.equal(login.json.sessionToken, undefined);
    assert.equal(login.json.deviceProof, undefined);
    const cookies = login.headers.getSetCookie();
    assert.ok(cookies.every(x => x.includes("HttpOnly") && x.includes("Secure") && x.includes("SameSite=Lax")));
    const cookie = cookies.map(x => x.split(";")[0]).join("; ");
    const me = await f.req("/v1/me", {
        headers: {
            Cookie: cookie
        }
    });
    assert.equal(me.json.device.status, "active");
    let r = await f.req("/v1/auth/logout", {
        method: "POST",
        body: {},
        headers: {
            Cookie: cookie,
            Origin: "https://app.test"
        }
    });
    assert.equal(r.json.code, "CSRF_INVALID");
    r = await f.req("/v1/auth/logout", {
        method: "POST",
        body: {},
        headers: {
            Cookie: cookie,
            Origin: "https://evil.test",
            "X-CSRF-Token": me.json.csrfToken
        }
    });
    assert.equal(r.status, 403);
    r = await f.req("/v1/auth/logout", {
        method: "POST",
        body: {},
        headers: {
            Cookie: cookie,
            Origin: "https://app.test",
            "X-CSRF-Token": me.json.csrfToken
        }
    });
    assert.equal(r.status, 200);
    assert.equal((await f.req("/v1/me", {
        headers: {
            Cookie: cookie
        }
    })).status, 401);
});
test("HTTP existing-account pending device cannot bootstrap, read sync, assets or list devices", async (t) => {
    const f = await setup(t);
    const first = await f.login();
    assert.equal(first.json.session.device.status, "active");
    const pending = await f.login();
    assert.equal(pending.json.session.device.status, "pending_device");
    const headers = {
        Authorization: `Bearer ${pending.json.sessionToken}`
    };
    for (const path of ["/v1/libraries/bootstrap", "/v1/sync/changes", "/v1/assets/anything/content", "/v1/devices"]) {
        const r = await f.req(path, {
            method: path.includes("bootstrap") ? "POST" : "GET",
            body: path.includes("bootstrap") ? {} : undefined,
            headers
        });
        assert.equal(r.status, 403, path);
        assert.equal(r.json.code, "DEVICE_PENDING");
    }
    assert.equal((await f.req("/v1/me", {
        headers
    })).json.library, undefined);
    const recovered = await f.req("/v1/auth/recover", {
        method: "POST",
        body: {
            confirm: true
        },
        headers
    });
    assert.equal(recovered.json.code, "BOOTSTRAP_INCOMPLETE");
});
test("HTTP rejects hostile origin, oversized and malformed body with safe standard errors and limits auth abuse", async (t) => {
    const f = await setup(t);
    let r = await f.req("/v1/auth/feishu/start", {
        method: "POST",
        body: {
            client: "web"
        },
        headers: {
            Origin: "https://evil.test"
        }
    });
    assert.equal(r.status, 403);
    assert.ok(r.json.request_id);
    r = await f.req("/v1/auth/feishu/start", {
        method: "POST",
        body: "not-json",
        headers: {
            Origin: "https://app.test"
        }
    });
    assert.equal(r.status, 400);
    r = await f.req("/v1/auth/feishu/start", {
        method: "POST",
        body: {
            client: "web",
            extra: "x".repeat(17000)
        },
        headers: {
            Origin: "https://app.test"
        }
    });
    assert.equal(r.status, 413);
    for (let i = 0; i < 35; i++)
        r = await f.req("/v1/auth/feishu/start", {
            method: "POST",
            body: {
                client: "web"
            },
            headers: {
                Origin: "https://app.test"
            }
        });
    assert.equal(r.status, 429);
    assert.equal(r.json.code, "RATE_LIMITED");
});
test("native bearer cannot be requested by ordinary browser origin and disconnected accounts cannot access data", async (t) => {
    const f = await setup(t);
    let r = await f.req("/v1/auth/feishu/start", {
        method: "POST",
        body: {
            client: "native"
        },
        headers: {
            Origin: "https://app.test"
        }
    });
    assert.equal(r.status, 403);
    const login = await f.login();
    const account = f.db.get("accounts", login.json.session.account.id);
    f.db.put("accounts", account.id, {
        ...account,
        connectionStatus: "disconnected"
    });
    r = await f.req("/v1/sync/changes", {
        headers: {
            Authorization: `Bearer ${login.json.sessionToken}`
        }
    });
    assert.equal(r.status, 401);
    assert.equal(r.json.code, "REAUTH_REQUIRED");
});
test("native data bearer is rejected in web origin and remote retry hints survive HTTP boundary", async (t) => {
    const f = await setup(t);
    const login = await f.login();
    const headers = {
        Authorization: `Bearer ${login.json.sessionToken}`
    };
    let r = await f.req("/v1/sync/changes", {
        headers: {
            ...headers,
            Origin: "https://app.test"
        }
    });
    assert.equal(r.status, 403);
    f.handler.sync.handle = async () => {
        throw Object.assign(new Error("Rate limited"), {
            code: "RATE_LIMITED",
            status: 429,
            retryable: true,
            retryAfter: 45
        });
    };
    r = await f.req("/v1/sync/changes", {
        headers
    });
    assert.equal(r.status, 429);
    assert.equal(r.json.retry_after, 45);
    assert.equal(r.headers.get("retry-after"), "45");
});
test("unexpected infrastructure exceptions never disclose paths or secret-bearing messages", async (t) => {
    const f = await setup(t);
    const login = await f.login();
    f.handler.sync.handle = async () => {
        throw Object.assign(new Error("failed /private/token=do-not-disclose"), {
            code: "EIO"
        });
    };
    const response = await f.req("/v1/sync/changes", {
        headers: {
            Authorization: `Bearer ${login.json.sessionToken}`
        }
    });
    assert.equal(response.status, 500);
    assert.equal(response.json.code, "INTERNAL_ERROR");
    assert.ok(!JSON.stringify(response.json).includes("do-not-disclose"));
});
test("HTTP recovery starts a new OAuth round trip and replaces devices only after management proof", async (t) => {
    const f = await setup(t);
    const first = await f.login(), pending = await f.login();
    const accountId = first.json.session.account.id;
    f.db.put("libraries", accountId, {
        id: "lib",
        accountId,
        state: "ready"
    });
    f.handler.auth.providerFactory = () => ({
        checkManagement: async () => true
    });
    const start = await f.req("/v1/auth/recover", {
        method: "POST",
        body: {
            confirm: true
        },
        headers: {
            Authorization: `Bearer ${pending.json.sessionToken}`
        }
    });
    assert.equal(start.status, 200);
    assert.ok(start.json.authorizationUrl);
    assert.equal((await f.req("/v1/me", {
        headers: {
            Authorization: `Bearer ${first.json.sessionToken}`
        }
    })).status, 200);
    const state = new URL(start.json.authorizationUrl).searchParams.get("state");
    const callback = await f.req(`/v1/auth/feishu/callback?state=${state}&code=recovery`);
    assert.equal(callback.status, 200);
    const exchange = await f.req("/v1/auth/exchange", {
        method: "POST",
        body: {
            attemptId: start.json.attemptId,
            pollToken: start.json.pollToken
        },
        headers: {
            Origin: "tauri://localhost"
        }
    });
    assert.equal(exchange.status, 200);
    assert.equal(exchange.json.session.device.status, "active");
    assert.equal((await f.req("/v1/me", {
        headers: {
            Authorization: `Bearer ${first.json.sessionToken}`
        }
    })).status, 401);
});
test("authorization exchange remains bound to initiating Origin, not merely another allowlisted native Origin", async (t) => {
    const f = await setup(t);
    const attempt = f.handler.auth.start({
        client: "native",
        origin: "tauri://localhost"
    });
    await f.handler.auth.callback({
        state: new URL(attempt.authorizationUrl).searchParams.get("state"),
        code: "owner"
    });
    let exchange = await f.req("/v1/auth/exchange", {
        method: "POST",
        body: attempt
    });
    assert.equal(exchange.status, 403);
    exchange = await f.req("/v1/auth/exchange", {
        method: "POST",
        body: attempt,
        headers: {
            Origin: "tauri://localhost"
        }
    });
    assert.equal(exchange.status, 200);
});
