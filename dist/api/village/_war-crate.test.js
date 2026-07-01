"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const claim_war_crate_js_1 = require("./claim-war-crate.js");
const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000_000_000_000;
// A canonical ENDED, won war (winner = the claimant's side), 1 day ago.
function wonWar(warCrateId, over = {}) {
    return { winner: 'Stormveil', endedAt: NOW - DAY, warCrateId, ...over };
}
const VILLAGE_CRATE = 'war-crate-stormveil-vs-frostfang';
const CLAN_CRATE = 'clan-war-crate-ashen-vs-crimson';
(0, node_test_1.test)('parseWarCrate distinguishes village vs clan crate ids and extracts the warId', () => {
    node_assert_1.strict.deepEqual((0, claim_war_crate_js_1.parseWarCrate)(VILLAGE_CRATE), { kind: 'village', warId: 'stormveil-vs-frostfang' });
    node_assert_1.strict.deepEqual((0, claim_war_crate_js_1.parseWarCrate)(CLAN_CRATE), { kind: 'clan', warId: 'ashen-vs-crimson' });
    node_assert_1.strict.equal((0, claim_war_crate_js_1.parseWarCrate)('war-crate-foo'), null); // no -vs-
    node_assert_1.strict.equal((0, claim_war_crate_js_1.parseWarCrate)('war-crate-Storm-vs-Frost'), null); // uppercase (slugs are lowercase)
    node_assert_1.strict.equal((0, claim_war_crate_js_1.parseWarCrate)('mvp-crate-stormveil-vs-frostfang'), null); // unsupported crate kind
    node_assert_1.strict.equal((0, claim_war_crate_js_1.parseWarCrate)('war-crate-a-vs-b-vs-c'), null); // extra segment
    node_assert_1.strict.equal((0, claim_war_crate_js_1.parseWarCrate)(''), null);
    node_assert_1.strict.equal((0, claim_war_crate_js_1.parseWarCrate)('../../world:war:x'), null); // no key-injection
});
(0, node_test_1.test)('warCrateClaimDecision grants a legit, unclaimed, unexpired win (village + clan)', () => {
    node_assert_1.strict.deepEqual((0, claim_war_crate_js_1.warCrateClaimDecision)(wonWar(VILLAGE_CRATE), VILLAGE_CRATE, 'Stormveil', [], NOW), { granted: true, reason: 'granted' });
    node_assert_1.strict.deepEqual((0, claim_war_crate_js_1.warCrateClaimDecision)(wonWar(CLAN_CRATE), CLAN_CRATE, 'Stormveil', [], NOW), { granted: true, reason: 'granted' });
});
(0, node_test_1.test)('warCrateClaimDecision rejects a malformed crate id', () => {
    node_assert_1.strict.equal((0, claim_war_crate_js_1.warCrateClaimDecision)(wonWar(VILLAGE_CRATE), 'not-a-crate', 'Stormveil', [], NOW).reason, 'bad-crate-id');
});
(0, node_test_1.test)('warCrateClaimDecision rejects when the war is missing / unfinished / mismatched', () => {
    node_assert_1.strict.equal((0, claim_war_crate_js_1.warCrateClaimDecision)(null, VILLAGE_CRATE, 'Stormveil', [], NOW).reason, 'no-won-war');
    node_assert_1.strict.equal((0, claim_war_crate_js_1.warCrateClaimDecision)(wonWar(VILLAGE_CRATE, { endedAt: undefined }), VILLAGE_CRATE, 'Stormveil', [], NOW).reason, 'no-won-war');
    node_assert_1.strict.equal((0, claim_war_crate_js_1.warCrateClaimDecision)(wonWar(VILLAGE_CRATE, { winner: undefined }), VILLAGE_CRATE, 'Stormveil', [], NOW).reason, 'no-won-war');
    // Crate id doesn't match the war's server-stamped id → no grant.
    node_assert_1.strict.equal((0, claim_war_crate_js_1.warCrateClaimDecision)(wonWar('war-crate-other-vs-war'), VILLAGE_CRATE, 'Stormveil', [], NOW).reason, 'no-won-war');
});
(0, node_test_1.test)('warCrateClaimDecision rejects an expired crate (> 7 days after war end)', () => {
    node_assert_1.strict.equal((0, claim_war_crate_js_1.warCrateClaimDecision)(wonWar(VILLAGE_CRATE, { endedAt: NOW - 8 * DAY }), VILLAGE_CRATE, 'Stormveil', [], NOW).reason, 'expired');
});
(0, node_test_1.test)('warCrateClaimDecision rejects a claimant not on the winning side', () => {
    node_assert_1.strict.equal((0, claim_war_crate_js_1.warCrateClaimDecision)(wonWar(VILLAGE_CRATE), VILLAGE_CRATE, 'Frostfang', [], NOW).reason, 'not-winner');
    node_assert_1.strict.equal((0, claim_war_crate_js_1.warCrateClaimDecision)(wonWar(CLAN_CRATE), CLAN_CRATE, 'Crimson', [], NOW).reason, 'not-winner');
    node_assert_1.strict.equal((0, claim_war_crate_js_1.warCrateClaimDecision)(wonWar(VILLAGE_CRATE), VILLAGE_CRATE, '', [], NOW).reason, 'not-winner');
});
(0, node_test_1.test)('warCrateClaimDecision is idempotent — an already-claimed crate is not re-granted', () => {
    const d = (0, claim_war_crate_js_1.warCrateClaimDecision)(wonWar(VILLAGE_CRATE), VILLAGE_CRATE, 'Stormveil', [VILLAGE_CRATE], NOW);
    node_assert_1.strict.equal(d.reason, 'already-claimed');
    node_assert_1.strict.equal(d.granted, false);
});
