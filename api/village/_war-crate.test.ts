import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseWarCrateWarId, warCrateClaimDecision, type VillageWarLite } from './claim-war-crate.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000_000_000_000;

// A canonical ENDED war that Stormveil won.
function wonWar(over: Partial<VillageWarLite> = {}): VillageWarLite {
    return {
        id: 'stormveil-vs-frostfang',
        villages: ['Stormveil', 'Frostfang'],
        winnerVillage: 'Stormveil',
        endedAt: NOW - DAY, // 1 day ago (well within the 7-day window)
        warCrateId: 'war-crate-stormveil-vs-frostfang',
        ...over,
    };
}
const CRATE = 'war-crate-stormveil-vs-frostfang';

test('parseWarCrateWarId accepts only the canonical war-crate-<slug-vs-slug> shape', () => {
    assert.equal(parseWarCrateWarId(CRATE), 'stormveil-vs-frostfang');
    assert.equal(parseWarCrateWarId('war-crate-foo'), null);                 // no -vs-
    assert.equal(parseWarCrateWarId('war-crate-Storm-vs-Frost'), null);      // uppercase (slugs are lowercase)
    assert.equal(parseWarCrateWarId('mvp-crate-stormveil-vs-frostfang'), null); // wrong prefix
    assert.equal(parseWarCrateWarId('war-crate-a-vs-b-vs-c'), null);         // extra segment
    assert.equal(parseWarCrateWarId(''), null);
    assert.equal(parseWarCrateWarId('../../world:war:x' as string), null);   // no key-injection
});

test('warCrateClaimDecision grants a legit, unclaimed, unexpired village-win crate', () => {
    const d = warCrateClaimDecision(wonWar(), CRATE, 'Stormveil', [], NOW);
    assert.deepEqual(d, { granted: true, reason: 'granted' });
});

test('warCrateClaimDecision rejects a malformed crate id', () => {
    assert.equal(warCrateClaimDecision(wonWar(), 'not-a-crate', 'Stormveil', [], NOW).reason, 'bad-crate-id');
});

test('warCrateClaimDecision rejects when the war is missing / unfinished / mismatched', () => {
    assert.equal(warCrateClaimDecision(null, CRATE, 'Stormveil', [], NOW).reason, 'no-won-war');
    assert.equal(warCrateClaimDecision(wonWar({ endedAt: undefined }), CRATE, 'Stormveil', [], NOW).reason, 'no-won-war');
    assert.equal(warCrateClaimDecision(wonWar({ winnerVillage: undefined }), CRATE, 'Stormveil', [], NOW).reason, 'no-won-war');
    // Crate id doesn't match the war's server-stamped id → no grant.
    assert.equal(warCrateClaimDecision(wonWar({ warCrateId: 'war-crate-other-vs-war' }), CRATE, 'Stormveil', [], NOW).reason, 'no-won-war');
});

test('warCrateClaimDecision rejects an expired crate (> 7 days after war end)', () => {
    const d = warCrateClaimDecision(wonWar({ endedAt: NOW - 8 * DAY }), CRATE, 'Stormveil', [], NOW);
    assert.equal(d.reason, 'expired');
});

test('warCrateClaimDecision rejects a player from the losing (or any other) village', () => {
    assert.equal(warCrateClaimDecision(wonWar(), CRATE, 'Frostfang', [], NOW).reason, 'not-winner');
    assert.equal(warCrateClaimDecision(wonWar(), CRATE, 'Ashenleaf', [], NOW).reason, 'not-winner');
    assert.equal(warCrateClaimDecision(wonWar(), CRATE, '', [], NOW).reason, 'not-winner');
});

test('warCrateClaimDecision is idempotent — a crate already in claimedWarCrateIds is not re-granted', () => {
    const d = warCrateClaimDecision(wonWar(), CRATE, 'Stormveil', [CRATE], NOW);
    assert.equal(d.reason, 'already-claimed');
    assert.equal(d.granted, false);
});
