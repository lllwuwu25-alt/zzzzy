import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { loadConfig } from "./config.mjs";
export function testEnv() {
    return {
        APP_ENV: "staging",
        PUBLIC_APP_URL: "https://app.example.test",
        API_PUBLIC_URL: "https://api.example.test",
        ALLOWED_ORIGINS: "https://app.example.test,tauri://localhost",
        DATABASE_URL: "file:/tmp/gateway-test.sqlite",
        FEISHU_APP_TYPE: "self_built",
        FEISHU_APP_ID: "cli_test",
        FEISHU_APP_SECRET: randomBytes(24).toString("hex"),
        FEISHU_REDIRECT_URI: "https://api.example.test/v1/auth/feishu/callback",
        FEISHU_ALLOWED_TENANT_KEYS: "tenant-a",
        TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
        SESSION_SIGNING_KEY: randomBytes(32).toString("base64")
    };
}
test("configuration fails closed for credentials, tenant allowlist, insecure URLs, weak/shared keys and unimplemented production", () => {
    const env = testEnv();
    assert.equal(loadConfig(env).environment, "staging");
    for (const change of [{
            FEISHU_APP_SECRET: ""
        }, {
            FEISHU_ALLOWED_TENANT_KEYS: ""
        }, {
            PUBLIC_APP_URL: "http://app.example.test"
        }, {
            ALLOWED_ORIGINS: "*"
        }, {
            ALLOWED_ORIGINS: "https://app.example.test,http://insecure.example.test"
        }, {
            TOKEN_ENCRYPTION_KEY: "example"
        }, {
            SESSION_SIGNING_KEY: env.TOKEN_ENCRYPTION_KEY
        }, {
            FEISHU_REDIRECT_URI: "https://evil.test/callback"
        }, {
            APP_ENV: "production"
        }])
        assert.throws(() => loadConfig({
            ...env,
            ...change
        }));
});
