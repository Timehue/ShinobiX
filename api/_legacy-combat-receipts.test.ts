import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kv } from './_storage.js';
import { bumpLegacyStats, acknowledgeLegacyCombatReceipt, getLegacyStats, hasLegacyActivityReceipt } from './_legacy-track.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ENABLE_LEGACY = '1';

test('pending combat proof survives receipt churn and terminal cleanup never reopens a stale reader', async () => {
    const player = 'legacycombatproof';
    await kv.set(`legacy:stats:${player}`, { bootstrappedAt: Date.now() });
    let settled = false;
    const opts = { receiptId: 'tower-combat:proof-run:legacycombatproof', durableReceipt: true, sourceSettled: async () => settled };
    assert.equal(await bumpLegacyStats(player, { towerClears: 1 }, opts), true);
    for (let i = 0; i < 270; i++) assert.equal(await bumpLegacyStats(player, {}, { receiptId: `churn:${i}` }), true);
    assert.equal(await bumpLegacyStats(player, { towerClears: 1 }, opts), true);
    assert.equal((await getLegacyStats(player)).towerClears, 1);
    settled = true;
    assert.equal(await acknowledgeLegacyCombatReceipt(player, opts.receiptId), true);
    assert.equal(hasLegacyActivityReceipt(await getLegacyStats(player), opts.receiptId), false);
    assert.equal(await bumpLegacyStats(player, { towerClears: 1 }, opts), true, 'stale source reader resolves through the committed terminal marker');
    assert.equal((await getLegacyStats(player)).towerClears, 1);
});

test('an unreadable source refuses progress without consuming its proof', async () => {
    const player = 'legacycombatunreadable';
    await kv.set(`legacy:stats:${player}`, { bootstrappedAt: Date.now() });
    const receiptId = 'world-boss-operation:unreadable-source';
    assert.equal(await bumpLegacyStats(player, { worldBossOperations: 1 }, { receiptId, durableReceipt: true,
        sourceSettled: async () => { throw new Error('source temporarily unavailable'); } }), false);
    assert.equal((await getLegacyStats(player)).worldBossOperations, undefined);
    assert.equal(hasLegacyActivityReceipt(await getLegacyStats(player), receiptId), false);
});
