import { createHash, randomUUID } from 'node:crypto';
import { GatewayError, TABLES } from './feishu.mjs';
const MAX_PAYLOAD_BYTES = 16 * 1024, MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const now = () => new Date().toISOString();
const error = (code, message, status = 409, retryable = false) => new GatewayError(code, message, status, retryable);
function canonical(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(canonical).join(',')}]`;
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const hashEntity = e => digest({
    kind: e.kind, id: e.id, payload: e.payload, deletedAt: e.deletedAt || null
});
function sniffImage(bytes) {
    if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
        return 'image/png';
    if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
        return 'image/jpeg';
    if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii')))
        return 'image/gif';
    if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP')
        return 'image/webp';
    if (bytes.length >= 14 && bytes.subarray(0, 2).toString('ascii') === 'BM')
        return 'image/bmp';
    return null;
}
const publicEntity = e => ({
    kind: e.kind, id: e.id, revision: e.revision, payload: e.payload, ...(e.deletedAt ? { deletedAt: e.deletedAt } : {})
});
const publicLibrary = l => l ? {
    id: l.id, name: l.name, url: l.url || null, epoch: l.epoch, state: l.state, stage: l.stage || null
} : null;
const key = (library, ...parts) => [library.id, ...parts].join(':');
const PAYLOAD_KEYS = {
    question: ['schemaVersion', 'localId', 'status', 'exam', 'subject', 'chapter', 'question', 'questionType', 'answer', 'choice', 'fillBlank', 'shortAnswer', 'recognition', 'diagrams', 'cause', 'note', 'tags', 'images', 'createdAt', 'updatedAt', 'deletedAt', 'schedule', 'sourceQuestionId'],
    review: ['schemaVersion', 'localId', 'questionId', 'deviceId', 'algorithmVersion', 'eventBaseRevision', 'rating', 'answerText', 'reviewedAt', 'durationSeconds', 'before', 'after'],
    asset: ['schemaVersion', 'questionId', 'localImageId', 'name', 'mime', 'order', 'rotation', 'crop', 'annotations', 'editorVersion', 'sourceWidth', 'sourceHeight', 'recognizedText', 'recognizedAt', 'sha256', 'size', 'originalAssetId', 'status'],
    collection: ['schemaVersion', 'localKey', 'entityType', 'name', 'parentId', 'order'],
    config: ['schemaVersion', 'key', 'reviewSettings', 'protocolVersion', 'libraryId', 'application', 'bootstrapTaskId']
};
function validatePayload(payload, kind) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        throw error('INVALID_PAYLOAD', '同步内容必须是单条业务对象', 400);
    if (payload.schemaVersion !== 1 || Object.keys(payload).some(k => !PAYLOAD_KEYS[kind].includes(k)))
        throw error('INVALID_PAYLOAD', '同步内容协议或业务字段不匹配', 400);
    let count = 0;
    function walk(v, depth = 0) {
        if (depth > 20 || ++count > 10000)
            throw error('INVALID_PAYLOAD', '同步内容结构过于复杂', 400);
        if (v === null || typeof v === 'boolean')
            return;
        if (typeof v === 'number') {
            if (!Number.isFinite(v))
                throw error('INVALID_PAYLOAD', '同步内容含无效数值', 400);
            return;
        }
        if (typeof v === 'string') {
            if (/^(data:|blob:|file:|https?:\/\/localhost(?:[:/]|$)|[A-Za-z]:\\|\/Users\/|\/home\/)/i.test(v))
                throw error('LOCAL_RESOURCE_FORBIDDEN', '同步内容不能包含本地图片或文件路径', 400);
            return;
        }
        if (typeof v !== 'object')
            throw error('INVALID_PAYLOAD', '同步内容不是有限 JSON', 400);
        if (Array.isArray(v)) {
            for (const x of v)
                walk(x, depth + 1);
            return;
        }
        for (const [k, x] of Object.entries(v)) {
            if (/(?:api.?key|secret|password|token|license|authorization|dataurl|databaseurl|workspacepath|cachedir|endpoint|gatewayurl)/i.test(k) || ['__proto__', 'constructor', 'prototype', 'entireNotebook', 'notebook', 'settings'].includes(k))
                throw error('SENSITIVE_FIELD_FORBIDDEN', '同步内容包含不允许的配置字段', 400);
            walk(x, depth + 1);
        }
    }
    walk(payload);
    if (Buffer.byteLength(canonical(payload)) > MAX_PAYLOAD_BYTES)
        throw error('PAYLOAD_TOO_LARGE', '单条云记录超过 16 KiB 安全限制，请缩小内容后重试', 413);
    if (kind === 'config' && (payload.key !== 'review-settings' || Object.keys(payload).some(k => !['schemaVersion', 'key', 'reviewSettings'].includes(k))))
        throw error('CONFIG_NOT_ALLOWED', '只允许同步白名单学习配置', 400);
    if (kind === 'config' && payload.reviewSettings) {
        const s = payload.reviewSettings;
        if (Object.keys(s).some(k => !['mode', 'intervals'].includes(k)) || !['adaptive', 'custom'].includes(s.mode) || !s.intervals || Object.keys(s.intervals).length !== 4 || ['again', 'hard', 'good', 'easy'].some(k => !Number.isFinite(s.intervals[k]) || s.intervals[k] <= 0 || s.intervals[k] > 36500))
            throw error('CONFIG_NOT_ALLOWED', '学习配置包含未获准的设备偏好或无效间隔', 400);
    }
    if (kind === 'question' && payload.images !== undefined) {
        if (!Array.isArray(payload.images) || payload.images.length > 100)
            throw error('INVALID_PAYLOAD', '图片引用列表无效', 400);
        for (const image of payload.images)
            if (!image || !UUID.test(image.assetId || ''))
                throw error('INVALID_PAYLOAD', '题目必须使用稳定图片资产引用', 400);
    }
}
function validateMutation(m) {
    if (!m || !UUID.test(m.mutationId || '') || !UUID.test(m.entityId || '') || !Object.hasOwn(TABLES, m.kind) || m.kind === 'asset' || !Number.isSafeInteger(m.baseRevision) || m.baseRevision < 0 || m.baseRevision >= Number.MAX_SAFE_INTEGER)
        throw error('INVALID_MUTATION', '同步操作标识、类型或版本无效', 400);
    validatePayload(m.payload, m.kind);
    if (m.deletedAt !== undefined && (!Number.isFinite(Date.parse(m.deletedAt)) || typeof m.deletedAt !== 'string'))
        throw error('INVALID_MUTATION', '删除时间无效', 400);
}
function pageLimit(url) {
    const x = Number(url.searchParams.get('limit') || 100);
    if (!Number.isSafeInteger(x) || x < 1 || x > 200)
        throw error('INVALID_PAGE', '每页数量必须为 1 到 200', 400);
    return x;
}
/** Single-instance durable coordinator. No business payload or image is persisted here.
 * Incomplete intents contain hashes/markers only; the client's durable outbox supplies retry
 * payloads. This intentionally avoids keeping unencrypted business copies in gateway SQLite.
 */
export class SyncService {
    constructor(db, providerForAccount) {
        this.db = db;
        this.providerForAccount = providerForAccount;
        this.locks = new Map();
    }
    async serial(id, fn) {
        const previous = this.locks.get(id) || Promise.resolve();
        let release;
        const gate = new Promise(resolve => {
            release = resolve;
        });
        const waiting = previous.catch(() => {
        }).then(() => gate);
        this.locks.set(id, waiting);
        await previous.catch(() => {
        });
        try {
            return await fn();
        }
        finally {
            release();
            if (this.locks.get(id) === waiting)
                this.locks.delete(id);
        }
    }
    admit(session) {
        if (!session?.accountId || !session.deviceId)
            throw error('AUTH_REQUIRED', '请先登录', 401);
        if (session.status !== 'active')
            throw error('DEVICE_PENDING', '请在已绑定设备确认后继续', 403);
        const device = this.db.get('devices', session.deviceId);
        if (!device || device.accountId !== session.accountId || device.status !== 'active' || device.revokedAt)
            throw error('DEVICE_REVOKED', '此设备已解除绑定，请重新登录', 403);
        const account = this.db.get('accounts', session.accountId);
        if (account?.disconnectedAt || account?.connectionStatus === 'disconnected')
            throw error('REAUTH_REQUIRED', '飞书已断开，请重新连接', 401);
    }
    library(accountId, ready = true) {
        const l = this.db.get('libraries', accountId);
        if (!l || l.accountId !== accountId)
            throw error('BOOTSTRAP_INCOMPLETE', '请先创建或恢复自己的题库');
        if (ready && l.state !== 'ready')
            throw error('BOOTSTRAP_INCOMPLETE', '题库初始化尚未完成');
        return l;
    }
    async handle(method, path, url, body, session) {
        const route = path.split('?')[0];
        if (!route.startsWith('/v1/libraries/') && !route.startsWith('/v1/sync/') && !route.startsWith('/v1/assets/'))
            return null;
        this.admit(session);
        const accountId = session.accountId;
        // Scope is an anti-race assertion, never authority: resources still derive from the session.
        // A browser/native session may change while an older client's queue is in flight.
        if (route.startsWith('/v1/sync/') || route === '/v1/assets/upload') {
            const library = this.db.get('libraries', accountId);
            if (library) {
                const scope = method === 'GET' ? { accountId: url.searchParams.get('scope_account'), libraryId: url.searchParams.get('scope_library'), environment: url.searchParams.get('scope_environment') } : body?.syncScope;
                if (!scope || scope.accountId !== accountId || scope.libraryId !== library.id || scope.environment !== this.db.environment) throw error('SYNC_SCOPE_MISMATCH', '登录账号或题库已改变，已停止旧空间的同步。', 409);
            }
        }
        if (method === 'GET' && route === '/v1/libraries/current')
            return { body: { library: publicLibrary(this.db.get('libraries', accountId)) } };
        return this.serial(accountId, async () => {
            this.admit(session);
            const provider = await this.providerForAccount(accountId);
            if (method === 'POST' && route === '/v1/libraries/bootstrap')
                return { body: await this.bootstrap(accountId, provider) };
            const library = this.library(accountId);
            if (method === 'POST' && route === '/v1/sync/push') {
                if (!Array.isArray(body?.mutations) || body.mutations.length > 100)
                    throw error('INVALID_MUTATIONS', '一次最多提交 100 个业务操作', 400);
                const results = [];
                for (const m of body.mutations) {
                    this.admit(session);
                    try {
                        validateMutation(m);
                        results.push(await this.commit(library, provider, m, session));
                    }
                    catch (e) {
                        results.push({ mutationId: m?.mutationId, status: e.retryable || e.unknownOutcome ? 'retry' : 'failed', error: this.describe(e) });
                    }
                }
                return { body: { results } };
            }
            if (method === 'GET' && route === '/v1/sync/changes') {
                const response = await this.changes(library, provider, url);
                this.admit(session);
                return { body: response };
            }
            if (method === 'GET' && route === '/v1/sync/snapshot') {
                const response = await this.snapshot(library, provider, url);
                this.admit(session);
                return { body: response };
            }
            if (method === 'POST' && route === '/v1/assets/upload')
                return { body: await this.upload(library, provider, body, session) };
            const assetMatch = route.match(/^\/v1\/assets\/([^/]+)\/content$/);
            if (method === 'GET' && assetMatch) {
                const id = decodeURIComponent(assetMatch[1]);
                if (!UUID.test(id))
                    throw error('ASSET_NOT_FOUND', '图片不存在', 404);
                const meta = this.db.get('sync_entities', key(library, 'asset', id));
                if (!meta || meta.deletedAt)
                    throw error('ASSET_NOT_FOUND', '图片不属于当前题库', 404);
                const remote = await this.read(library, provider, meta);
                if (!remote.fileToken)
                    throw error('ATTACHMENT_PENDING', '图片尚未就绪');
                const result = await provider.downloadAsset(library, remote);
                this.admit(session);
                return { bytes: result.bytes, headers: {
                        'Content-Type': result.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline'
                    } };
            }
            return null;
        });
    }
    describe(e) {
        return { code: e?.code || 'SYNC_FAILED', message: e instanceof GatewayError ? e.message : '同步暂时无法完成，已保留本地修改', retryable: Boolean(e?.retryable || e?.unknownOutcome) };
    }
    saveLibrary(library) {
        this.db.put('libraries', library.accountId, library);
    }
    async bootstrap(accountId, provider) {
        let l = this.db.get('libraries', accountId);
        if (l && l.accountId !== accountId)
            throw error('LIBRARY_ACCESS_DENIED', '题库归属不匹配', 403);
        if (l?.state === 'ready') {
            await provider.checkAccess(l);
            return publicLibrary(l);
        }
        if (l?.state === 'reconciliation_required' && !l.appToken)
            throw error('BOOTSTRAP_RECONCILIATION_REQUIRED', '建库结果未知，需要部署者核对候选资源，不能自动重建');
        if (!l) {
            l = {
                id: randomUUID(), accountId, name: '错题本 · 我的题库', epoch: randomUUID(), state: 'initializing', stage: 'base_intent', bootstrapTaskId: randomUUID(), tables: {}, tableStages: {}, sequence: 0, createdAt: now()
            };
            this.saveLibrary(l);
        }
        if (!l.appToken) {
            // A persisted base_intent after process death is ambiguous. Never blind-create twice.
            if (l.baseAttempted) {
                l.state = 'reconciliation_required';
                this.saveLibrary(l);
                throw error('BOOTSTRAP_RECONCILIATION_REQUIRED', '上次建库结果未知，请由部署者核对');
            }
            l.baseAttempted = true;
            this.saveLibrary(l);
            try {
                Object.assign(l, await provider.createBase(`${l.name} · ${l.id}`));
                l.stage = 'tables';
                this.saveLibrary(l);
            }
            catch (e) {
                if (e.unknownOutcome) {
                    l.state = 'reconciliation_required';
                    l.stage = 'base_unknown';
                }
                else {
                    l.baseAttempted = false;
                    l.stage = 'base_rejected';
                }
                this.saveLibrary(l);
                throw e;
            }
        }
        await provider.checkAccess(l);
        for (const [kind, name] of Object.entries(TABLES)) {
            if (!l.tables[kind]) {
                if (l.tableStages[kind] === 'creating') {
                    const recovered = provider.findTable ? await provider.findTable(l, kind) : null;
                    if (!recovered)
                        throw error('BOOTSTRAP_RECONCILIATION_REQUIRED', '数据表创建结果未知，请核对后继续');
                    l.tables[kind] = recovered;
                    this.saveLibrary(l);
                }
                else {
                    l.tableStages[kind] = 'creating';
                    l.stage = `table_${kind}`;
                    this.saveLibrary(l);
                    try {
                        l.tables[kind] = await provider.createTable(l, kind, name);
                        this.saveLibrary(l);
                    }
                    catch (e) {
                        if (!e.unknownOutcome)
                            l.tableStages[kind] = 'retry';
                        this.saveLibrary(l);
                        throw e;
                    }
                }
            }
            l.tables[kind] = await provider.ensureFields(l, kind, l.tables[kind]);
            l.tableStages[kind] = 'ready';
            this.saveLibrary(l);
        }
        l.stage = 'marker';
        this.saveLibrary(l);
        const marker = {
            kind: 'config', id: l.id, revision: 1, lastMutationId: l.bootstrapTaskId, payload: {
                schemaVersion: 1, protocolVersion: 1, libraryId: l.id, application: 'mistake-notebook', bootstrapTaskId: l.bootstrapTaskId
            }, createdAt: l.createdAt, updatedAt: now()
        };
        marker.contentHash = hashEntity(marker);
        const current = await provider.findEntity(l, 'config', l.id);
        if (current) {
            if (current.lastMutationId !== l.bootstrapTaskId || hashEntity(current) !== marker.contentHash)
                throw error('LIBRARY_MARKER_MISMATCH', '云端题库标识不匹配，停止初始化');
        }
        else {
            await provider.writeEntity(l, marker, null);
        }
        if (provider.checkManagement)
            await provider.checkManagement(l);
        l.state = 'ready';
        l.stage = 'complete';
        this.saveLibrary(l);
        return publicLibrary(l);
    }
    async read(library, provider, meta, checkSchema = true) {
        if (checkSchema && provider.checkSchema)
            await provider.checkSchema(library, meta.kind);
        const remote = await provider.findEntity(library, meta.kind, meta.id);
        if (!remote)
            throw error('REMOTE_ENTITY_MISSING', '云端记录被物理删除，请修复后继续');
        if (remote.revision !== meta.revision || remote.lastMutationId !== meta.lastMutationId || remote.contentHash !== meta.contentHash || hashEntity(remote) !== meta.contentHash || (meta.kind === 'asset' && remote.fileToken !== meta.fileToken))
            throw error('REMOTE_ENTITY_CHANGED', '检测到飞书端人工改动，已暂停此记录写入');
        return remote;
    }
    metadata(l, e) {
        return {
            libraryId: l.id, id: e.id, kind: e.kind, recordId: e.recordId, revision: e.revision, lastMutationId: e.lastMutationId, contentHash: e.contentHash, ...(e.deletedAt ? { deletedAt: e.deletedAt } : {}), ...(e.kind === 'asset' ? { fileToken: e.fileToken, sha256: e.payload.sha256, questionId: e.payload.questionId } : {})
        };
    }
    finalize(library, entity, intent) {
        const result = { mutationId: intent.mutationId, status: 'committed', revision: entity.revision };
        try {
            this.db.transaction(() => {
                const current = this.db.get('libraries', library.accountId);
                const seq = (current.sequence || 0) + 1;
                current.sequence = seq;
                library.sequence = seq;
                this.saveLibrary(current);
                this.db.put('sync_entities', key(library, entity.kind, entity.id), this.metadata(library, entity));
                this.db.put('sync_changes', key(library, String(seq).padStart(16, '0')), {
                    libraryId: library.id, seq, id: entity.id, kind: entity.kind, revision: entity.revision, ...(entity.deletedAt ? { deletedAt: entity.deletedAt } : {})
                });
                this.db.put('sync_intents', key(library, intent.mutationId), {
                    ...intent, state: 'committed', committedAt: now(), result
                });
                if (entity.kind === 'review' && intent.reviewGroup)
                    this.db.put('sync_review_groups', key(library, entity.id), {
                        libraryId: library.id, reviewId: entity.id, ...intent.reviewGroup, state: 'schedule_pending', createdAt: now()
                    });
                if (entity.kind === 'question' && entity.payload.schedule) {
                    const scheduleHash = digest(entity.payload.schedule);
                    for (const group of this.db.list('sync_review_groups'))
                        if (group.libraryId === library.id && group.questionId === entity.id && group.scheduleHash === scheduleHash && group.state === 'schedule_pending')
                            this.db.put('sync_review_groups', key(library, group.reviewId), {
                                ...group, state: 'complete', questionRevision: entity.revision, completedAt: now()
                            });
                }
            });
        }
        catch {
            throw error('COMMIT_UNCONFIRMED', '飞书已接收，网关记账待恢复；请保留操作并重试', 503, true);
        }
        return result;
    }
    async dependencies(library, provider, payload, questionId) {
        for (const image of payload.images || []) {
            const m = this.db.get('sync_entities', key(library, 'asset', image.assetId));
            if (!m || m.deletedAt || m.questionId !== questionId)
                throw error('ATTACHMENT_PENDING', '题目图片尚未上传完成，稍后继续', 409, true);
            const remote = await this.read(library, provider, m);
            if (!remote.fileToken || remote.payload.status !== 'ready')
                throw error('ATTACHMENT_PENDING', '云端图片尚未就绪', 409, true);
        }
    }
    async commit(library, provider, m, session) {
        if (m.kind === 'config' && m.entityId === library.id)
            throw error('CONFIG_NOT_ALLOWED', '题库初始化标识不能由客户端覆盖', 400);
        if (provider.checkSchema)
            await provider.checkSchema(library, m.kind);
        const intentKey = key(library, m.mutationId), entityKey = key(library, m.kind, m.entityId);
        const entity = {
            kind: m.kind, id: m.entityId, payload: m.payload, ...(m.deletedAt ? { deletedAt: m.deletedAt } : {})
        }, contentHash = hashEntity(entity), fingerprint = digest(m);
        let intent = this.db.get('sync_intents', intentKey);
        if (intent) {
            if (intent.fingerprint !== fingerprint)
                throw error('MUTATION_REUSED', '同一操作标识不可用于不同内容', 400);
            if (intent.state === 'committed')
                return intent.result;
        }
        let remote = await provider.findEntity(library, m.kind, m.entityId);
        if (intent && remote?.lastMutationId === m.mutationId) {
            if (remote.revision !== intent.revision || remote.contentHash !== contentHash || hashEntity(remote) !== contentHash)
                throw error('REMOTE_ENTITY_CHANGED', '提交记录标识与内容不匹配，需人工修复');
            return this.finalize(library, remote, intent);
        }
        const meta = this.db.get('sync_entities', entityKey);
        if (meta) {
            if (!remote)
                throw error('REMOTE_ENTITY_MISSING', '飞书记录已被外部删除');
            if (remote.revision !== meta.revision || remote.lastMutationId !== meta.lastMutationId || remote.contentHash !== meta.contentHash || hashEntity(remote) !== meta.contentHash)
                throw error('REMOTE_ENTITY_CHANGED', '检测到飞书端人工改动，已暂停此记录写入');
        }
        else if (remote)
            throw error('REMOTE_UNINDEXED_ENTITY', '发现未确认的同名云端实体，请核对索引');
        if ((meta?.revision || 0) !== m.baseRevision)
            return {
                mutationId: m.mutationId, status: 'conflict', revision: remote?.revision || 0, current: remote ? publicEntity(remote) : null, error: { code: 'CONFLICT', message: '云端版本已更新，请保留双方后选择', retryable: false }
            };
        if (m.kind === 'review' && meta && (!m.deletedAt || canonical(m.payload) !== canonical(remote.payload)))
            throw error('REVIEW_APPEND_ONLY', '复习事实只允许追加或保留原事实的撤销墓碑');
        if (m.kind === 'question' && !m.deletedAt)
            await this.dependencies(library, provider, m.payload, m.entityId);
        this.admit(session);
        const revision = m.baseRevision + 1;
        if (intent && intent.revision !== revision)
            throw error('REMOTE_ENTITY_CHANGED', '未完成操作版本不匹配');
        intent = intent || {
            libraryId: library.id, mutationId: m.mutationId, entityId: m.entityId, kind: m.kind, baseRevision: m.baseRevision, revision, contentHash, fingerprint, state: 'prepared', createdAt: now(), ...(m.kind === 'review' && m.payload.after ? { reviewGroup: {
                    questionId: m.payload.questionId, scheduleHash: digest(m.deletedAt && m.payload.before ? m.payload.before : m.payload.after), eventBaseRevision: m.payload.eventBaseRevision, cancelled: Boolean(m.deletedAt)
                } } : {})
        };
        this.db.put('sync_intents', intentKey, intent);
        Object.assign(entity, {
            revision, lastMutationId: m.mutationId, contentHash, createdAt: remote?.createdAt || now(), updatedAt: now()
        });
        let written;
        try {
            written = await provider.writeEntity(library, entity, remote);
        }
        catch (e) {
            if (e.unknownOutcome) {
                this.db.put('sync_intents', intentKey, { ...intent, state: 'unknown' });
                throw e;
            }
            this.db.put('sync_intents', intentKey, { ...intent, state: 'prepared' });
            throw e;
        }
        if (!written || written.lastMutationId !== m.mutationId || written.revision !== revision || written.contentHash !== contentHash || hashEntity(written) !== contentHash)
            throw error('REMOTE_OUTCOME_UNKNOWN', '远端写入结果尚未核实', 503, true);
        return this.finalize(library, written, intent);
    }
    validateEpoch(l, url) {
        const epoch = url.searchParams.get('epoch');
        if (epoch && epoch !== l.epoch)
            throw error('RESET_REQUIRED', '同步索引已变更，请保留本地内容并重新全量校对');
    }
    async audit(library, provider) {
        const timestamp = Date.now();
        const audit = { cursor: 0, lastSchemaAt: 0, ...(library.audit || {}) };
        // Non-destructive validation only. Never call ensureFields during ordinary polling.
        if (timestamp - audit.lastSchemaAt >= 5 * 60 * 1000) {
            if (provider.checkSchema) {
                for (const kind of Object.keys(TABLES)) {
                    await provider.checkSchema(library, kind);
                }
            }
            audit.lastSchemaAt = timestamp;
        }
        const entities = this.db.list('sync_entities')
            .filter(entity => entity.libraryId === library.id)
            .sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
        const count = Math.min(3, entities.length);
        const start = entities.length ? audit.cursor % entities.length : 0;
        for (let index = 0; index < count; index++) {
            // Only indexed, account-owned entities are examined. Payloads remain in Feishu.
            await this.read(library, provider, entities[(start + index) % entities.length], false);
        }
        audit.cursor = entities.length ? (start + count) % entities.length : 0;
        audit.lastRecordsAt = timestamp;
        library.audit = audit;
        this.saveLibrary(library);
    }
    async changes(library, provider, url) {
        this.validateEpoch(library, url);
        const cursor = Number(url.searchParams.get('cursor') || 0);
        if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > library.sequence)
            throw error('RESET_REQUIRED', '同步游标无效，请重新校对');
        await this.audit(library, provider);
        const limit = pageLimit(url), rows = this.db.list('sync_changes').filter(x => x.libraryId === library.id && x.seq > cursor).sort((a, b) => a.seq - b.seq), selected = rows.slice(0, limit), changes = [];
        // An index entry may refer to an older revision. Fetch current business data and let clients dedupe revisions.
        for (const change of selected) {
            const meta = this.db.get('sync_entities', key(library, change.kind, change.id));
            if (!meta)
                throw error('RESET_REQUIRED', '同步索引缺失，需要校对');
            const remote = await this.read(library, provider, meta);
            changes.push({ ...publicEntity(remote), seq: change.seq });
        }
        return {
            epoch: library.epoch, cursor: String(selected.at(-1)?.seq ?? cursor), hasMore: rows.length > limit, changes
        };
    }
    async snapshot(library, provider, url) {
        this.validateEpoch(library, url);
        const limit = pageLimit(url), page = url.searchParams.get('page');
        let snapshot, offset = 0;
        // Persist metadata-only snapshot membership and highwater. New commits are replayed via changes.
        if (page) {
            const parts = page.split('.');
            if (parts.length !== 2 || !UUID.test(parts[0]) || !/^\d+$/.test(parts[1]))
                throw error('INVALID_PAGE', '快照分页标识无效', 400);
            snapshot = this.db.get('sync_snapshots', key(library, parts[0]));
            offset = Number(parts[1]);
            if (!snapshot || snapshot.expiresAt < Date.now() || offset > snapshot.entities.length)
                throw error('RESET_REQUIRED', '快照已过期，请重新全量校对');
        }
        else {
            for (const old of this.db.list('sync_snapshots'))
                if (old.expiresAt < Date.now())
                    this.db.remove('sync_snapshots', key(library, old.id));
            snapshot = {
                id: randomUUID(), libraryId: library.id, epoch: library.epoch, highwater: library.sequence, expiresAt: Date.now() + 30 * 60 * 1000, entities: this.db.list('sync_entities').filter(x => x.libraryId === library.id).map(x => ({ id: x.id, kind: x.kind })).sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`))
            };
            this.db.put('sync_snapshots', key(library, snapshot.id), snapshot);
        }
        if (snapshot.libraryId !== library.id || snapshot.epoch !== library.epoch)
            throw error('RESET_REQUIRED', '快照所属题库已变化');
        const selected = snapshot.entities.slice(offset, offset + limit), entities = [];
        for (const ref of selected) {
            const meta = this.db.get('sync_entities', key(library, ref.kind, ref.id));
            if (!meta)
                throw error('RESET_REQUIRED', '快照索引缺失');
            entities.push(publicEntity(await this.read(library, provider, meta)));
        }
        const next = offset + selected.length, hasMore = next < snapshot.entities.length;
        return {
            epoch: library.epoch, cursor: String(snapshot.highwater), hasMore, changes: entities, entities, nextPage: hasMore ? `${snapshot.id}.${next}` : null
        };
    }
    async upload(library, provider, body, session) {
        if (!body || !UUID.test(body.assetId || '') || !UUID.test(body.questionId || '') || typeof body.name !== 'string' || !body.name || body.name.length > 200 || /[\\/\r\n\0]/.test(body.name) || !/^image\/(png|jpeg|webp|gif|bmp)$/.test(body.mime || '') || !/^[0-9a-f]{64}$/.test(body.sha256 || '') || typeof body.dataBase64 !== 'string' || body.dataBase64.length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 || !/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.dataBase64))
            throw error('INVALID_ASSET', '图片标识、格式或内容无效', 400);
        const bytes = Buffer.from(body.dataBase64, 'base64');
        if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES)
            throw error('ATTACHMENT_TOO_LARGE', '图片超过 20 MiB 单文件上传限制', 413);
        if (createHash('sha256').update(bytes).digest('hex') !== body.sha256)
            throw error('ATTACHMENT_HASH_MISMATCH', '上传图片校验失败', 400);
        if (sniffImage(bytes) !== body.mime)
            throw error('INVALID_IMAGE_FORMAT', '图片真实格式与声明不符，未上传', 400);
        const payload = {
            ...(body.editor || {}), schemaVersion: 1, questionId: body.questionId, name: body.name, mime: body.mime, sha256: body.sha256, size: bytes.length, ...(body.width !== undefined ? { sourceWidth: body.width } : {}), ...(body.height !== undefined ? { sourceHeight: body.height } : {}), status: 'ready'
        };
        validatePayload(payload, 'asset');
        const entity = {
            id: body.assetId, kind: 'asset', revision: 1, payload
        }, contentHash = hashEntity(entity), entityKey = key(library, 'asset', entity.id), existing = this.db.get('sync_entities', entityKey);
        if (existing) {
            if (existing.contentHash !== contentHash)
                throw error('ASSET_IMMUTABLE', '原图资产不可原地替换，请创建新的资产标识');
            await this.read(library, provider, existing);
            return { id: entity.id, revision: 1, payload };
        }
        const mutationId = body.assetId, intentKey = key(library, mutationId);
        let intent = this.db.get('sync_intents', intentKey);
        if (intent && intent.contentHash !== contentHash)
            throw error('ASSET_IMMUTABLE', '未完成原图上传不能替换内容');
        const remote = await provider.findEntity(library, 'asset', entity.id);
        if (remote) {
            if (remote.lastMutationId !== mutationId || remote.contentHash !== contentHash || hashEntity(remote) !== contentHash)
                throw error('REMOTE_ENTITY_CHANGED', '云端图片内容不匹配');
            if (!intent)
                throw error('REMOTE_UNINDEXED_ENTITY', '发现未知图片记录，需要核对');
            this.finalize(library, remote, intent);
            return { id: entity.id, revision: 1, payload };
        }
        if (intent?.state === 'uploading' || intent?.state === 'upload_unknown')
            throw error('ATTACHMENT_RECONCILIATION_REQUIRED', '上次附件上传结果未知，需要核对，未自动重复上传');
        intent = intent || {
            libraryId: library.id, mutationId, entityId: entity.id, kind: 'asset', revision: 1, contentHash, fingerprint: contentHash, state: 'prepared', createdAt: now()
        };
        if (!intent.fileToken) {
            const dedup = this.db.list('sync_entities').find(x => x.libraryId === library.id && x.kind === 'asset' && x.sha256 === body.sha256 && x.fileToken && !x.deletedAt);
            if (dedup) {
                const source = await this.read(library, provider, dedup);
                intent.fileToken = source.fileToken;
                intent.state = 'uploaded';
                this.db.put('sync_intents', intentKey, intent);
            }
            else {
                this.db.put('sync_intents', intentKey, { ...intent, state: 'uploading' });
                try {
                    const uploaded = await provider.uploadAsset(library, payload, bytes);
                    intent = { ...intent, fileToken: uploaded.fileToken, state: 'uploaded' };
                    this.db.put('sync_intents', intentKey, intent);
                }
                catch (e) {
                    this.db.put('sync_intents', intentKey, { ...intent, state: e.unknownOutcome ? 'upload_unknown' : 'prepared' });
                    throw e;
                }
            }
        }
        this.admit(session);
        Object.assign(entity, {
            lastMutationId: mutationId, contentHash, fileToken: intent.fileToken, createdAt: now(), updatedAt: now()
        });
        // Keep token metadata, not bytes or business payload; a retry can complete this stage after a crash.
        const written = await provider.writeEntity(library, entity, null);
        if (written.contentHash !== contentHash || hashEntity(written) !== contentHash || !written.fileToken)
            throw error('REMOTE_OUTCOME_UNKNOWN', '附件记录写入结果尚未确认', 503, true);
        this.finalize(library, written, intent);
        return { id: entity.id, revision: 1, payload };
    }
}
