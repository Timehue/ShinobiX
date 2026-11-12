import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

test('deleted model account links are erased after confirmed files and billing, without touching a replacement account', async () => {
    Object.assign(process.env, { NODE_ENV: 'test', SHINOBIX_QA_MEMORY_KV: '1' });
    const { kv } = await import('../_storage.js');
    const { sweepDeletedModelOwners } = await import('./_account-erasure.js');
    const { reconcileModelCost } = await import('./_cost-reconciliation.js');
    const prefix = 'avatar-model:';
    const accountId = randomUUID(), successorId = randomUUID(), owner = 'retentionfixture';
    const ownerKey = prefix + 'owner:' + accountId;
    const successorKey = prefix + 'owner:' + successorId;
    const saveKey = 'save:' + owner;
    const revisionKey = prefix + 'revision:' + owner;
    const jobId = 'erasure-billed-job', jobKey = prefix + 'job:' + jobId;
    const assetId = 'a'.repeat(32), version = 'c'.repeat(64);
    const assetKey = prefix + 'asset:' + assetId, cleanupKey = prefix + 'cleanup:' + assetId;
    const refKey = prefix + 'private-ref:' + randomUUID(), removalKey = prefix + 'removal:' + 'e'.repeat(64);
    const cycle = 'retention-fixture';
    const billingKey = prefix + 'budget:modal:' + cycle;
    const sourceSha256 = 'd'.repeat(64);
    const deletion = { id: accountId, owner, state: 'deleting', createdAt: 1 };
    const successor = { id: successorId, owner, state: 'active', createdAt: 2 };
    const successorSave = { character: { name: owner, playerModelOwnerId: successorId } };
    const job = { slug: owner, accountId, assetId, state: 'cancelled', attempt: 1, createdAt: Date.now(),
        sourceSha256, privateRefKey: refKey, providerCalls: { 'A/1': 'fc-paid' },
        reserved: [{ provider: 'modal', cycle, micros: 300 }], summary: 'private fit description', path: 'A' };
    const tombstone = { assetId, version, accountId, owner, jobId, state: 'pending', sourceSha256 };
    await Promise.all([
        kv.set(ownerKey, deletion),
        kv.set(successorKey, successor),
        kv.set(saveKey, { character: { name: owner, playerModelOwnerId: accountId } }),
        kv.set(revisionKey, 4),
        kv.set(jobKey, job),
        kv.set(refKey, { accountId, owner, state: 'job' }),
        kv.set(assetKey, { assetId, accountId, owner, jobId, version, status: 'revoked', removalReceipt: removalKey }),
        kv.set(cleanupKey, tombstone),
        kv.set(removalKey, { owner, assetId, reason: 'private reason' }),
        kv.set(billingKey, { reservedMicros: 300, spentMicros: 0 }),
    ]);
    assert.equal(await sweepDeletedModelOwners(), 0, 'the old save still binds the account');
    await kv.set(saveKey, successorSave);
    assert.equal(await sweepDeletedModelOwners(), 0, 'the private reference still exists');
    await kv.del(refKey);
    assert.equal(await sweepDeletedModelOwners(), 0, 'the public files are pending');
    await kv.set(cleanupKey, { ...tombstone, state: 'complete' });
    assert.equal(await sweepDeletedModelOwners(), 0, 'a completion needs the confirmed erasure timestamp');
    const completedAt = Date.now();
    await kv.set(cleanupKey, { ...tombstone, state: 'complete', completedAt });
    assert.equal(await sweepDeletedModelOwners(), 0, 'the provider statement is outstanding');
    assert.deepEqual(await kv.get(jobKey), job);

    const statement = { final: true as const, currency: 'USD' as const, provider: 'modal' as const, jobId, assetId,
        charges: [{ eventId: 'account-erasure-final', callId: 'fc-paid', cycle, micros: 125, billedMilliseconds: 2000 }] };
    const settled = await reconcileModelCost(statement, true);
    assert.equal(await sweepDeletedModelOwners(), 1);
    assert.equal(await kv.get(ownerKey), null);
    assert.equal(await kv.get(assetKey), null);
    assert.equal(await kv.get(removalKey), null);
    assert.deepEqual(await kv.get(cleanupKey), { assetId, state: 'complete', completedAt });
    const anonymous = await kv.get<Record<string,unknown>>(jobKey);
    assert.ok(anonymous && typeof anonymous.erasedAt === 'number');
    assert.deepEqual(Object.keys(anonymous).sort(),
        ['assetId', 'attempt', 'createdAt', 'erasedAt', 'path', 'reserved', 'settledCosts', 'state']);
    assert.deepEqual(await reconcileModelCost(statement, true), { ...settled, status: 'already-settled' });
    assert.deepEqual(await kv.get(billingKey), { reservedMicros: 0, spentMicros: 125 });
    assert.deepEqual(await kv.get(successorKey), successor);
    assert.deepEqual(await kv.get(saveKey), successorSave);
    assert.equal(await kv.get(revisionKey), 4);
    assert.equal(await sweepDeletedModelOwners(), 0);
});

test('an unclaimed job can be minimized after deletion without a public file receipt', async () => {
    Object.assign(process.env, { NODE_ENV: 'test', SHINOBIX_QA_MEMORY_KV: '1' });
    const { kv } = await import('../_storage.js');
    const { sweepDeletedModelOwners } = await import('./_account-erasure.js');
    const prefix = 'avatar-model:';
    const id = randomUUID(), owner = 'erasureunclaimed';
    const key = prefix + 'job:erasure-unclaimed';
    await kv.set(prefix + 'owner:' + id, { id, owner, state: 'deleting', createdAt: 1 });
    await kv.set(prefix + 'revision:' + owner, 2);
    await kv.set(key, { slug: owner, accountId: id, assetId: 'f'.repeat(32), state: 'cancelled',
        attempt: 0, reserved: [] });
    assert.equal(await sweepDeletedModelOwners(), 1);
    assert.equal(await kv.get(prefix + 'revision:' + owner), null);
    assert.equal(await kv.get(prefix + 'owner:' + id), null);
    assert.equal((await kv.get<Record<string,unknown>>(key))?.accountId, undefined);
});
