import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ENABLE_LEGACY = '1';

let kv: typeof import('./_storage.js').kv;
let attemptSageRoll: typeof import('./_legacy-sage-roll.js').attemptSageRoll;
let sageOfferKey: typeof import('./_legacy-sage-roll.js').sageOfferKey;

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ attemptSageRoll, sageOfferKey } = await import('./_legacy-sage-roll.js'));
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ENABLE_LEGACY;
});

test('an expired stored offer cannot suppress a new Sage roll', async () => {
    const player = 'expiredsageoffer';
    const now = 2_000_000_000_000;
    const character = { name: player, level: 100, village: 'Stormveil' };
    await kv.set(`save:${player}`, { character });
    await kv.set(sageOfferKey(player), {
        status: 'spawned',
        offers: [{
            legacyId: 'retired-offer',
            name: 'Old path',
            category: 'combat',
            flavor: 'Old flavor',
            title: 'Old title',
            villageAffinity: null,
            rarity: 'mythic',
        }],
        sector: 1,
        spawnedAt: now - 10_000,
        expiresAt: now - 1,
    });

    const result = await attemptSageRoll(player, {
        forced: true,
        now,
        character,
        stats: {
            pvpWins: 1_000,
            pvpKills: 1_000,
            pveKills: 5_000,
            eliteKills: 1_000,
            missionCompletions: 1_000,
            raidsCompleted: 1_000,
            warContribution: 1_000_000,
            petDuelWins: 1_000,
            petExpeditions: 1_000,
            cardClashWins: 1_000,
        },
    });

    assert.equal(result.spawn, true);
    assert.notEqual(result.reason, 'already-waiting');
    assert.equal(result.offer?.spawnedAt, now);
    assert.ok(result.offer?.offers.length);
    assert.ok(result.offer?.offers.every((entry) => !Object.prototype.hasOwnProperty.call(entry, 'rarity')));
});
