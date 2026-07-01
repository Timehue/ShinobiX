"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const claim_war_crate_js_1 = require("./claim-war-crate.js");
const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000_000_000_000;
// A canonical ENDED war that Stormveil won.
function wonWar(over = {}) {
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
(0, node_test_1.test)('parseWarCrateWarId accepts only the canonical war-crate-<slug-vs-slug> shape', () => {
    node_assert_1.strict.equal((0, claim_war_crate_js_1.parseWarCrateWarId)(CRATE), 'stormveil-vs-frostfang');
    node_assert_1.strict.equal((0, claim_war_crate_js_1.parseWarCrateWarId)('war-crate-foo'), null); // no -vs-
    node_assert_1.strict.equal((0, claim_war_crate_js_1.parseWarCrateWarId)('war-crate-Storm-vs-Frost'), null); // uppercase (slugs are lowercase)
    node_assert_1.strict.equal((0, claim_war_crate_js_1.parseWarCrateWarId)('mvp-crate-stormveil-vs-frostfang'), null); // wrong prefix
    node_assert_1.strict.equal((0, claim_war_crate_js_1.parseWarCrateWarId)('war-crate-a-vs-b-vs-c'), null); // extra segment
    node_assert_1.strict.equal((0, claim_war_crate_js_1.parseWarCrateWarId)(''), null);
    node_assert_1.strict.equal((0, claim_war_crate_js_1.parseWarCrateWarId)('../../world:war:x'), null); // no key-injection
});
(0, node_test_1.test)('warCrateClaimDecision grants a legit, unclaimed, unexpired village-win crate', () => {
    const d = (0, claim_war_crate_js_1.warCrateClaimDecision)(wonWar(), CRATE, 'Stormveil', [], NOW);
    node_assert_1.strict.deepEqual(d, { granted: true, reason: 'granted' });
});
(0, node_test_1.test)('warCrateClaimDecision rejects a malformed crate id', () => {
    node_assert_1.strict.equal((0, claim_war_crate_js_1.warCrateClaimDecision)(wonWar(), 'not-a-crate', 'Stormveil', [], NOW).reason, 'bad-crate-id');
});
(0, node_test_1.test)('warCrateClaimDecision rejects when the war is missing / unfinished / mismatched', () => {
    node_assert_1.strict.equal((0, claim_war_crate_js_1.warCrateClaimDecision)(null, CRATE, 'Stormveil', [], NOW).reason, 'no-won-war');
    node_assert_1.strict.equal((0, claim_war_crate_js_1.warCrateClaimDecision)(wonWar({ endedAt: undefined }), CRATE, 'Stormveil', [], NOW).reason, 'no-won-war');
    node_assert_1.strict.equal((0, claim_war_crate_js_1.warCrateClaimDecision)(wonWar({ winnerVillage: undefined }), CRATE, 'Stormveil', [], NOW).reason, 'no-won-war');
    // Crate id doesn't match the war's server-stamped id → no grant.
    node_assert_1.strict.equal((0, claim_war_crate_js_1.warCrateClaimDecision)(wonWar({ warCrateId: 'war-crate-other-vs-war' }), CRATE, 'Stormveil', [], NOW).reason, 'no-won-war');
});
(0, node_test_1.test)('warCrateClaimDecision rejects an expired crate (> 7 days after war end)', () => {
    const d = (0, claim_war_crate_js_1.warCrateClaimDecision)(wonWar({ endedAt: NOW - 8 * DAY }), CRATE, 'Stormveil', [], NOW);
    node_assert_1.strict.equal(d.reason, 'expired');
});
(0, node_test_1.test)('warCrateClaimDecision rejects a player from the losing (or any other) village', () => {
    node_assert_1.strict.equal((0, claim_war_crate_js_1.warCrateClaimDecision)(wonWar(), CRATE, 'Frostfang', [], NOW).reason, 'not-winner');
    node_assert_1.strict.equal((0, claim_war_crate_js_1.warCrateClaimDecision)(wonWar(), CRATE, 'Ashenleaf', [], NOW).reason, 'not-winner');
    node_assert_1.strict.equal((0, claim_war_crate_js_1.warCrateClaimDecision)(wonWar(), CRATE, '', [], NOW).reason, 'not-winner');
});
(0, node_test_1.test)('warCrateClaimDecision is idempotent — a crate already in claimedWarCrateIds is not re-granted', () => {
    const d = (0, claim_war_crate_js_1.warCrateClaimDecision)(wonWar(), CRATE, 'Stormveil', [CRATE], NOW);
    node_assert_1.strict.equal(d.reason, 'already-claimed');
    node_assert_1.strict.equal(d.granted, false);
});
