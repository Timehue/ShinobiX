import assert from 'node:assert/strict';
import { test } from 'node:test';

test('job progress exposes only the signed-in owner’s stage and verified ready model', async () => {
    process.env.SHINOBIX_QA_MEMORY_KV = '1';
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_SECTOR_MODEL_DISPLAY = '1';
    process.env.SESSION_SECRET = 'model-progress-local-test-secret';
    const { issuePlayerToken } = await import('../../_auth.js');
    const { kv } = await import('../../_storage.js');
    const handler = (await import('./[id].js')).default as unknown as (req: never, res: never) => Promise<unknown>;
    const id = 'job-status-33', owner = 'modelprogress', month = '2026-11', assetId = 'a'.repeat(32);
    const accountId='e1a6db4a-021a-4e47-b29f-fce77d830ccc';
    await kv.set('save:'+owner,{character:{playerModelOwnerId:accountId}});
    await kv.set('avatar-model:owner:'+accountId,{owner,id:accountId,state:'active',createdAt:1});
    const job = { slug: owner, accountId, monthKey: month, state: 'animate', assetId, privateKey: 'hidden', providerId: 'hidden' };
    const key = 'avatar-model:job:' + id;
    async function get(player: string, jobId = id) {
        let status = 0, data: unknown;
        const res = { setHeader() {}, status(code: number) { status = code; return res; }, json(v: unknown) { data = v; } };
        await handler({ method: 'GET', headers: { 'x-player-token': player && issuePlayerToken(player) },
            query: { id: jobId } } as never, res as never);
        return { status, data };
    }
    await kv.set(key, job);
    assert.equal((await get('')).status, 401);
    assert.deepEqual(await get('differentowner'), await get(owner, 'no-such-job'));
    assert.equal((await get(owner, '../bad')).status, 404);
    for (const state of ['animate', 'failed', 'cancelled']) {
        await kv.set(key, { ...job, state, error: 'private provider response' });
        assert.deepEqual(await get(owner), { status: 200, data: {
            id, month, state, ...(state === 'animate' ? {} : { slot: 'available' }),
        } });
    }
    const slotKey = 'avatar-model:slot:' + owner + ':' + month;
    for (const [jobId, expected] of [[id, 'used'], ['next-job', 'replaced']]) {
        await kv.set(slotKey, { jobId });
        assert.deepEqual(await get(owner), { status: 200, data: { id, month, state: 'cancelled', slot: expected } });
    }
    await kv.set(key, { ...job, state: 'ready' });
    const asset = { owner, accountId, status: 'ready', jobId: id, version: 'b'.repeat(64) };
    for (const patch of [{ status: 'revoked' }, { owner: 'someoneelse' }, { jobId: 'wrong' }, { version: 'bad' },{accountId:undefined}]) {
        await kv.set('avatar-model:asset:' + assetId, { ...asset, ...patch });
        assert.equal((await get(owner)).status, 404);
    }
    await kv.set('avatar-model:asset:' + assetId, asset);
    assert.deepEqual(await get(owner), { status: 200, data: {
        id, month, state: 'ready', model: { assetId, version: asset.version },
    } });
    await kv.set('save:'+owner,{character:{playerModelOwnerId:'d0c44ac2-cc8f-42d1-bfd7-c4b63607cd9b'}});
    assert.equal((await get(owner)).status,404,'A reused name cannot inspect old jobs');
    delete process.env.ENABLE_SECTOR_MODEL_DISPLAY;
    assert.equal((await get(owner)).status, 404);
});
