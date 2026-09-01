import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ENABLE_LEGACY = '1';

let kv: typeof import('./_storage.js').kv;
let reserveEconomyTx: typeof import('./_economy-tx.js').reserveEconomyTx;
let completeEconomyTx: typeof import('./_economy-tx.js').completeEconomyTx;
let economyTxKey: typeof import('./_economy-tx.js').economyTxKey;
let queueEconomyLegacyIntent: typeof import('./_legacy-economy-outbox.js').queueEconomyLegacyIntent;
let deliverEconomyLegacyIntent: typeof import('./_legacy-economy-outbox.js').deliverEconomyLegacyIntent;

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ reserveEconomyTx, completeEconomyTx, economyTxKey } = await import('./_economy-tx.js'));
    ({ queueEconomyLegacyIntent, deliverEconomyLegacyIntent } = await import('./_legacy-economy-outbox.js'));
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ENABLE_LEGACY;
});

test('economy Legacy intent waits for commit, dedupes, then delivers exactly once', async () => {
    const player = 'legacyoutbox';
    const txId = 'village-donation:legacy-outbox-test';
    const outboxKey = `legacy:economy-outbox:${player}`;
    await kv.set(`save:${player}`, {
        character: { name: player, level: 60, village: 'Stormveil' },
    });
    await reserveEconomyTx({
        id: txId,
        kind: 'village-donation',
        debitKey: `save:${player}`,
        creditKey: 'village:treasury:stormveil',
        resource: 'ryo',
        amount: 450,
    });

    await queueEconomyLegacyIntent(player, txId, { villageDonations: 450 });
    await queueEconomyLegacyIntent(player, txId, { villageDonations: 999 });
    const queued = await kv.get<Array<{ txId: string; deltas: { villageDonations?: number } }>>(outboxKey);
    assert.equal(queued?.length, 1, 'the transaction id is the outbox identity');
    assert.equal(queued?.[0]?.deltas.villageDonations, 450, 'a retry cannot rewrite the sealed amount');

    assert.equal(await deliverEconomyLegacyIntent(player, txId), false, 'reserved is not proof of donation');
    assert.equal(await kv.get(`legacy:stats:${player}`), null);

    await completeEconomyTx(txId);
    assert.equal((await kv.get<{ state: string }>(economyTxKey(txId)))?.state, 'complete');
    assert.equal(await deliverEconomyLegacyIntent(player, txId), true);
    const stats = await kv.get<{ villageDonations?: number; activityReceipts?: string[] }>(`legacy:stats:${player}`);
    assert.equal(stats?.villageDonations, 450);
    assert.ok(stats?.activityReceipts?.includes(`economy:${txId}`));
    assert.equal(await kv.get(outboxKey), null, 'confirmed intent is removed');

    assert.equal(await deliverEconomyLegacyIntent(player, txId), true, 'missing intent is a completed replay');
    assert.equal((await kv.get<{ villageDonations?: number }>(`legacy:stats:${player}`))?.villageDonations, 450);
});
