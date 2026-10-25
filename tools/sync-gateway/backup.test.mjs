import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { GatewayDB } from "./db.mjs";
import { seal, open } from "./crypto.mjs";
import { backupGatewayDatabase } from "./backup.mjs";
test("live-WAL SQLite backup restores durable records, encrypted tokens and environment isolation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gateway-backup-"));
    const source = join(dir, "source.db"), snapshot = join(dir, "backup.db"), key = randomBytes(32);
    let db, restored, other;
    try {
        db = new GatewayDB(source, "staging");
        db.put("accounts", "a", {
            id: "a",
            name: "Owner"
        });
        db.put("tokens", "a", {
            id: "a",
            encrypted: seal({
                accessToken: "never-print"
            }, key, "staging:a")
        });
        await backupGatewayDatabase(source, snapshot);
        db.put("accounts", "later", {
            id: "later"
        });
        restored = new GatewayDB(snapshot, "staging");
        assert.equal(restored.get("accounts", "a").name, "Owner");
        assert.equal(restored.get("accounts", "later"), null);
        assert.equal(open(restored.get("tokens", "a").encrypted, key, "staging:a").accessToken, "never-print");
        assert.ok(!readFileSync(snapshot).includes(Buffer.from("never-print")));
        assert.equal(statSync(snapshot).mode & 511, 384);
        restored.close();
        restored = null;
        other = new GatewayDB(snapshot, "production");
        assert.deepEqual(other.list("accounts"), []);
    }
    finally {
        db?.close();
        restored?.close();
        other?.close();
        rmSync(dir, {
            recursive: true,
            force: true
        });
    }
});
test("backup refuses overwrites, self-copy and missing source without destroying a prior backup", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gateway-backup-"));
    const source = join(dir, "source.db"), snapshot = join(dir, "backup.db");
    const db = new GatewayDB(source, "staging");
    try {
        db.put("accounts", "a", {
            id: "a"
        });
        await backupGatewayDatabase(source, snapshot);
        const before = readFileSync(snapshot);
        await assert.rejects(backupGatewayDatabase(source, snapshot));
        assert.deepEqual(readFileSync(snapshot), before);
        await assert.rejects(backupGatewayDatabase(source, source));
        await assert.rejects(backupGatewayDatabase(join(dir, "missing.db"), join(dir, "new.db")));
    }
    finally {
        db.close();
        rmSync(dir, {
            recursive: true,
            force: true
        });
    }
});
