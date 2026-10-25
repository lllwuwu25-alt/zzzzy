import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.mjs";
import { GatewayDB } from "./db.mjs";
import { GatewayAuth } from "./auth.mjs";
import { equalSecret, gatewayError } from "./crypto.mjs";
import packageInfo from './package.json' with { type: 'json' };
const mutation = method => !["GET", "HEAD", "OPTIONS"].includes(method);
function cookies(header = "") {
    return Object.fromEntries(header.split(";").filter(Boolean).map(x => {
        const p = x.trim().indexOf("=");
        return [x.trim().slice(0, p), x.trim().slice(p + 1)];
    }));
}
async function bodyJSON(req, limit) {
    const length = Number(req.headers["content-length"] ?? 0);
    if (length > limit)
        throw gatewayError("PAYLOAD_TOO_LARGE", "请求内容过大。", 413);
    if (!mutation(req.method))
        return {};
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > limit)
            throw gatewayError("PAYLOAD_TOO_LARGE", "请求内容过大。", 413);
        chunks.push(chunk);
    }
    if (!size)
        return {};
    if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json"))
        throw gatewayError("INVALID_REQUEST", "请求须使用 JSON。", 415);
    try {
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value))
            throw Error();
        return value;
    }
    catch {
        throw gatewayError("INVALID_REQUEST", "请求 JSON 格式不正确。", 400);
    }
}
/** Returns a Node HTTP handler. Await handler.ready before announcing readiness. */
export function createGateway({ config, db, oauth, providerForAccount, syncService }) {
    let auth, sync;
    const buckets = new Map();
    const ready = (async () => {
        const adapter = (!oauth || !providerForAccount) ? await import("./feishu.mjs") : null;
        auth = new GatewayAuth(config, db, oauth ?? new adapter.FeishuOAuth(config), async (token, account) => new (adapter ?? await import("./feishu.mjs")).FeishuBitable({
            ...config,
            feishuOpenId: account.feishu?.openId
        }, token));
        if (syncService)
            sync = syncService;
        else {
            const { SyncService } = await import("./sync.mjs");
            sync = new SyncService(db, providerForAccount ?? (id => auth.getProvider(id)));
        }
        handler.auth = auth;
        handler.sync = sync;
    })();
    const prefix = config.secureCookies ? "__Host-" : "";
    const sessionCookie = `${prefix}mn_session`, proofCookie = `${prefix}mn_device`;
    const cookie = (name, value, maxAge) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.secureCookies ? "; Secure" : ""}`;
    function allowOrigin(req, required = false) {
        const origin = req.headers.origin;
        if ((required && !origin) || (origin && !config.allowedOrigins.includes(origin)))
            throw gatewayError("ORIGIN_DENIED", "此页面来源未获准访问云同步。", 403);
        return origin;
    }
    function requireNativeOrigin(req) {
        const origin = req.headers.origin;
        if (origin && !["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"].includes(origin)) {
            throw gatewayError("NATIVE_TRANSPORT_REQUIRED", "原生会话只能由桌面客户端交换。", 403);
        }
    }
    function rate(req, path) {
        const group = path === "/v1/auth/feishu/start" ? "oauth" : path.includes("device-bindings") ? "binding" : "requests";
        const key = `${req.socket.remoteAddress}:${group}`;
        const now = Date.now();
        let bucket = buckets.get(key);
        if (!bucket || bucket.until <= now) {
            bucket = {
                count: 0,
                until: now + 60000
            };
            buckets.set(key, bucket);
        }
        const limit = group === "oauth" ? 30 : group === "binding" ? 60 : 240;
        if (++bucket.count > limit)
            throw Object.assign(gatewayError("RATE_LIMITED", "操作过于频繁，请稍后再试。", 429, true), {
                retry_after: Math.ceil((bucket.until - now) / 1000)
            });
        if (buckets.size > 10000) {
            for (const [k, v] of buckets)
                if (v.until <= now)
                    buckets.delete(k);
            if (buckets.size > 10000)
                throw gatewayError("RATE_LIMITED", "服务繁忙，请稍后重试。", 429, true);
        }
    }
    async function handler(req, res) {
        const requestId = randomUUID();
        res.setHeader("X-Request-Id", requestId);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        const send = (status, body, headers = {}) => {
            res.writeHead(status, {
                "Content-Type": "application/json; charset=utf-8",
                ...headers
            });
            res.end(body === undefined ? undefined : JSON.stringify(body));
        };
        try {
            await ready;
            const url = new URL(req.url, "http://gateway.internal"), path = url.pathname;
            const origin = allowOrigin(req);
            if (origin) {
                res.setHeader("Access-Control-Allow-Origin", origin);
                res.setHeader("Access-Control-Allow-Credentials", "true");
                res.setHeader("Vary", "Origin");
            }
            if (req.method === "OPTIONS") {
                res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
                res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-CSRF-Token");
                return send(204);
            }
            rate(req, path);
            if (path === "/v1/status" && req.method === "GET")
                return send(200, {
                    status: "configured",
                    environment: config.environment,
                    applicationType: config.feishuAppType,
                    serviceVersion: packageInfo.version,
                    protocolVersion: 1,
                    liveVerified: false
                });
            if (path === "/v1/auth/feishu/callback" && req.method === "GET") {
                const result = await auth.callback(Object.fromEntries(url.searchParams));
                if (result.client === 'native') {
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'" });
                    return res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>授权完成 · 错题本</title><style>body{font:17px system-ui;margin:15vh auto;padding:24px;max-width:440px;color:#14383e;background:#f3f7f8}p{line-height:1.8}</style><h1>飞书授权已完成</h1><p>请返回错题本 App，继续完成设备确认与同步。此网页不读取或显示题库。</p></html>');
                }
                const location = `${config.publicAppUrl}/?oauth=return`;
                res.writeHead(302, {
                    Location: location
                });
                return res.end();
            }
            const body = await bodyJSON(req, path.startsWith("/v1/auth/") ? 16384 : config.maxBodyBytes ?? 32 * 1024 * 1024);
            const jar = cookies(req.headers.cookie);
            if (path === "/v1/auth/feishu/start" && req.method === "POST") {
                allowOrigin(req, body.client !== "native");
                if (body.client === "native")
                    requireNativeOrigin(req);
                if (body.client === "web" && body.deviceProof)
                    throw gatewayError("INVALID_REQUEST", "浏览器设备证明必须使用安全 Cookie。", 400);
                return send(200, auth.start({
                    ...body,
                    origin: req.headers.origin,
                    deviceProof: body.client === "web" ? jar[proofCookie] : body.deviceProof
                }));
            }
            if (path === "/v1/auth/exchange" && req.method === "POST") {
                const attempt = db.get("oauth_attempts", body.attemptId);
                allowOrigin(req, attempt?.client !== "native");
                if (attempt?.client === "native")
                    requireNativeOrigin(req);
                const result = auth.exchange(body, body.client, req.headers.origin);
                if (result.status === "pending")
                    return send(200, result);
                if (result.client === "web") {
                    res.setHeader("Set-Cookie", [cookie(sessionCookie, result.sessionToken, config.sessionTtlSeconds), cookie(proofCookie, result.deviceProof, 86400 * 365)]);
                    const { sessionToken: _, deviceProof: __, client: ___, ...safe } = result;
                    return send(200, safe);
                }
                const { client: _, ...native } = result;
                return send(200, native);
            }
            const bearer = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1];
            const session = auth.authenticate(bearer ?? jar[sessionCookie]);
            if (bearer)
                requireNativeOrigin(req);
            if ((bearer && session.client !== "native") || (!bearer && session.client !== "web"))
                throw gatewayError("SESSION_TRANSPORT_INVALID", "会话传输方式不正确。", 403);
            if (!bearer && mutation(req.method)) {
                allowOrigin(req, true);
                if (!equalSecret(req.headers["x-csrf-token"], auth.csrf(session)))
                    throw gatewayError("CSRF_INVALID", "页面验证已失效，请刷新后重试。", 403);
            }
            if (req.method === "GET" && path === "/v1/me")
                return send(200, auth.me(session));
            if (req.method === "POST" && path === "/v1/auth/logout") {
                const result = auth.logout(session);
                res.setHeader("Set-Cookie", [cookie(sessionCookie, "", 0), cookie(proofCookie, "", 0)]);
                return send(200, result);
            }
            if (req.method === "POST" && ["/v1/auth/disconnect", "/v1/connections/feishu/disconnect"].includes(path))
                return send(200, auth.disconnect(session));
            if (req.method === "POST" && path === "/v1/auth/recover")
                return send(200, auth.recover(session, {
                    ...body,
                    origin: req.headers.origin
                }));
            if (path === "/v1/device-bindings" && req.method === "GET")
                return send(200, {
                    bindings: auth.bindings.list(session)
                });
            if (path.startsWith("/v1/device-bindings") && req.method === "POST") {
                const action = path === "/v1/device-bindings" ? (body.action ?? "create") : path.split("/").at(-1);
                if (action === "create")
                    return send(200, auth.bindings.create(session));
                if (action === "claim")
                    return send(200, auth.bindings.claim(session, body.bindingId, body.token));
                if (action === "confirm")
                    return send(200, auth.bindings.confirm(session, body.bindingId, body.pendingDeviceId));
                if (action === "cancel")
                    return send(200, auth.bindings.cancel(session, body.bindingId));
                throw gatewayError("INVALID_REQUEST", "未知的绑定操作。", 400);
            }
            auth.requireActive(session);
            if (db.get("accounts", session.accountId)?.connectionStatus !== "connected") {
                throw gatewayError("REAUTH_REQUIRED", "请重新连接飞书；本地数据不受影响。", 401);
            }
            if (path === "/v1/devices" && req.method === "GET")
                return send(200, {
                    devices: auth.devices(session)
                });
            const deviceMatch = path.match(/^\/v1\/devices\/([^/]+)$/);
            if (deviceMatch && req.method === "PATCH")
                return send(200, auth.rename(session, deviceMatch[1], body.name));
            if (deviceMatch && req.method === "DELETE")
                return send(200, auth.revoke(session, deviceMatch[1]));
            const result = await sync.handle(req.method, path, url, body, session);
            if (!result)
                throw gatewayError("NOT_FOUND", "找不到此接口。", 404);
            if (result.bytes) {
                res.writeHead(result.status ?? 200, {
                    "Content-Type": "application/octet-stream",
                    ...result.headers
                });
                return res.end(result.bytes);
            }
            return send(result.status ?? 200, result.body ?? {}, result.headers);
        }
        catch (error) {
            const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
            const code = Number.isInteger(error.status) && typeof error.code === "string" && /^[A-Z_]+$/.test(error.code) ? error.code : "INTERNAL_ERROR";
            const retryAfter = Math.min(3600, Math.max(0, Math.ceil(Number(error.retry_after ?? error.retryAfter) || 0)));
            const payload = {
                code,
                message: code === "INTERNAL_ERROR" ? "云同步服务暂不可用，本地数据不受影响。" : error.message,
                retryable: !!error.retryable,
                request_id: requestId,
                ...(retryAfter ? {
                    retry_after: retryAfter
                } : {})
            };
            if (retryAfter)
                res.setHeader("Retry-After", retryAfter);
            if (!res.headersSent)
                send(status, payload);
            else
                res.end();
        }
    }
    handler.ready = ready;
    return handler;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const config = loadConfig();
        const db = new GatewayDB(config.databasePath, config.environment);
        const handler = createGateway({
            config,
            db
        });
        await handler.ready;
        const server = createServer(handler);
        server.requestTimeout = 30000;
        server.headersTimeout = 15000;
        server.listen(config.port, config.host, () => process.stdout.write(`Sync gateway ready (${config.environment})\n`));
        for (const signal of ["SIGINT", "SIGTERM"])
            process.once(signal, () => server.close(() => {
                db.close();
                process.exit(0);
            }));
    }
    catch (error) {
        process.stderr.write(`Sync gateway unavailable: ${error.code ?? "STARTUP_FAILED"}\n`);
        process.exitCode = 1;
    }
}
