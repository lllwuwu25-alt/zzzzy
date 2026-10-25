import { isAbsolute } from "node:path";
import { gatewayError } from "./crypto.mjs";
const invalid = message => {
    throw gatewayError("CONFIG_INVALID", message, 503);
};
function key(value, name) {
    if (!value || /example|change.?me|placeholder/i.test(value))
        invalid(`${name} must be a unique strong base64 key`);
    const decoded = Buffer.from(value, "base64");
    if (decoded.length !== 32 || decoded.toString("base64") !== value || new Set(decoded).size < 12)
        invalid(`${name} must contain 32 random bytes encoded as base64`);
    return decoded;
}
function url(value, name, dev) {
    let result;
    try {
        result = new URL(value);
    }
    catch {
        invalid(`${name} must be an absolute URL`);
    }
    if (result.username || result.password || result.search || result.hash)
        invalid(`${name} cannot contain credentials, query or fragment`);
    if (result.protocol !== "https:" && !(dev && result.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(result.hostname)))
        invalid(`${name} requires HTTPS`);
    return result;
}
export function loadConfig(env = process.env) {
    const environment = env.APP_ENV ?? "staging";
    if (!["development", "staging", "production"].includes(environment))
        invalid("Invalid APP_ENV");
    if (environment === "production")
        throw gatewayError("PRODUCTION_NOT_IMPLEMENTED", "Cross-tenant installation and authorization lifecycle is not implemented; production is disabled.", 503);
    const development = environment === "development";
    const publicApp = url(env.PUBLIC_APP_URL, "PUBLIC_APP_URL", development);
    const api = url(env.API_PUBLIC_URL, "API_PUBLIC_URL", development);
    if (publicApp.pathname !== "/" || api.pathname !== "/")
        invalid("Public URLs must be origin-only");
    const redirect = url(env.FEISHU_REDIRECT_URI, "FEISHU_REDIRECT_URI", development);
    if (redirect.href !== new URL("/v1/auth/feishu/callback", api).href)
        invalid("OAuth callback must match API_PUBLIC_URL");
    const allowedOrigins = (env.ALLOWED_ORIGINS ?? "").split(",").map(x => x.trim()).filter(Boolean);
    if (!allowedOrigins.length || allowedOrigins.some(x => {
        try {
            const u = new URL(x);
            const native = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"].includes(x);
            const localDevelopment = development && u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
            return x === "*" || (!native && !localDevelopment && u.protocol !== "https:") || u.origin === "null" && !native || u.origin !== "null" && u.origin !== x;
        }
        catch {
            return true;
        }
    }) || !allowedOrigins.includes(publicApp.origin))
        invalid("Explicit ALLOWED_ORIGINS including PUBLIC_APP_URL is required");
    const allowedTenantKeys = (env.FEISHU_ALLOWED_TENANT_KEYS ?? "").split(",").map(x => x.trim()).filter(Boolean);
    if (!allowedTenantKeys.length || allowedTenantKeys.includes("*"))
        invalid("An explicit test tenant allowlist is required");
    if (env.FEISHU_APP_TYPE !== "self_built")
        invalid("Only self_built staging is implemented");
    for (const name of ["FEISHU_APP_ID", "FEISHU_APP_SECRET"])
        if (!env[name] || /example|change.?me|placeholder/i.test(env[name]))
            invalid(`${name} is missing or a placeholder`);
    const encryptionKey = key(env.TOKEN_ENCRYPTION_KEY, "TOKEN_ENCRYPTION_KEY");
    const signingKey = key(env.SESSION_SIGNING_KEY, "SESSION_SIGNING_KEY");
    if (encryptionKey.equals(signingKey))
        invalid("Encryption and session keys must differ");
    const databasePath = (env.DATABASE_URL ?? "").replace(/^file:/, "");
    if (!env.DATABASE_URL?.startsWith("file:") || !isAbsolute(databasePath))
        invalid("DATABASE_URL must name an absolute persistent SQLite file");
    const bindingTtlSeconds = Number(env.BINDING_TTL_SECONDS ?? 300);
    if (!Number.isInteger(bindingTtlSeconds) || bindingTtlSeconds < 30 || bindingTtlSeconds > 300)
        invalid("Binding TTL must be 30 to 300 seconds");
    return Object.freeze({
        environment,
        publicAppUrl: publicApp.origin,
        apiPublicUrl: api.origin,
        allowedOrigins,
        allowedTenantKeys,
        databasePath,
        encryptionKey,
        signingKey,
        feishuAppType: "self_built",
        feishuAppId: env.FEISHU_APP_ID,
        feishuAppSecret: env.FEISHU_APP_SECRET,
        feishuRedirectUri: redirect.href,
        feishuScopes: (env.FEISHU_SCOPES ?? "offline_access bitable:app").split(/[ ,]+/).filter(Boolean),
        bindingTtlSeconds,
        secureCookies: !development,
        sessionTtlSeconds: 86400 * 7,
        maxBodyBytes: 32 * 1024 * 1024,
        port: Number(env.PORT ?? 8787),
        host: env.HOST ?? "127.0.0.1"
    });
}
