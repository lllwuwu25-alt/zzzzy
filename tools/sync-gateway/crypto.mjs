import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
export const randomSecret = () => randomBytes(32).toString("base64url");
export const hashSecret = value => createHash("sha256").update(String(value)).digest("hex");
export function equalSecret(a, b) {
    const left = Buffer.from(String(a ?? ""));
    const right = Buffer.from(String(b ?? ""));
    return left.length === right.length && timingSafeEqual(left, right);
}
export function seal(value, key, context) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return {
        version: 1,
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64")
    };
}
export function open(value, key, context) {
    if (value.version !== 1)
        throw Error("Unknown token encryption version");
    const cipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64"));
    cipher.setAAD(Buffer.from(context));
    cipher.setAuthTag(Buffer.from(value.tag, "base64"));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.ciphertext, "base64")), cipher.final()]).toString("utf8"));
}
export function gatewayError(code, message, status = 400, retryable = false) {
    return Object.assign(new Error(message), {
        code,
        status,
        retryable
    });
}
