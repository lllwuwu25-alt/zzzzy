import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GatewayDB } from "./db.mjs";
test("SQLite persists coordination state, isolates environments and rolls back partial transactions", () => {
    const dir = mkdtempSync(join(tmpdir(), "gateway-db-"));
    const file = join(dir, "test.db");
    try {
        let db = new GatewayDB(file, "staging");
        db.put("accounts", "a", {
            id: "a",
            name: "Alice"
        });
        assert.throws(() => db.transaction(() => {
            db.put("accounts", "b", {
                id: "b"
            });
            throw Error("abort");
        }));
        assert.equal(db.get("accounts", "b"), null);
        db.close();
        db = new GatewayDB(file, "staging");
        assert.equal(db.get("accounts", "a").name, "Alice");
        db.close();
        const other = new GatewayDB(file, "production");
        assert.deepEqual(other.list("accounts"), []);
        other.close();
    }
    finally {
        rmSync(dir, {
            recursive: true,
            force: true
        });
    }
});
