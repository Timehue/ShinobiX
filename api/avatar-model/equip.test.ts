import assert from 'node:assert/strict';
import { test } from 'node:test';

test('owned ready models equip atomically and propagate to sector presence', async (t) => {
    process.env.NODE_ENV = 'test';
    process.env.SHINOBIX_QA_MEMORY_KV = '1';
    process.env.SESSION_SECRET = 'local-equip-fixture-secret-32-bytes';
    process.env.ENABLE_SECTOR_MODEL_DISPLAY = '1';
    const handler = (await import('./equip.js')).default as unknown as (req: never, res: never) => Promise<unknown>;
    const { kv } = await import('../_storage.js');
    const { issuePlayerToken } = await import('../_auth.js');
    const { onlineStore } = await import('../_realtime/online-store.js');
    const owner = 'modelequiptest';
    const id = 'b'.repeat(32);
    const ref = { assetId: id, version: 'c'.repeat(64) };
    const assetKey = 'avatar-model:asset:' + id;
    const saveKey = 'save:' + owner;
    const accountId='6f909a6b-8f70-4c38-a627-6b47ac2784cb';
    const ready = { owner, accountId, version: ref.version, status: 'ready' };
    const original = { _saveVersion: 1, character: { name: owner, level: 10, playerModelOwnerId:accountId } };
    await kv.set('avatar-model:owner:'+accountId,{owner,id:accountId,state:'active',createdAt:1});
    await kv.set(saveKey, original);
    async function post(body: unknown, authenticated = true) {
        let code = 0;
        let json: unknown;
        const response = {
            setHeader() {}, status(status: number) { code = status; return response; },
            json(value: unknown) { json = value; }, end() {},
        };
        const req = { method: 'POST', headers: authenticated ? { 'x-player-token': issuePlayerToken(owner) } : {},
            body, query: {}, socket: { remoteAddress: '127.0.0.1' } };
        await handler(req as never, response as never);
        return { code, json };
    }
    assert.equal((await post({ assetId: id }, false)).code, 401);
    assert.equal((await post(ref)).code, 400);
    assert.equal((await post({ assetId: 'invalid' })).code, 400);
    for (const asset of [{ ...ready, owner: 'someoneelse' }, { ...ready, status: 'revoked' }, { ...ready, version: 'invalid' },
        {...ready,accountId:undefined},{...ready,accountId:'907b466c-a0ec-4239-ad23-8b04db214afe'}]) {
        await kv.set(assetKey, asset);
        assert.equal((await post({ assetId: id })).code, 404);
    }
    assert.deepEqual(await kv.get(saveKey), original);
    await kv.set(assetKey, ready);
    const batch = kv.compareSetMany!.bind(kv);
    const revoke = t.mock.method(kv as typeof kv & { compareSetMany: typeof batch }, 'compareSetMany', async (ops: Parameters<typeof batch>[0]) => {
        if (ops.some(op => op.key === assetKey)) await kv.set(assetKey, { ...ready, status: 'revoked' });
        return batch(ops);
    });
    assert.equal((await post({ assetId: id })).code, 409);
    assert.deepEqual(await kv.get(saveKey), original);
    revoke.mock.restore();
    await kv.set(assetKey, ready);
    const equipped = await post({ assetId: id });
    assert.deepEqual(equipped, { code: 200, json: { playerModel: ref, _saveVersion: 2 } });
    assert.deepEqual(await kv.get(assetKey), ready);
    assert.equal(onlineStore.get(owner), null);
    const player = onlineStore.upsert({ name: owner, sector: 1, character: null,
        restoredPlayerModel: { ...ref, version: 'd'.repeat(64) } });
    assert.deepEqual(player.playerModel, ref);
    assert.deepEqual(await post({ assetId: id }), equipped);
    process.env.ENABLE_SECTOR_MODEL_DISPLAY = '0';
    assert.equal((await post({ assetId: id })).code, 403);
    const removed = await post({ assetId: null });
    assert.deepEqual(removed, { code: 200, json: { playerModel: null, _saveVersion: 3 } });
    assert.deepEqual(await post(null), removed);
    assert.equal(onlineStore.get(owner)?.playerModel, undefined);
    const saved = await kv.get<{ character: { playerModel: unknown } }>(saveKey);
    assert.equal(saved!.character.playerModel, undefined);
    assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(saved!.character)), 'playerModel'), false);
});
