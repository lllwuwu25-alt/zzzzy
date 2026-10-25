import { DatabaseSync } from "node:sqlite";
import { readFileSync, chmodSync } from "node:fs";
export class GatewayDB {
    constructor(path, environment) {
        if (!["development", "staging", "production"].includes(environment))
            throw Error("Invalid database environment");
        this.environment = environment;
        this.sqlite = new DatabaseSync(path);
        if (path !== ":memory:")
            chmodSync(path, 0o600);
        this.sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
        this.sqlite.exec(readFileSync(new URL("./migrations/001-coordination.sql", import.meta.url), "utf8"));
    }
    get(namespace, id) {
        const row = this.sqlite.prepare("SELECT value FROM gateway_records WHERE environment=? AND namespace=? AND id=?").get(this.environment, namespace, id);
        return row ? JSON.parse(row.value) : null;
    }
    put(namespace, id, value) {
        this.sqlite.prepare("INSERT INTO gateway_records(environment,namespace,id,value) VALUES(?,?,?,?) ON CONFLICT(environment,namespace,id) DO UPDATE SET value=excluded.value").run(this.environment, namespace, id, JSON.stringify(value));
    }
    list(namespace) {
        return this.sqlite.prepare("SELECT value FROM gateway_records WHERE environment=? AND namespace=? ORDER BY id").all(this.environment, namespace).map(x => JSON.parse(x.value));
    }
    remove(namespace, id) {
        this.sqlite.prepare("DELETE FROM gateway_records WHERE environment=? AND namespace=? AND id=?").run(this.environment, namespace, id);
    }
    transaction(fn) {
        this.sqlite.exec("BEGIN IMMEDIATE");
        try {
            const result = fn();
            if (result?.then)
                throw Error("SQLite transaction callback must be synchronous");
            this.sqlite.exec("COMMIT");
            return result;
        }
        catch (error) {
            this.sqlite.exec("ROLLBACK");
            throw error;
        }
    }
    close() {
        this.sqlite.close();
    }
}
