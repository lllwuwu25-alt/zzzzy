import test from 'node:test';
import assert from 'node:assert/strict';
const config = { feishuAppId: 'cli_test', feishuAppSecret: 'server-only', feishuRedirectUri: 'https://api.example/callback' };
test('OAuth uses current v3 JSON exchange and refresh and user bearer identity, never app identity', async () => {
    const { FeishuOAuth } = await import('./feishu.mjs');
    const calls = [];
    const replies = [{
            code: 0, access_token: 'u-access', refresh_token: 'u-refresh', expires_in: 123, refresh_token_expires_in: 456, scope: 'offline_access'
        }, {
            code: 0, access_token: 'u-next', refresh_token: 'u-rotated', expires_in: 100, refresh_token_expires_in: 400, scope: 'offline_access'
        }, { code: 0, data: { open_id: 'ou_test', tenant_key: 'tenant', name: 'Tester' } }];
    const oauth = new FeishuOAuth(config, async (url, init) => {
        calls.push({ url, ...init });
        return Response.json(replies.shift());
    });
    assert.deepEqual(await oauth.exchange('short-code'), {
        accessToken: 'u-access', refreshToken: 'u-refresh', expiresIn: 123, refreshExpiresIn: 456, scope: 'offline_access'
    });
    assert.equal((await oauth.refresh('u-refresh')).refreshToken, 'u-rotated');
    assert.deepEqual(await oauth.identity('u-next'), { openId: 'ou_test', tenantKey: 'tenant', name: 'Tester' });
    assert.equal(calls[0].url, 'https://accounts.feishu.cn/oauth/v3/token');
    assert.deepEqual(JSON.parse(calls[0].body), {
        grant_type: 'authorization_code', client_id: 'cli_test', client_secret: 'server-only', code: 'short-code', redirect_uri: 'https://api.example/callback'
    });
    assert.equal(JSON.parse(calls[1].body).grant_type, 'refresh_token');
    assert.equal(calls[2].headers.Authorization, 'Bearer u-next');
});
test('management permission is probed for the current bearer instead of assuming owner is a listed collaborator', async () => {
    const { FeishuBitable } = await import('./feishu.mjs');
    let requested = '';
    const p = new FeishuBitable(config, 'u-owner', async (url) => {
        requested = url;
        return Response.json({ code: 0, data: { auth_result: true } });
    });
    assert.equal(await p.checkManagement({ appToken: 'base' }), true);
    assert.equal(requested, 'https://open.feishu.cn/open-apis/drive/v1/permissions/base/members/auth?type=bitable&action=manage_public');
    const denied = new FeishuBitable(config, 'u-owner', async () => Response.json({ code: 0, data: { auth_result: false } }));
    await assert.rejects(denied.checkManagement({ appToken: 'base' }), { code: 'MANAGEMENT_UNVERIFIED' });
});
test('OAuth refuses malformed success and redacts upstream secrets from errors', async () => {
    const { FeishuOAuth } = await import('./feishu.mjs');
    await assert.rejects(new FeishuOAuth(config, async () => Response.json({ access_token: 'u-access' })).exchange('x'), { code: 'REMOTE_PROTOCOL_ERROR' });
    await assert.rejects(new FeishuOAuth(config, async () => Response.json({ code: 20037, error_description: 'secret server-only token u-access' }, { status: 400 })).refresh('x'), e => e.code === 'REAUTH_REQUIRED' && !e.message.includes('server-only'));
});
test('Bitable writes bounded per-entity fields and searches by stable UUID; attachments use media upload', async () => {
    const { FeishuBitable } = await import('./feishu.mjs');
    const calls = [];
    const p = new FeishuBitable(config, 'u-user', async (url, init) => {
        calls.push({ url, ...init });
        if (url.includes('upload_all'))
            return Response.json({ code: 0, data: { file_token: 'ft' } });
        return Response.json({ code: 0, data: { items: [], has_more: false } });
    });
    const library = { id: 'lib', appToken: 'base', tables: { question: { id: 'tbl', fields: {
                    id: 'Id', library_id: 'Library', schema_version: 'Schema', revision: 'Revision', last_mutation_id: 'Mutation', content_hash: 'Hash', deleted_at: 'Deleted', payload: 'Payload'
                } } } };
    await p.findEntity(library, 'question', '00000000-0000-4000-8000-000000000001');
    assert.equal(calls[0].headers.Authorization, 'Bearer u-user');
    assert.equal(JSON.parse(calls[0].body).filter.conditions[0].field_name, 'Id');
    await p.uploadAsset(library, { name: 'a.png', mime: 'image/png' }, Buffer.from('image'));
    assert.equal(calls[1].body.get('parent_type'), 'bitable_image');
    assert.equal(calls[1].body.get('parent_node'), 'base');
    assert.equal(calls[1].body.get('size'), '5');
});
test('unknown remote writes are surfaced without automatic blind retries', async () => {
    const { FeishuBitable } = await import('./feishu.mjs');
    let count = 0;
    const p = new FeishuBitable(config, 'u', async () => {
        count++;
        throw Error('socket closed');
    });
    await assert.rejects(p.createBase('name'), e => e.code === 'REMOTE_OUTCOME_UNKNOWN' && e.unknownOutcome);
    assert.equal(count, 1);
});
test('field identity replacement is detected before writes and media authorization uses field ID not name', async () => {
    const { FeishuBitable } = await import('./feishu.mjs');
    const l = { id: 'lib', appToken: 'base', tables: { asset: { id: 'tbl', fields: { attachment: { id: 'fld-original', name: 'mn_attachment', type: 17 } } } } };
    const p = new FeishuBitable(config, 'u', async () => Response.json({ code: 0, data: { items: [{ field_id: 'fld-replaced', field_name: 'mn_attachment', type: 17 }], has_more: false } }));
    await assert.rejects(p.checkSchema(l, 'asset'), { code: 'REMOTE_SCHEMA_CHANGED' });
    let requested;
    const bytes = Buffer.from('image'), sha256 = '6105d6cc76af400325e94d588ce511be5bfdbb73b437dc51eca43917d7a43e3d';
    const download = new FeishuBitable(config, 'u', async (url) => {
        requested = new URL(url);
        return new Response(bytes);
    });
    await download.downloadAsset(l, { recordId: 'rec', fileToken: 'owned', payload: { sha256, mime: 'image/png' } });
    assert.deepEqual(JSON.parse(requested.searchParams.get('extra')).bitablePerm.attachments, { 'fld-original': { rec: ['owned'] } });
});
test('provider error codes inside HTTP200 retain quota, rate-limit, schema and unknown-write semantics', async () => {
    const { FeishuBitable } = await import('./feishu.mjs');
    for (const [code, want, unknown] of [[1061101, 'QUOTA_EXCEEDED', false], [1063006, 'RATE_LIMITED', false], [1254044, 'REMOTE_SCHEMA_CHANGED', false], [1255001, 'REMOTE_UNAVAILABLE', true]]) {
        const p = new FeishuBitable(config, 'u', async () => Response.json({ code, msg: 'private remote text' }));
        await assert.rejects(p.createBase('n'), e => e.code === want && Boolean(e.unknownOutcome) === unknown);
    }
});
