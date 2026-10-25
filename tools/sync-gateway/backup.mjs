import { DatabaseSync, backup } from "node:sqlite";
import { openSync, closeSync, chmodSync, rmSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
/** Online SQLite snapshot, including committed WAL pages, without copying files. */
export async function backupGatewayDatabase(source, destination) {
    if (!isAbsolute(source) || !isAbsolute(destination) || resolve(source) === resolve(destination)) {
        throw Error("Source and destination must be distinct absolute paths");
    }
    const db = new DatabaseSync(source, {
        readOnly: true
    });
    let reserved = false;
    try {
        // Exclusive reservation refuses replacement and existing symlinks.
        const file = openSync(destination, "wx", 0o600);
        closeSync(file);
        reserved = true;
        await backup(db, destination);
        chmodSync(destination, 0o600);
        return {
            destination,
            createdAt: new Date().toISOString()
        };
    }
    catch (error) {
        if (reserved)
            rmSync(destination, {
                force: true
            });
        throw error;
    }
    finally {
        db.close();
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [, , source, destination, ...extra] = process.argv;
    if (!source || !destination || extra.length) {
        process.stderr.write("Usage: node backup.mjs /absolute/source.db /absolute/new-backup.db\n");
        process.exitCode = 2;
    }
    else {
        try {
            await backupGatewayDatabase(source, destination);
            process.stdout.write("SQLite coordination backup created. Back up encryption/session keys separately.\n");
        }
        catch {
            process.stderr.write("Backup failed; source was not modified and existing destination was not overwritten.\n");
            process.exitCode = 1;
        }
    }
}
