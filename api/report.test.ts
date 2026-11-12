import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

test('world model reports retain the verified owner and exact public revision for staff', async () => {
    Object.assign(process.env, {
        NODE_ENV: 'test', SHINOBIX_QA_MEMORY_KV: '1',
        SESSION_SECRET: 'model-report-player-session-fixture',
        ADMIN_SESSION_SECRET: 'model-report-admin-session-fixture',
    });
    const { kv } = await import('./_storage.js');
    const { issuePlayerToken, issueAdminToken } = await import('./_auth.js');
    const { default: report } = await import('./report.js');
    const handler = report as unknown as (req: never, res: never) => Promise<unknown>;
    const reporter = 'modelobserver';
    const owner = 'modelreportowner';
    const accountId = randomUUID();
    const assetId = 'a'.repeat(32);
    const version = 'b'.repeat(64);
    const assetKey = 'avatar-model:asset:' + assetId;
    const asset = { owner, accountId, version, status: 'ready', privateKey: 'private fixture' };
    const body = { targetType: 'player-model', category: 'other', targetId: assetId,
        targetVersion: version, targetName: 'wrongplayer', note: 'Please review this outfit.' };
    const player = { 'x-player-token': issuePlayerToken(reporter)! };
    const staff = { 'x-admin-token': issueAdminToken('content')! };
    async function request(method: string, headers: Record<string,string> = player, body?: unknown) {
        let status = 0;
        let data: Record<string,unknown> = {};
        const res = { setHeader() {}, status(code: number) { status = code; return res; },
            json(value: typeof data) { data = value; } };
        await handler({ method, headers, body, query: {}, socket: { remoteAddress: '127.0.0.1' } } as never, res as never);
        return { status, data };
    }
    await kv.set('save:' + owner, { character: { name: owner, playerModelOwnerId: accountId } });
    await kv.set('avatar-model:owner:' + accountId, { owner, id: accountId, state: 'active', createdAt: 1 });
    await kv.set(assetKey, asset);
    assert.equal((await request('POST', {}, body)).status, 401);
    assert.equal((await request('POST', player, { ...body, targetVersion: null })).status, 400);
    assert.equal((await request('POST', player, { ...body, targetVersion: 'c'.repeat(64) })).status, 404);
    assert.equal((await request('POST', { 'x-player-token': issuePlayerToken(owner)! }, body)).status, 404);
    assert.deepEqual(await request('POST', player, body), { status: 200, data: { ok: true } });
    assert.equal((await request('GET')).status, 403);
    const result = await request('GET', staff);
    assert.equal(result.status, 200);
    const reports = result.data.reports as Record<string,unknown>[];
    assert.equal(reports.length, 1);
    const saved = reports[0];
    assert.deepEqual([saved.targetType, saved.targetName, saved.targetId, saved.targetVersion, saved.reporter],
        ['player-model', owner, assetId, version, reporter]);
    assert.equal(JSON.stringify(saved).includes('private fixture'), false);
    await kv.set(assetKey, { ...asset, status: 'revoked' });
    assert.equal((await request('POST', player, body)).status, 404);
    await kv.set(assetKey, asset);
    await kv.set('save:' + owner, { character: { name: owner, playerModelOwnerId: randomUUID() } });
    assert.equal((await request('POST', player, body)).status, 404);
    assert.equal((await request('DELETE', staff, { id: saved.id })).status, 200);
    assert.deepEqual((await request('GET', staff)).data.reports, []);
});
