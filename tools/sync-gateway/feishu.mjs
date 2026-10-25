// Official API references (checked 2026-10-25; live tenant acceptance still required):
// https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/get-user-access-token-v3
// https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/refresh-user-access-token-v3
// https://open.feishu.cn/document/server-docs/docs/bitable-v1/app/create
// https://open.feishu.cn/document/server-docs/docs/drive-v1/media/upload_all
import { createHash } from 'node:crypto';
export class GatewayError extends Error {
    constructor(code, message, status = 400, retryable = false, extras = {}) {
        super(message);
        Object.assign(this, { code, status, retryable }, extras);
    }
}
const fail = (code, message, status = 502, retryable = false, extras = {}) => new GatewayError(code, message, status, retryable, extras);
const segment = value => encodeURIComponent(String(value));
const origin = config => config.feishuApiOrigin || 'https://open.feishu.cn';
function remoteError(response, data) {
    const n = Number(data?.code);
    if (response.status === 429 || [99991400, 1254290, 1063006].includes(n))
        return fail('RATE_LIMITED', '飞书请求频率受限，请稍后重试', 429, true, { retry_after: Number(response.headers.get('retry-after')) || 30 });
    if ([20005, 20021, 20022, 20023, 20026, 20037, 20064, 20073, 99991663, 99991664, 99991668].includes(n) || response.status === 401)
        return fail('REAUTH_REQUIRED', '飞书授权已失效，请重新连接', 401);
    if (response.status === 403 || [99991672, 99991679, 1254302].includes(n))
        return fail('LIBRARY_ACCESS_DENIED', '飞书资源权限不足，请检查授权和管理员审批', 403);
    if ([1254100, 1254101, 1254102, 1254103, 1061101, 1061061, 1061042, 1061547].includes(n))
        return fail('QUOTA_EXCEEDED', '飞书空间或资源额度不足', 409);
    if ([1254004, 1254009, 1254041, 1254044].includes(n))
        return fail('REMOTE_SCHEMA_CHANGED', '云端数据表或字段结构变化，请修复后继续', 409);
    if ([1254130, 1061043].includes(n))
        return fail('PAYLOAD_TOO_LARGE', '云端记录或附件超过容量限制', 413);
    if ([20050, 20072, 1255001, 1255002, 1255003, 1255004, 1255005, 1255040, 1061001, 1061006, 1066001].includes(n))
        return fail('REMOTE_UNAVAILABLE', '飞书操作结果尚未确认', 503, true, { uncertain: true });
    return fail(response.status >= 500 ? 'REMOTE_UNAVAILABLE' : 'REMOTE_REJECTED', '飞书未确认该请求，请查看脱敏诊断并重试', response.status >= 500 ? 503 : 422, response.status >= 500, { remoteCode: Number.isFinite(n) ? n : undefined });
}
async function jsonRequest(fetchImpl, url, init, write = false) {
    let response;
    try {
        response = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30000) });
    }
    catch {
        throw fail(write ? 'REMOTE_OUTCOME_UNKNOWN' : 'REMOTE_UNAVAILABLE', write ? '飞书操作结果未知，需要核对后继续' : '暂时无法访问飞书', 503, !write, { unknownOutcome: write });
    }
    let data;
    try {
        data = await response.json();
    }
    catch {
        throw fail(write ? 'REMOTE_OUTCOME_UNKNOWN' : 'REMOTE_PROTOCOL_ERROR', '飞书响应无法验证', 502, !write, { unknownOutcome: write });
    }
    if (!response.ok || (data.code !== undefined && data.code !== 0)) {
        const error = remoteError(response, data);
        if (write && (response.status >= 500 || error.uncertain))
            Object.assign(error, { unknownOutcome: true });
        throw error;
    }
    return data;
}
export class FeishuOAuth {
    constructor(config, fetchImpl = fetch) {
        this.config = config;
        this.fetch = fetchImpl;
    }
    authorizeUrl(state) {
        const u = new URL('https://accounts.feishu.cn/open-apis/authen/v1/authorize');
        const scopes = this.config.feishuScopes;
        u.search = new URLSearchParams({
            client_id: this.config.feishuAppId, response_type: 'code', redirect_uri: this.config.feishuRedirectUri, state, scope: Array.isArray(scopes) ? scopes.join(' ') : (scopes || '')
        }).toString();
        return u.toString();
    }
    async token(extra) {
        // Current v3 supports JSON for confidential clients; no fallback can replay a single-use code.
        const data = await jsonRequest(this.fetch, 'https://accounts.feishu.cn/oauth/v3/token', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ ...extra, client_id: this.config.feishuAppId, client_secret: this.config.feishuAppSecret }) }, true);
        if (!data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0 || (data.refresh_token && (!Number.isFinite(data.refresh_token_expires_in) || data.refresh_token_expires_in <= 0)))
            throw fail('REMOTE_PROTOCOL_ERROR', '飞书授权响应不完整');
        return {
            accessToken: data.access_token, refreshToken: data.refresh_token || null, expiresIn: data.expires_in, refreshExpiresIn: data.refresh_token_expires_in || null, scope: data.scope || ''
        };
    }
    exchange(code) {
        return this.token({ grant_type: 'authorization_code', code, redirect_uri: this.config.feishuRedirectUri });
    }
    refresh(refreshToken) {
        return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken });
    }
    async identity(accessToken) {
        const data = await jsonRequest(this.fetch, `${origin(this.config)}/open-apis/authen/v1/user_info`, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } });
        if (!data.data?.open_id || !data.data?.tenant_key)
            throw fail('REMOTE_PROTOCOL_ERROR', '无法验证飞书身份和租户');
        return { openId: data.data.open_id, tenantKey: data.data.tenant_key, name: data.data.name || '飞书用户' };
    }
}
export const TABLES = Object.freeze({
    question: 'Questions', asset: 'Assets', review: 'ReviewEvents', collection: 'Collections', config: 'LibraryConfig'
});
const FIELD_TYPES = Object.freeze({
    id: 1, library_id: 1, schema_version: 2, revision: 2, last_mutation_id: 1, content_hash: 1, created_at: 1, updated_at: 1, deleted_at: 1, payload: 1, attachment: 17
});
const physical = (mapping, key) => typeof mapping[key] === 'string' ? mapping[key] : mapping[key]?.name;
function text(value) {
    return Array.isArray(value) ? value.map(x => x.text || '').join('') : value;
}
export class FeishuBitable {
    constructor(config, accessToken, fetchImpl = fetch) {
        if (!accessToken)
            throw fail('REAUTH_REQUIRED', '需要连接飞书', 401);
        this.config = config;
        this.accessToken = accessToken;
        this.fetch = fetchImpl;
    }
    async request(method, path, body) {
        const data = await jsonRequest(this.fetch, `${origin(this.config)}/open-apis${path}`, { method, headers: { Authorization: `Bearer ${this.accessToken}`, ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }, method !== 'GET' && !path.includes('/search'));
        if (!data.data)
            throw fail('REMOTE_PROTOCOL_ERROR', '飞书数据响应不完整');
        return data.data;
    }
    path(library, kind) {
        const table = library.tables[kind];
        if (!table)
            throw fail('BOOTSTRAP_INCOMPLETE', '题库尚未初始化', 409);
        return `/bitable/v1/apps/${segment(library.appToken)}/tables/${segment(table.id)}`;
    }
    async createBase(name) {
        const data = await this.request('POST', '/bitable/v1/apps', { name, time_zone: 'Asia/Shanghai' });
        if (!data.app?.app_token || !data.app?.url)
            throw fail('REMOTE_OUTCOME_UNKNOWN', '题库创建结果需要人工核对', 409, false, { unknownOutcome: true });
        return { appToken: data.app.app_token, url: data.app.url };
    }
    async checkAccess(library) {
        await this.request('GET', `/bitable/v1/apps/${segment(library.appToken)}`);
        return true;
    }
    async checkManagement(library) {
        const data = await this.request('GET', `/drive/v1/permissions/${segment(library.appToken)}/members/auth?type=bitable&action=manage_public`);
        if (data.auth_result !== true)
            throw fail('MANAGEMENT_UNVERIFIED', '尚未证实当前用户具有题库管理权限，停止恢复', 403);
        return true;
    }
    async pages(path, key = 'items') {
        const items = [];
        let token = '';
        const seen = new Set();
        do {
            const u = `${path}${path.includes('?') ? '&' : '?'}page_size=100${token ? `&page_token=${segment(token)}` : ''}`;
            const d = await this.request('GET', u);
            items.push(...(d[key] || []));
            if (items.length > 50000)
                throw fail('REMOTE_LIMIT', '飞书资源数量超出本次安全扫描限制', 409);
            if (!d.has_more)
                break;
            token = d.page_token;
            if (!token || seen.has(token))
                throw fail('REMOTE_PROTOCOL_ERROR', '飞书分页响应无效');
            seen.add(token);
        } while (token);
        return items;
    }
    listTables(library) {
        return this.pages(`/bitable/v1/apps/${segment(library.appToken)}/tables`);
    }
    async findTable(library, kind) {
        const tables = await this.listTables(library), matches = [];
        for (const table of tables) {
            if (table.name !== TABLES[kind])
                continue;
            const fields = await this.pages(`/bitable/v1/apps/${segment(library.appToken)}/tables/${segment(table.table_id)}/fields`);
            if (fields.some(f => f.field_name === `__mn_owner_${library.id}`))
                matches.push({ id: table.table_id, name: table.name, fields: {} });
        }
        if (matches.length > 1)
            throw fail('BOOTSTRAP_RECONCILIATION_REQUIRED', '发现多个带相同标识的数据表，请核对', 409);
        return matches[0] || null;
    }
    async createTable(library, kind, name) {
        const d = await this.request('POST', `/bitable/v1/apps/${segment(library.appToken)}/tables`, { table: { name, default_view_name: 'Grid', fields: [{ field_name: `__mn_owner_${library.id}`, type: 1 }] } });
        if (!d.table_id)
            throw fail('REMOTE_OUTCOME_UNKNOWN', '数据表创建结果需要核对', 409, false, { unknownOutcome: true });
        return { id: d.table_id, name, fields: {} };
    }
    async ensureFields(library, kind, table) {
        const path = `/bitable/v1/apps/${segment(library.appToken)}/tables/${segment(table.id)}/fields`;
        const fields = await this.pages(path);
        const mapping = {};
        for (const stored of Object.values(table.fields || {})) {
            if (typeof stored === 'object' && !fields.some(f => f.field_id === stored.id && f.field_name === stored.name && f.type === stored.type))
                throw fail('REMOTE_SCHEMA_CHANGED', '已知云端字段被删除、重命名或替换，请修复后继续', 409);
        }
        for (const [key, type] of Object.entries(FIELD_TYPES)) {
            if (key === 'attachment' && kind !== 'asset')
                continue;
            const name = `mn_${key}`, matches = fields.filter(f => f.field_name === name);
            if (matches.length > 1 || matches[0] && matches[0].type !== type)
                throw fail('REMOTE_SCHEMA_CHANGED', '题库字段结构发生变化，请修复后继续', 409);
            const field = matches[0] || (await this.request('POST', path, { field_name: name, type })).field;
            if (!field?.field_id)
                throw fail('REMOTE_PROTOCOL_ERROR', '飞书字段响应无效');
            mapping[key] = { id: field.field_id, name, type };
        }
        return { ...table, fields: mapping };
    }
    async checkSchema(library, kind) {
        const table = library.tables[kind];
        const actual = await this.pages(`/bitable/v1/apps/${segment(library.appToken)}/tables/${segment(table.id)}/fields`);
        for (const stored of Object.values(table.fields)) {
            if (typeof stored === 'object' && !actual.some(f => f.field_id === stored.id && f.field_name === stored.name && f.type === stored.type))
                throw fail('REMOTE_SCHEMA_CHANGED', '已知云端字段被删除、重命名或替换，请修复后继续', 409);
        }
        return true;
    }
    decode(library, kind, record) {
        const fields = library.tables[kind].fields, read = k => text(record.fields?.[physical(fields, k)]);
        let payload;
        try {
            payload = JSON.parse(read('payload'));
        }
        catch {
            throw fail('REMOTE_SCHEMA_CHANGED', '飞书业务记录无法解析', 409);
        }
        if (!payload || typeof payload !== 'object' || Number(read('schema_version')) !== 1 || read('library_id') !== library.id)
            throw fail('REMOTE_SCHEMA_CHANGED', '飞书记录标识或协议不匹配', 409);
        const attachment = record.fields?.[physical(fields, 'attachment')];
        return {
            kind, id: read('id'), revision: Number(read('revision')), lastMutationId: read('last_mutation_id'), contentHash: read('content_hash'), payload, ...(read('deleted_at') ? { deletedAt: read('deleted_at') } : {}), createdAt: read('created_at'), updatedAt: read('updated_at'), recordId: record.record_id || record.id, ...(kind === 'asset' ? { fileToken: attachment?.[0]?.file_token } : {})
        };
    }
    async findEntity(library, kind, id) {
        const records = [];
        let token = '';
        do {
            const d = await this.request('POST', `${this.path(library, kind)}/records/search?page_size=100${token ? `&page_token=${segment(token)}` : ''}`, { filter: { conjunction: 'and', conditions: [{ field_name: physical(library.tables[kind].fields, 'id'), operator: 'is', value: [id] }] } });
            records.push(...(d.items || []));
            if (records.length > 1)
                throw fail('REMOTE_DUPLICATE_ENTITY', '检测到重复云端实体，请核对', 409);
            token = d.has_more ? d.page_token : '';
        } while (token);
        return records[0] ? this.decode(library, kind, records[0]) : null;
    }
    async writeEntity(library, entity, current) {
        const mapping = library.tables[entity.kind].fields, fields = {};
        const values = {
            id: entity.id, library_id: library.id, schema_version: 1, revision: entity.revision, last_mutation_id: entity.lastMutationId, content_hash: entity.contentHash, created_at: entity.createdAt, updated_at: entity.updatedAt, deleted_at: entity.deletedAt || '', payload: JSON.stringify(entity.payload)
        };
        if (Buffer.byteLength(values.payload) > 16 * 1024)
            throw fail('PAYLOAD_TOO_LARGE', '单条云端记录超过 16 KiB 安全大小限制', 413);
        for (const [k, v] of Object.entries(values))
            fields[physical(mapping, k)] = v;
        if (entity.kind === 'asset')
            fields[physical(mapping, 'attachment')] = [{ file_token: entity.fileToken }];
        const d = await this.request(current ? 'PUT' : 'POST', `${this.path(library, entity.kind)}/records${current ? `/${segment(current.recordId)}` : ''}`, { fields });
        if (!d.record)
            throw fail('REMOTE_OUTCOME_UNKNOWN', '记录提交结果需要核对', 503, false, { unknownOutcome: true });
        return this.decode(library, entity.kind, d.record);
    }
    async uploadAsset(library, asset, bytes) {
        const limit = Math.min(this.config.assetMaxBytes || 20 * 1024 * 1024, 20 * 1024 * 1024);
        if (bytes.length > limit)
            throw fail('ATTACHMENT_TOO_LARGE', '图片超过单文件上传限制', 413);
        const form = new FormData();
        form.set('file_name', asset.name);
        form.set('parent_type', asset.mime.startsWith('image/') ? 'bitable_image' : 'bitable_file');
        form.set('parent_node', library.appToken);
        form.set('size', String(bytes.length));
        form.set('extra', JSON.stringify({ drive_route_token: library.appToken }));
        form.set('file', new Blob([bytes], { type: asset.mime }), asset.name);
        const d = await jsonRequest(this.fetch, `${origin(this.config)}/open-apis/drive/v1/medias/upload_all`, { method: 'POST', headers: { Authorization: `Bearer ${this.accessToken}` }, body: form }, true);
        if (!d.data?.file_token)
            throw fail('REMOTE_OUTCOME_UNKNOWN', '附件上传结果需要核对', 503, false, { unknownOutcome: true });
        return { fileToken: d.data.file_token };
    }
    async downloadAsset(library, asset) {
        // Never follow client URLs or use client tokens; fetch this account's stored attachment directly.
        const attachmentField = library.tables.asset.fields.attachment;
        const extra = JSON.stringify({ bitablePerm: { tableId: library.tables.asset.id, attachments: { [typeof attachmentField === 'string' ? attachmentField : attachmentField.id]: { [asset.recordId]: [asset.fileToken] } } } });
        const url = `${origin(this.config)}/open-apis/drive/v1/medias/${segment(asset.fileToken)}/download?extra=${segment(extra)}`;
        let r;
        try {
            r = await this.fetch(url, { headers: { Authorization: `Bearer ${this.accessToken}` }, redirect: 'error', signal: AbortSignal.timeout(30000) });
        }
        catch {
            throw fail('REMOTE_UNAVAILABLE', '附件暂时无法下载', 503, true);
        }
        if (!r.ok)
            throw remoteError(r, {});
        const limit = Math.min(this.config.assetMaxBytes || 20 * 1024 * 1024, 20 * 1024 * 1024);
        if (Number(r.headers.get('content-length')) > limit)
            throw fail('ATTACHMENT_TOO_LARGE', '下载附件超过限制', 413);
        const chunks = [];
        let size = 0;
        for await (const chunk of r.body) {
            size += chunk.length;
            if (size > limit)
                throw fail('ATTACHMENT_TOO_LARGE', '下载附件超过限制', 413);
            chunks.push(Buffer.from(chunk));
        }
        const bytes = Buffer.concat(chunks);
        if (createHash('sha256').update(bytes).digest('hex') !== asset.payload.sha256)
            throw fail('ATTACHMENT_HASH_MISMATCH', '云端图片校验失败', 409);
        return { bytes, mime: asset.payload.mime };
    }
}
