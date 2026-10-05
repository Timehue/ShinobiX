import assert from 'node:assert/strict';
import { before, test } from 'node:test';
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ENABLE_LEGACY = '1';
delete process.env.DISCORD_ANNOUNCE_WEBHOOK_URL;
let kv: typeof import('./_storage.js').kv;
let era: typeof import('./_era.js');
before(async () => { ({ kv } = await import('./_storage.js')); era = await import('./_era.js'); });

test('400 per-player discoveries can open Era V without pending overflow or duplicate replay', async () => {
    const def = era.ERA_BY_ID.get('mythic-legacies')!;
    await kv.set('save:finisher', { character: { name: 'finisher', serverTitles: [], earnedTitles: [] } });
    for (const milestone of def.milestones) if (milestone.metric !== 'discoveries') await kv.set(`era:contrib:${milestone.metric}`, milestone.required);
    await era.recordEraTrigger('first-mythic-awakening', { player: 'finisher' });
    for (let n = 0; n < 399; n++) {
        assert.equal(await era.bumpEraDiscoveryContribution(n % 2 ? 'north' : 'south', `wanderer-discovery:road-${Math.floor(n / 2)}`), true);
    }
    assert.equal((await era.readEraContributions()).discoveries, 399);
    assert.deepEqual(await era.checkEraUnlocks(), []);
    assert.equal(await era.bumpEraDiscoveryContribution('north', 'wanderer-discovery:road-199'), true);
    assert.equal((await era.readEraContributions()).discoveries, 400);
    assert.deepEqual(await era.checkEraUnlocks(), ['mythic-legacies']);
    assert.equal(await era.currentEraNumber(), 5);
    for (let n = 0; n < 400; n++) await era.bumpEraDiscoveryContribution(n % 2 ? 'north' : 'south', `wanderer-discovery:road-${Math.floor(n / 2)}`);
    assert.equal((await era.readEraContributions()).discoveries, 400);
    assert.equal(await kv.get('era:contrib-idempotent:discoveries'), null, 'fully settled events need no pending acknowledgement');
    for (let n = 0; n < 300; n++) await era.bumpEraContributionOnce('warBattles', `war:${n}`);
    assert.equal((await era.readEraContributions()).warBattles, 300, 'the other independently settled source also cannot stall at 256');
});

test('historic discovery totals remain readable alongside new durable receipts', async () => {
    await kv.set('era:contrib:discoveries', 10);
    await kv.set('era:contrib-idempotent:discoveries', { version: 1, compactedTotal: 4,
        pending: [{ version: 1, receiptId: 'old-unattributed', amount: 1, appliedAt: 100 }], settled: [] });
    assert.equal((await era.readEraContributions()).discoveries, 415);
});
