import { randomUUID } from "node:crypto";
import { randomSecret, hashSecret, equalSecret, gatewayError } from "./crypto.mjs";
const fail = (code, message) => {
    throw gatewayError(code, message, 403);
};
export class DeviceBindings {
    constructor(config, db, now = Date.now) {
        this.config = config;
        this.db = db;
        this.now = now;
    }
    active(session) {
        const device = this.db.get("devices", session.deviceId);
        if (!device || device.status !== "active" || device.accountId !== session.accountId)
            fail("DEVICE_PENDING", "请先由已激活设备确认此设备。");
    }
    validateIntent(id, token) {
        const b = this.db.get("bindings", id);
        const initiator = b && this.db.get("devices", b.initiatorDeviceId);
        if (!b || b.expiresAt <= this.now() || !["created", "claimed"].includes(b.status) || !equalSecret(b.tokenHash, hashSecret(token)) || initiator?.status !== "active" || initiator?.accountId !== b.accountId)
            fail("BINDING_INVALID", "绑定已失效，请重新生成二维码。");
        return b;
    }
    create(session) {
        this.active(session);
        const library = this.db.get("libraries", session.accountId);
        if (!library || !(library.state === "ready" || library.status === "ready"))
            throw gatewayError("BOOTSTRAP_INCOMPLETE", "请先完成题库初始化。", 409);
        const token = randomSecret();
        const id = randomUUID();
        const b = {
            id,
            accountId: session.accountId,
            initiatorDeviceId: session.deviceId,
            tokenHash: hashSecret(token),
            createdAt: this.now(),
            expiresAt: this.now() + this.config.bindingTtlSeconds * 1000,
            status: "created"
        };
        this.db.transaction(() => {
            for (const old of this.db.list("bindings").filter(x => x.initiatorDeviceId === session.deviceId && ["created", "claimed"].includes(x.status)))
                this.db.put("bindings", old.id, {
                    ...old,
                    status: "cancelled"
                });
            this.db.put("bindings", id, b);
        });
        return {
            bindingId: id,
            token,
            expiresAt: b.expiresAt,
            url: `${this.config.publicAppUrl}/?bind=${encodeURIComponent(id)}#token=${encodeURIComponent(token)}`
        };
    }
    claim(session, id, token) {
        const b = this.validateIntent(id, token);
        if (b.accountId !== session.accountId)
            fail("BINDING_IDENTITY_MISMATCH", "请使用同一飞书身份。");
        if (b.initiatorDeviceId === session.deviceId)
            fail("BINDING_INVALID", "请在另一设备打开此绑定链接。");
        const pending = this.db.get("devices", session.deviceId);
        if (pending?.status !== "pending_device")
            fail("BINDING_INVALID", "此设备无需再次绑定。");
        if (b.pendingDeviceId && b.pendingDeviceId !== session.deviceId)
            fail("BINDING_INVALID", "此二维码已由另一设备认领。");
        this.db.put("bindings", id, {
            ...b,
            status: "claimed",
            pendingDeviceId: session.deviceId
        });
        return {
            bindingId: id,
            status: "claimed"
        };
    }
    confirm(session, id, pendingDeviceId) {
        this.active(session);
        const b = this.db.get("bindings", id);
        if (!b || b.status !== "claimed" || b.expiresAt <= this.now() || b.accountId !== session.accountId || b.initiatorDeviceId !== session.deviceId || b.pendingDeviceId !== pendingDeviceId)
            fail("BINDING_INVALID", "绑定请求已失效或不属于此设备。");
        const pending = this.db.get("devices", pendingDeviceId);
        if (!pending || pending.accountId !== session.accountId || pending.status !== "pending_device")
            fail("BINDING_INVALID", "待加入设备状态不正确。");
        this.db.transaction(() => {
            this.db.put("devices", pending.id, {
                ...pending,
                status: "active",
                activatedAt: this.now()
            });
            this.db.put("bindings", id, {
                ...b,
                status: "consumed",
                consumedAt: this.now()
            });
            this.db.put("security_events", randomUUID(), {
                kind: "device_approved",
                accountId: session.accountId,
                deviceId: pending.id,
                at: this.now()
            });
        });
        return {
            bindingId: id,
            status: "consumed"
        };
    }
    cancel(session, id) {
        const b = this.db.get("bindings", id);
        if (!b || b.accountId !== session.accountId || !(b.initiatorDeviceId === session.deviceId || b.pendingDeviceId === session.deviceId))
            fail("BINDING_INVALID", "无权取消此绑定。");
        this.db.put("bindings", id, {
            ...b,
            status: "cancelled"
        });
        return {
            status: "cancelled"
        };
    }
    list(session) {
        const active = session.status === "active";
        return this.db.list("bindings").filter(x => x.accountId === session.accountId && (active ? x.initiatorDeviceId === session.deviceId : x.pendingDeviceId === session.deviceId) && x.expiresAt > this.now() && ["created", "claimed"].includes(x.status)).map(x => ({
            bindingId: x.id,
            status: x.status,
            expiresAt: x.expiresAt,
            pendingDeviceId: x.pendingDeviceId,
            pendingDeviceName: x.pendingDeviceId ? this.db.get("devices", x.pendingDeviceId)?.name : undefined
        }));
    }
}
