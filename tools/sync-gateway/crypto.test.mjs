import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { seal, open, hashSecret, randomSecret } from "./crypto.mjs";
test("credentials use authenticated encryption and hashes do not expose opaque secrets", () => {
    const key = randomBytes(32);
    const encrypted = seal({
        accessToken: "secret-token"
    }, key, "staging:account-a");
    assert.ok(!JSON.stringify(encrypted).includes("secret-token"));
    assert.deepEqual(open(encrypted, key, "staging:account-a"), {
        accessToken: "secret-token"
    });
    assert.throws(() => open(encrypted, key, "production:account-a"));
    assert.throws(() => open({
        ...encrypted,
        ciphertext: Buffer.from("bad").toString("base64")
    }, key, "staging:account-a"));
    const token = randomSecret();
    assert.ok(token.length >= 32);
    assert.notEqual(hashSecret(token), token);
});
