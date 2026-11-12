import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modelCreationFixture } from './_creation-config.fixture.js';

test('the monthly library exposes only completed jobs and ready assets bound to the caller', async () => {
    process.env.NODE_ENV = 'test';
    process.env.SHINOBIX_QA_MEMORY_KV = '1';
    process.env.ENABLE_SECTOR_MODEL_DISPLAY = '1';
    process.env.SESSION_SECRET = 'local-owned-models-test-only-secret';
    const { kv } = await import('../_storage.js');
    const { issuePlayerToken } = await import('../_auth.js');
    const handler = (await import('./models.js')).default as unknown as (req: never, res: never) => Promise<unknown>;
    const owner = 'modellibrary';
    const other = 'secondlibrary';
    const version = 'd'.repeat(64);
    const id = 'e'.repeat(32);
    const accountId='ad873be0-df9b-4f31-a9c7-28f04d4cbd65';
    await kv.set('save:'+owner,{character:{playerModelOwnerId:accountId}});
    await kv.set('avatar-model:owner:'+accountId,{owner,id:accountId,state:'active',createdAt:1});
    async function get(as: string, before?: string, recent?: string) {
        let status = 0;
        let data: unknown;
        const res = { setHeader() {}, status(code: number) { status = code; return res; }, json(body: unknown) { data = body; } };
        await handler({ method: 'GET', query: { before, recent }, headers: { 'x-player-token': as && issuePlayerToken(as) } } as never, res as never);
        return { status, data };
    }
    assert.equal((await get('')).status, 401);
    assert.equal((await get(owner, '../')).status, 400);
    const empty = { status: 200, data: { models: [], before: null } };
    assert.deepEqual(await get(owner), empty);
    const { modelResetKey } = await import('./_owner.js');
    await kv.set('save:'+other,{character:{patreon:{active:true,source:'promo',tier:'supporter'}}});
    Object.assign(process.env, modelCreationFixture);
    assert.deepEqual(await get(other), { status: 200, data: { ...empty.data, creationAvailable: true } });
    process.env.AVATAR_MODEL_CLEANUP_ENABLED = '0';
    assert.deepEqual(await get(other), empty);
    process.env.AVATAR_MODEL_CLEANUP_ENABLED = '1';
    await kv.set(modelResetKey, { id: 'local-reset', active: true });
    assert.deepEqual(await get(other), empty);
    await kv.del(modelResetKey);
    process.env.AVATAR_MODEL_CREATION_ENABLED = '0';
    const month = '2026-11';
    const jobId = 'job-test-001';
    const job = { slug: owner, accountId, assetId: id, monthKey: month, state: 'ready' };
    const asset = { owner, accountId, jobId, status: 'ready', version, privateKey: 'never-exposed' };
    const jobKey = 'avatar-model:job:' + jobId;
    const assetKey = 'avatar-model:asset:' + id;
    await kv.set('avatar-model:slot:' + owner + ':' + month, { jobId });
    await kv.set(jobKey, job);
    await kv.set(assetKey, asset);
    assert.deepEqual(await get(owner), { status: 200, data: { models: [{ assetId: id, version, month }], before: null } });
    await kv.set('avatar-model:slot:' + other + ':' + month, { jobId });
    assert.deepEqual(await get(other), empty);
    for (const override of [{ owner: other }, { status: 'revoked' }, { jobId: 'unrelated' }, { version: 'broken' },{accountId:undefined}]) {
        await kv.set(assetKey, { ...asset, ...override });
        assert.deepEqual(await get(owner), empty);
    }
    await kv.set(assetKey, asset);
    for (const override of [{ slug: other }, { monthKey: '2026-08' }, { monthKey: '2026-08', state: 'failed' },{accountId:undefined}]) {
        await kv.set(jobKey, { ...job, ...override });
        assert.deepEqual(await get(owner), empty);
    }
    await kv.set(jobKey, { ...job, state: 'render', privateLocation: 'never-exposed' });
    assert.deepEqual(await get(owner), { status: 200, data: {
        models: [], before: null, pending: { id: jobId, month, state: 'render' },
    } });
    assert.deepEqual(await get(other), empty);
    await kv.set(jobKey, { ...job, state: 'cancelled', internalReason: 'private' });
    const retained = { id: jobId, month, state: 'cancelled', slot: 'used' };
    assert.deepEqual(await get(owner), { status: 200, data: { models: [], before: null, ended: retained } });
    assert.deepEqual(await get(other, undefined, jobId), empty);
    const failedId = 'refunded-job-002';
    const failedMonth = '2026-12';
    await kv.set('avatar-model:job:' + failedId, { slug: owner, accountId, monthKey: failedMonth, state: 'failed', error: 'private' });
    const refunded = { id: failedId, month: failedMonth, state: 'failed', slot: 'available' };
    assert.deepEqual(await get(owner, undefined, failedId), { status: 200, data: { models: [], before: null, ended: refunded } });
    await kv.set('avatar-model:last-refund:' + owner, failedId);
    assert.deepEqual(await get(owner), { status: 200, data: { models: [], before: null, ended: refunded } });
    assert.deepEqual(await get(other, undefined, failedId), empty);
    assert.equal((await get(owner, undefined, '../../bad')).status, 400);
    const replacement = 'new-december-job';
    const replacementSlot = 'avatar-model:slot:' + owner + ':' + failedMonth;
    await kv.set(replacementSlot, { jobId: replacement });
    await kv.set('avatar-model:job:' + replacement, { slug: owner, accountId, monthKey: failedMonth, state: 'render' });
    assert.deepEqual(await get(owner, undefined, failedId), { status: 200, data: {
        models: [], before: null, pending: { id: replacement, month: failedMonth, state: 'render' },
    } });
    await kv.del(replacementSlot);
    await kv.set(jobKey, job);
    for (let m = 1; m <= 12; m++) {
        await kv.set('avatar-model:slot:' + owner + ':2027-' + String(m).padStart(2,'0'), { jobId: 'pending' });
    }
    assert.deepEqual(await get(owner), { status: 200, data: { models: [], before: '2027-01' } });
    assert.deepEqual(await get(owner, '2027-01'), { status: 200, data: { models: [{ assetId: id, version, month }], before: null } });
    await kv.set('save:'+owner,{character:{playerModelOwnerId:'d4ea59af-8e61-47b0-b563-cf8965d601d6'}});
    assert.deepEqual(await get(owner),empty,'A reused name cannot inherit the old library or refunds');
    process.env.ENABLE_SECTOR_MODEL_DISPLAY = '0';
    assert.deepEqual(await get(owner), empty);
});
