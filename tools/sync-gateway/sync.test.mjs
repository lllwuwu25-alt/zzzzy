import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
async function fixture(t) {
    const { GatewayDB } = await import('./db.mjs');
    const { SyncService } = await import('./sync.mjs');
    const dir = mkdtempSync(join(tmpdir(), 'feishu-sync-'));
    const db = new GatewayDB(join(dir, 'db'), 'staging');
    t.after(() => {
        db.close();
        rmSync(dir, { recursive: true, force: true });
    });
    const records = new Map();
    let writes = 0;
    let afterWrite = null;
    const provider = {
        async createBase() {
            return { appToken: 'base', url: 'https://example.feishu.cn/base/base' };
        }, async checkAccess() {
            return true;
        },
        async listTables() {
            return [];
        }, async createTable(_l, kind, name) {
            return { id: `table-${kind}`, name, fields: {} };
        }, async ensureFields(_l, _kind, mapping) {
            return { ...mapping, fields: { id: 'id', payload: 'payload' } };
        },
        async findEntity(_l, kind, id) {
            return structuredClone(records.get(`${kind}:${id}`) || null);
        },
        async writeEntity(_l, e) {
            writes++;
            records.set(`${e.kind}:${e.id}`, structuredClone({ ...e, recordId: `rec-${e.id}` }));
            if (afterWrite)
                await afterWrite();
            return structuredClone(records.get(`${e.kind}:${e.id}`));
        },
        async uploadAsset() {
            return { fileToken: 'file-owned' };
        }, async downloadAsset() {
            return { bytes: Buffer.from('image'), mime: 'image/png' };
        }
    };
    const session = { accountId: 'a', deviceId: 'd', status: 'active' };
    db.put('devices', 'd', { id: 'd', accountId: 'a', status: 'active' });
    db.put('accounts', 'a', { id: 'a' });
    const service = new SyncService(db, async () => provider);
    const request = (method, path, body = {}, s = session) => {
        const library = db.get('libraries', s.accountId);
        const scope = { accountId: s.accountId, libraryId: library?.id, environment: 'staging' };
        const url = new URL(`https://api.example${path}`);
        if (method === 'GET' && !url.searchParams.has('scope_account')) {
            url.searchParams.set('scope_account', scope.accountId);
            url.searchParams.set('scope_library', scope.libraryId ?? '');
            url.searchParams.set('scope_environment', scope.environment);
        }
        return service.handle(method, path, url, { syncScope: scope, ...body }, s);
    };
    return {
        db, provider, records, session, service, request, get writes() {
            return writes;
        }, set afterWrite(f) {
            afterWrite = f;
        }
    };
}
const mutation = (overrides = {}) => ({
    mutationId: randomUUID(), entityId: randomUUID(), kind: 'question', baseRevision: 0, payload: { schemaVersion: 1, question: '题目', images: [] }, ...overrides
});
const imageBytes = () => Buffer.from('89504e470d0a1a0a01020304', 'hex');
test('a changed product session cannot route an old account outbox into the new account library', async (t) => {
    const f = await fixture(t);
    await f.request('POST', '/v1/libraries/bootstrap');
    await assert.rejects(f.request('POST', '/v1/sync/push', { syncScope: { environment: 'staging', accountId: 'former-account', libraryId: f.db.get('libraries', 'a').id }, mutations: [mutation()] }), { code: 'SYNC_SCOPE_MISMATCH' });
    assert.equal(f.writes, 1); // Only the bootstrap marker, no leaked question.
});
test('idle changes polling rotates at most three metadata-owned records and detects external edits without a push', async (t) => {
    const f = await fixture(t);
    await f.request('POST', '/v1/libraries/bootstrap');
    const mutations = Array.from({ length: 5 }, () => mutation());
    await f.request('POST', '/v1/sync/push', { mutations });
    const sorted = [...mutations].sort((a, b) => a.entityId.localeCompare(b.entityId));
    let reads = 0;
    const original = f.provider.findEntity;
    f.provider.findEntity = async (...args) => {
        reads++;
        return original(...args);
    };
    await f.request('GET', '/v1/sync/changes?cursor=5');
    assert.equal(reads, 3);
    assert.ok(f.db.get('libraries', 'a').audit.cursor);
    f.records.get(`question:${sorted[4].entityId}`).payload.question = 'external-idle-edit';
    await assert.rejects(f.request('GET', '/v1/sync/changes?cursor=5'), { code: 'REMOTE_ENTITY_CHANGED' });
    assert.equal(f.records.get(`question:${sorted[4].entityId}`).payload.question, 'external-idle-edit');
    assert.ok(!JSON.stringify(f.db.get('libraries', 'a').audit).includes('external-idle-edit'));
});
test('idle polling validates mapped schema every five minutes without recreating deleted fields', async (t) => {
    const f = await fixture(t);
    await f.request('POST', '/v1/libraries/bootstrap');
    let schemaCalls = 0;
    f.provider.checkSchema = async () => {
        schemaCalls++;
        return true;
    };
    await f.request('GET', '/v1/sync/changes?cursor=0');
    assert.equal(schemaCalls, 5);
    await f.request('GET', '/v1/sync/changes?cursor=0');
    assert.equal(schemaCalls, 5);
    const l = f.db.get('libraries', 'a');
    l.audit.lastSchemaAt = Date.now() - 301000;
    f.db.put('libraries', 'a', l);
    f.provider.checkSchema = async () => {
        throw Object.assign(Error('field removed'), { code: 'REMOTE_SCHEMA_CHANGED' });
    };
    await assert.rejects(f.request('GET', '/v1/sync/changes?cursor=0'), { code: 'REMOTE_SCHEMA_CHANGED' });
    assert.equal(f.writes, 1);
});
test('device revocation during precommit reads is rechecked before any business write', async (t) => {
    const f = await fixture(t);
    await f.request('POST', '/v1/libraries/bootstrap');
    let enter, release;
    const entered = new Promise(r => enter = r), wait = new Promise(r => release = r);
    const original = f.provider.findEntity;
    f.provider.findEntity = async (...args) => {
        if (args[1] === 'question') {
            enter();
            await wait;
        }
        return original(...args);
    };
    const pending = f.request('POST', '/v1/sync/push', { mutations: [mutation()] });
    await entered;
    f.db.put('devices', 'd', { id: 'd', accountId: 'a', status: 'revoked' });
    release();
    const result = (await pending).body.results[0];
    assert.equal(result.error.code, 'DEVICE_REVOKED');
    assert.equal(f.writes, 1);
});
test('pending and revoked devices cannot bootstrap or read any business route', async (t) => {
    const f = await fixture(t);
    await assert.rejects(f.request('POST', '/v1/libraries/bootstrap', {}, { ...f.session, status: 'pending_device' }), { code: 'DEVICE_PENDING' });
    f.db.put('devices', 'd', { id: 'd', accountId: 'a', status: 'revoked' });
    await assert.rejects(f.request('GET', '/v1/libraries/current'), { code: 'DEVICE_REVOKED' });
});
test('bootstrap persists five table mappings and is idempotent; client authority is ignored', async (t) => {
    const f = await fixture(t);
    const a = await f.request('POST', '/v1/libraries/bootstrap', { accountId: 'victim' });
    assert.equal(a.body.state, 'ready');
    assert.equal(Object.keys(f.db.get('libraries', 'a').tables).length, 5);
    assert.equal(f.db.get('libraries', 'victim'), null);
    assert.equal((await f.request('POST', '/v1/libraries/bootstrap')).body.id, a.body.id);
});
test('unknown base creation enters durable manual reconciliation, never creates again', async (t) => {
    const f = await fixture(t);
    let calls = 0;
    f.provider.createBase = async () => {
        calls++;
        throw Object.assign(Error('unknown'), { unknownOutcome: true, code: 'REMOTE_OUTCOME_UNKNOWN' });
    };
    await assert.rejects(f.request('POST', '/v1/libraries/bootstrap'));
    await assert.rejects(f.request('POST', '/v1/libraries/bootstrap'), { code: 'BOOTSTRAP_RECONCILIATION_REQUIRED' });
    assert.equal(calls, 1);
});
test('commits are idempotent, conflict retains remote and completed gateway rows contain no question body', async (t) => {
    const f = await fixture(t);
    await f.request('POST', '/v1/libraries/bootstrap');
    const m = mutation();
    const a = (await f.request('POST', '/v1/sync/push', { mutations: [m] })).body.results[0];
    assert.equal(a.status, 'committed');
    assert.equal(a.revision, 1);
    assert.deepEqual((await f.request('POST', '/v1/sync/push', { mutations: [m] })).body.results[0], a);
    assert.equal(f.writes, 2); // config marker plus question
    const conflict = (await f.request('POST', '/v1/sync/push', { mutations: [mutation({ ...m, mutationId: randomUUID(), payload: { schemaVersion: 1, question: 'other', images: [] } })] })).body.results[0];
    assert.equal(conflict.status, 'conflict');
    assert.equal(conflict.current.payload.question, '题目');
    assert.ok(!JSON.stringify(f.db.list('sync_intents')).includes('题目'));
    assert.ok(!JSON.stringify(f.db.list('sync_entities')).includes('题目'));
});
test('crash after Feishu commit reconciles mutation marker and hash without duplicate write', async (t) => {
    const f = await fixture(t);
    await f.request('POST', '/v1/libraries/bootstrap');
    const m = mutation();
    f.afterWrite = () => {
        throw Object.assign(Error('crash'), { unknownOutcome: true });
    };
    const first = (await f.request('POST', '/v1/sync/push', { mutations: [m] })).body.results[0];
    assert.equal(first.status, 'retry');
    f.afterWrite = null;
    const second = (await f.request('POST', '/v1/sync/push', { mutations: [m] })).body.results[0];
    assert.equal(second.status, 'committed');
    assert.equal(f.writes, 2);
    assert.equal(f.db.list('sync_changes').length, 1);
});
test('precommit remote edit is detected and never silently overwritten', async (t) => {
    const f = await fixture(t);
    await f.request('POST', '/v1/libraries/bootstrap');
    const m = mutation();
    await f.request('POST', '/v1/sync/push', { mutations: [m] });
    f.records.get(`question:${m.entityId}`).payload.question = 'manual';
    const r = (await f.request('POST', '/v1/sync/push', { mutations: [mutation({ ...m, mutationId: randomUUID(), baseRevision: 1 })] })).body.results[0];
    assert.equal(r.error.code, 'REMOTE_ENTITY_CHANGED');
    assert.equal(f.writes, 2);
});
test('snapshot highwater replays concurrent tombstone and rejects stale epoch', async (t) => {
    const f = await fixture(t);
    await f.request('POST', '/v1/libraries/bootstrap');
    const a = mutation(), b = mutation();
    await f.request('POST', '/v1/sync/push', { mutations: [a, b] });
    const first = (await f.request('GET', '/v1/sync/snapshot?limit=1')).body;
    assert.equal(first.hasMore, true);
    assert.equal(first.cursor, '2');
    await f.request('POST', '/v1/sync/push', { mutations: [mutation({
                ...a, mutationId: randomUUID(), baseRevision: 1, deletedAt: new Date().toISOString()
            })] });
    const last = (await f.request('GET', `/v1/sync/snapshot?limit=1&page=${encodeURIComponent(first.nextPage)}&epoch=${first.epoch}`)).body;
    assert.equal(last.hasMore, false);
    assert.equal(last.cursor, '2');
    const changes = (await f.request('GET', `/v1/sync/changes?cursor=2&epoch=${first.epoch}`)).body;
    assert.equal(changes.changes[0].revision, 2);
    assert.ok(changes.changes[0].deletedAt);
    await assert.rejects(f.request('GET', '/v1/sync/changes?cursor=0&epoch=wrong'), { code: 'RESET_REQUIRED' });
});
test('immutable owned assets must be ready before question publication and download never trusts file token', async (t) => {
    const f = await fixture(t);
    await f.request('POST', '/v1/libraries/bootstrap');
    const m = mutation(), id = randomUUID();
    m.payload.images = [{ assetId: id, editor: { rotation: 90 } }];
    assert.equal((await f.request('POST', '/v1/sync/push', { mutations: [m] })).body.results[0].error.code, 'ATTACHMENT_PENDING');
    const bytes = imageBytes(), sha256 = createHash('sha256').update(bytes).digest('hex');
    const asset = (await f.request('POST', '/v1/assets/upload', {
        assetId: id, questionId: m.entityId, name: 'image.png', mime: 'image/png', dataBase64: bytes.toString('base64'), sha256
    })).body;
    assert.equal(asset.id, id);
    assert.equal(asset.fileToken, undefined);
    assert.equal((await f.request('POST', '/v1/sync/push', { mutations: [m] })).body.results[0].status, 'committed');
    const download = await f.request('GET', `/v1/assets/${id}/content?fileToken=attacker`);
    assert.equal(download.bytes.toString(), 'image');
    const other = { accountId: 'b', deviceId: 'b', status: 'active' };
    f.db.put('devices', 'b', { ...other, id: 'b' });
    await assert.rejects(f.request('GET', `/v1/assets/${id}/content`, {}, other));
});
test('only versioned business payload fields are accepted, never nested credentials or device preferences', async (t) => {
    const f = await fixture(t);
    await f.request('POST', '/v1/libraries/bootstrap');
    for (const payload of [{ schemaVersion: 2, question: 'bad', images: [] }, { schemaVersion: 1, arbitraryBusiness: 'bad', images: [] }, { schemaVersion: 1, note: { apiKey: 'secret' }, images: [] }, { schemaVersion: 1, question: 'a'.repeat(17000), images: [] }]) {
        const r = (await f.request('POST', '/v1/sync/push', { mutations: [mutation({ payload })] })).body.results[0];
        assert.equal(r.status, 'failed');
    }
    assert.equal(f.writes, 1);
});
test('question publication verifies remotely owned attachment has not been replaced', async (t) => {
    const f = await fixture(t);
    await f.request('POST', '/v1/libraries/bootstrap');
    const m = mutation(), id = randomUUID(), bytes = imageBytes();
    await f.request('POST', '/v1/assets/upload', {
        assetId: id, questionId: m.entityId, name: 'image.png', mime: 'image/png', dataBase64: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex')
    });
    f.records.get(`asset:${id}`).fileToken = 'external-replacement';
    m.payload.images = [{ assetId: id }];
    const r = (await f.request('POST', '/v1/sync/push', { mutations: [m] })).body.results[0];
    assert.equal(r.error.code, 'REMOTE_ENTITY_CHANGED');
});
test('asset upload preserves existing editor payload and keeps file token server-only', async (t) => {
    const f = await fixture(t);
    await f.request('POST', '/v1/libraries/bootstrap');
    const bytes = imageBytes(), editor = {
        schemaVersion: 1, questionId: randomUUID(), localImageId: 'image-not-uuid', order: 0, rotation: 90, annotations: [{
                id: 'a', type: 'rect', x: 1, y: 2, width: 3, height: 4
            }], editorVersion: 2, sourceWidth: 100, sourceHeight: 200, status: 'pending'
    };
    const a = (await f.request('POST', '/v1/assets/upload', {
        assetId: randomUUID(), questionId: editor.questionId, name: 'image.png', mime: 'image/png', dataBase64: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex'), editor
    })).body;
    assert.equal(a.payload.localImageId, 'image-not-uuid');
    assert.deepEqual(a.payload.annotations, editor.annotations);
    assert.equal(a.payload.status, 'ready');
    assert.equal(a.payload.fileToken, undefined);
});
test('same UUID mutation with changed content is rejected and concurrent base revisions conflict', async (t) => {
    const f = await fixture(t);
    await f.request('POST', '/v1/libraries/bootstrap');
    const a = mutation(), b = mutation({ ...a, mutationId: randomUUID() });
    const results = await Promise.all([f.request('POST', '/v1/sync/push', { mutations: [a] }), f.request('POST', '/v1/sync/push', { mutations: [b] })]);
    assert.deepEqual(results.map(x => x.body.results[0].status), ['committed', 'conflict']);
    const replay = (await f.request('POST', '/v1/sync/push', { mutations: [{ ...a, payload: { schemaVersion: 1, question: 'changed', images: [] } }] })).body.results[0];
    assert.equal(replay.error.code, 'MUTATION_REUSED');
});
test('client cannot overwrite the bootstrap config marker or upload device settings', async (t) => {
    const f = await fixture(t);
    const l = (await f.request('POST', '/v1/libraries/bootstrap')).body;
    const results = (await f.request('POST', '/v1/sync/push', { mutations: [mutation({ kind: 'config', entityId: l.id, payload: { schemaVersion: 1, key: 'review-settings', reviewSettings: {} } }), mutation({ kind: 'config', payload: { schemaVersion: 1, key: 'review-settings', reviewSettings: { theme: 'dark' } } })] })).body.results;
    assert.ok(results.every(x => x.status === 'failed'));
    assert.equal(results[0].error.code, 'CONFIG_NOT_ALLOWED');
});
test('partial review group remains durable until matching schedule publication, event is append-only', async (t) => {
    const f = await fixture(t);
    await f.request('POST', '/v1/libraries/bootstrap');
    const q = mutation({ payload: {
            schemaVersion: 1, question: 'q', images: [], schedule: { reps: 0 }
        } });
    await f.request('POST', '/v1/sync/push', { mutations: [q] });
    const event = mutation({ kind: 'review', payload: {
            schemaVersion: 1, questionId: q.entityId, deviceId: 'd', algorithmVersion: 'mistake-fsrs-v1', eventBaseRevision: 1, after: { reps: 1 }
        } });
    await f.request('POST', '/v1/sync/push', { mutations: [event] });
    assert.equal(f.db.list('sync_review_groups')[0].state, 'schedule_pending');
    await f.request('POST', '/v1/sync/push', { mutations: [mutation({
                ...q, mutationId: randomUUID(), baseRevision: 1, payload: { ...q.payload, schedule: { reps: 1 } }
            })] });
    assert.equal(f.db.list('sync_review_groups')[0].state, 'complete');
    const update = (await f.request('POST', '/v1/sync/push', { mutations: [mutation({ ...event, mutationId: randomUUID(), baseRevision: 1 })] })).body.results[0];
    assert.equal(update.error.code, 'REVIEW_APPEND_ONLY');
});
test('existing custom review intervals roundtrip unchanged and undo retains event fact in a tombstone', async (t) => {
    const f = await fixture(t);
    await f.request('POST', '/v1/libraries/bootstrap');
    const config = mutation({ kind: 'config', payload: { schemaVersion: 1, key: 'review-settings', reviewSettings: { mode: 'custom', intervals: {
                    again: 1, hard: 2, good: 4, easy: 7
                } } } });
    assert.equal((await f.request('POST', '/v1/sync/push', { mutations: [config] })).body.results[0].status, 'committed');
    const r = mutation({ kind: 'review', payload: {
            schemaVersion: 1, questionId: randomUUID(), localId: 'r', after: { reps: 1 }
        } });
    await f.request('POST', '/v1/sync/push', { mutations: [r] });
    const undo = mutation({
        ...r, mutationId: randomUUID(), baseRevision: 1, deletedAt: new Date().toISOString()
    });
    assert.equal((await f.request('POST', '/v1/sync/push', { mutations: [undo] })).body.results[0].status, 'committed');
    assert.deepEqual(f.records.get(`review:${r.entityId}`).payload, r.payload);
    assert.equal(f.db.list('sync_review_groups')[0].state, 'schedule_pending');
    assert.equal(f.db.list('sync_review_groups')[0].cancelled, true);
});
test('upload sniffs original image formats including BMP and rejects spoofed MIME before remote transfer', async (t) => {
    const f = await fixture(t);
    await f.request('POST', '/v1/libraries/bootstrap');
    const upload = async (bytes, mime) => f.request('POST', '/v1/assets/upload', {
        assetId: randomUUID(), questionId: randomUUID(), name: 'original', mime, dataBase64: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex')
    });
    await assert.rejects(upload(Buffer.from('<script>bad</script>'), 'image/png'), { code: 'INVALID_IMAGE_FORMAT' });
    assert.equal((await upload(Buffer.from('424d000000000000000000000000', 'hex'), 'image/bmp')).body.payload.mime, 'image/bmp');
});
test('remote success followed by local bookkeeping failure remains retryable and a fresh coordinator repairs it', async (t) => {
    const f = await fixture(t);
    await f.request('POST', '/v1/libraries/bootstrap');
    const originalPut = f.db.put.bind(f.db);
    let failOnce = true;
    f.db.put = (ns, id, value) => {
        if (ns === 'sync_changes' && failOnce) {
            failOnce = false;
            throw Error('disk temporary failure');
        }
        return originalPut(ns, id, value);
    };
    const m = mutation();
    const first = (await f.request('POST', '/v1/sync/push', { mutations: [m] })).body.results[0];
    assert.equal(first.status, 'retry');
    const { SyncService } = await import('./sync.mjs');
    const fresh = new SyncService(f.db, async () => f.provider);
    const second = await fresh.handle('POST', '/v1/sync/push', new URL('https://api.example/v1/sync/push'), { syncScope: { accountId: 'a', libraryId: f.db.get('libraries', 'a').id, environment: 'staging' }, mutations: [m] }, f.session);
    assert.equal(second.body.results[0].status, 'committed');
    assert.equal(f.writes, 2);
    assert.equal(f.db.list('sync_changes').length, 1);
});
