import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseWarCrate, warCrateClaimDecision, type WarWinnerLite } from './claim-war-crate.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000_000_000_000;

// A canonical ENDED, won war (winner = the claimant's side), 1 day ago.
function wonWar(warCrateId: string, over: Partial<WarWinnerLite> = {}): WarWinnerLite {
    return { winner: 'Stormveil', endedAt: NOW - DAY, warCrateId, ...over };
}
const VILLAGE_CRATE = 'war-crate-stormveil-vs-frostfang';
const CLAN_CRATE = 'clan-war-crate-ashen-vs-crimson';

test('parseWarCrate distinguishes village vs clan crate ids and extracts the warId', () => {
    assert.deepEqual(parseWarCrate(VILLAGE_CRATE), { kind: 'village', warId: 'stormveil-vs-frostfang' });
    assert.deepEqual(parseWarCrate(CLAN_CRATE), { kind: 'clan', warId: 'ashen-vs-crimson' });
    assert.equal(parseWarCrate('war-crate-foo'), null);                    // no -vs-
    assert.equal(parseWarCrate('war-crate-Storm-vs-Frost'), null);         // uppercase (slugs are lowercase)
    assert.equal(parseWarCrate('mvp-crate-stormveil-vs-frostfang'), null); // unsupported crate kind
    assert.equal(parseWarCrate('war-crate-a-vs-b-vs-c'), null);            // extra segment
    assert.equal(parseWarCrate(''), null);
    assert.equal(parseWarCrate('../../world:war:x' as string), null);      // no key-injection
});

test('warCrateClaimDecision grants a legit, unclaimed, unexpired win (village + clan)', () => {
    assert.deepEqual(warCrateClaimDecision(wonWar(VILLAGE_CRATE), VILLAGE_CRATE, 'Stormveil', [], NOW), { granted: true, reason: 'granted' });
    assert.deepEqual(warCrateClaimDecision(wonWar(CLAN_CRATE), CLAN_CRATE, 'Stormveil', [], NOW), { granted: true, reason: 'granted' });
});

test('warCrateClaimDecision rejects a malformed crate id', () => {
    assert.equal(warCrateClaimDecision(wonWar(VILLAGE_CRATE), 'not-a-crate', 'Stormveil', [], NOW).reason, 'bad-crate-id');
});

test('warCrateClaimDecision rejects when the war is missing / unfinished / mismatched', () => {
    assert.equal(warCrateClaimDecision(null, VILLAGE_CRATE, 'Stormveil', [], NOW).reason, 'no-won-war');
    assert.equal(warCrateClaimDecision(wonWar(VILLAGE_CRATE, { endedAt: undefined }), VILLAGE_CRATE, 'Stormveil', [], NOW).reason, 'no-won-war');
    assert.equal(warCrateClaimDecision(wonWar(VILLAGE_CRATE, { winner: undefined }), VILLAGE_CRATE, 'Stormveil', [], NOW).reason, 'no-won-war');
    // Crate id doesn't match the war's server-stamped id → no grant.
    assert.equal(warCrateClaimDecision(wonWar('war-crate-other-vs-war'), VILLAGE_CRATE, 'Stormveil', [], NOW).reason, 'no-won-war');
});

test('warCrateClaimDecision rejects an expired crate (> 7 days after war end)', () => {
    assert.equal(warCrateClaimDecision(wonWar(VILLAGE_CRATE, { endedAt: NOW - 8 * DAY }), VILLAGE_CRATE, 'Stormveil', [], NOW).reason, 'expired');
});

test('warCrateClaimDecision rejects a claimant not on the winning side', () => {
    assert.equal(warCrateClaimDecision(wonWar(VILLAGE_CRATE), VILLAGE_CRATE, 'Frostfang', [], NOW).reason, 'not-winner');
    assert.equal(warCrateClaimDecision(wonWar(CLAN_CRATE), CLAN_CRATE, 'Crimson', [], NOW).reason, 'not-winner');
    assert.equal(warCrateClaimDecision(wonWar(VILLAGE_CRATE), VILLAGE_CRATE, '', [], NOW).reason, 'not-winner');
});

test('warCrateClaimDecision is idempotent — an already-claimed crate is not re-granted', () => {
    const d = warCrateClaimDecision(wonWar(VILLAGE_CRATE), VILLAGE_CRATE, 'Stormveil', [VILLAGE_CRATE], NOW);
    assert.equal(d.reason, 'already-claimed');
    assert.equal(d.granted, false);
});
