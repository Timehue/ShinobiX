"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _run_token_js_1 = require("./_run-token.js");
const settle_js_1 = require("./settle.js");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
// The api/ (cPanel tsc) and shinobij.client/ (Vite) build roots are separate
// module systems, so — like _cross-build-parity.test.ts — the drift guard reads
// the client run lib as TEXT rather than importing it across the boundary.
const CLIENT_RUN_SRC = (0, node_fs_1.readFileSync)((0, node_path_1.join)('shinobij.client', 'src', 'lib', 'hollow-gate-run.ts'), 'utf8');
(0, node_test_1.test)('hollowShardDrop matches the documented curve, and the client source still defines it (drift guard)', () => {
    for (let f = 1; f <= 8; f++) {
        node_assert_1.strict.equal((0, _run_token_js_1.hollowShardDrop)(f, 'chest'), 2 + f);
        node_assert_1.strict.equal((0, _run_token_js_1.hollowShardDrop)(f, 'shardVein'), 3 + f * 2);
        node_assert_1.strict.equal((0, _run_token_js_1.hollowShardDrop)(f, 'lockedChest'), 5 + f * 2);
        node_assert_1.strict.equal((0, _run_token_js_1.hollowShardDrop)(f, 'boss'), 15 + f * 5);
    }
    // The CLIENT source must still define these exact formulas — if it changes,
    // this fails so the server mirror gets updated in lockstep.
    node_assert_1.strict.ok(CLIENT_RUN_SRC.includes('return 2 + f;'), 'client chest curve drifted');
    node_assert_1.strict.ok(CLIENT_RUN_SRC.includes('return 3 + f * 2;'), 'client shardVein curve drifted');
    node_assert_1.strict.ok(CLIENT_RUN_SRC.includes('return 5 + f * 2;'), 'client lockedChest curve drifted');
    node_assert_1.strict.ok(CLIENT_RUN_SRC.includes('return 15 + f * 5;'), 'client boss curve drifted');
});
(0, node_test_1.test)('clawback key set matches the client source', () => {
    node_assert_1.strict.equal(_run_token_js_1.HG_CLAWBACK_KEYS.length, 7);
    for (const k of _run_token_js_1.HG_CLAWBACK_KEYS) {
        node_assert_1.strict.ok(CLIENT_RUN_SRC.includes(`"${k}"`), `client clawback keys missing ${k}`);
    }
});
(0, node_test_1.test)('maxHaulForDepth grows with depth, scales by the sealed multiplier, and is finite/positive', () => {
    const d3 = (0, _run_token_js_1.maxHaulForDepth)(3, 1);
    const d5 = (0, _run_token_js_1.maxHaulForDepth)(5, 1);
    node_assert_1.strict.ok(d5.hollowShards > d3.hollowShards, 'deeper runs allow a bigger ceiling');
    const d3x2 = (0, _run_token_js_1.maxHaulForDepth)(3, 2);
    node_assert_1.strict.equal(d3x2.hollowShards, Math.ceil((0, _run_token_js_1.maxShardsForDepth)(3) * 2), 'multiplier scales the shard ceiling');
    node_assert_1.strict.ok(d3x2.ryo > d3.ryo, 'multiplier scales the other currencies too');
    for (const k of _run_token_js_1.HG_CLAWBACK_KEYS)
        node_assert_1.strict.ok(d5[k] > 0 && Number.isFinite(d5[k]), `${k} ceiling must be finite+positive (bounds farming)`);
});
(0, node_test_1.test)('rollAugmentOffers returns N distinct real catalog augments', () => {
    const offers = (0, _run_token_js_1.rollAugmentOffers)(3);
    node_assert_1.strict.equal(offers.length, 3);
    node_assert_1.strict.equal(new Set(offers.map((o) => o.id)).size, 3, 'no duplicate offers');
    for (const o of offers)
        node_assert_1.strict.ok(_run_token_js_1.AUGMENT_CATALOG[o.id], 'offer is a real augment');
});
(0, node_test_1.test)('rewardMultiplier comes ONLY from the sealed chosen augment', () => {
    node_assert_1.strict.equal((0, _run_token_js_1.rewardMultiplierForToken)({ chosenAugmentId: null }), 1);
    node_assert_1.strict.equal((0, _run_token_js_1.rewardMultiplierForToken)({ chosenAugmentId: 'greedy-pact' }), 2.0);
    node_assert_1.strict.equal((0, _run_token_js_1.rewardMultiplierForToken)({ chosenAugmentId: 'not-a-real-augment' }), 1, 'unknown id → no multiplier (no inflation)');
});
(0, node_test_1.test)('every augment multiplier is a reward bonus (>=1) and capped (<=2)', () => {
    for (const a of Object.values(_run_token_js_1.AUGMENT_CATALOG)) {
        node_assert_1.strict.ok(a.rewardMultiplier >= 1 && a.rewardMultiplier <= 2.0, `${a.id} multiplier out of bounds`);
    }
});
(0, node_test_1.test)('augmentDisplay never leaks the rewardMultiplier to the client', () => {
    const d = (0, _run_token_js_1.augmentDisplay)(_run_token_js_1.AUGMENT_CATALOG['greedy-pact']);
    node_assert_1.strict.equal(d.rewardMultiplier, undefined, 'sealed multiplier must not be sent to the client');
    node_assert_1.strict.equal(d.id, 'greedy-pact');
});
(0, node_test_1.test)('settleCurrency clamps an over-claim to the sealed ceiling', () => {
    // A crafted client reports a huge balance + claim; the ceiling caps the credit.
    node_assert_1.strict.equal((0, settle_js_1.settleCurrency)(1_000_000, 100, 5000, 50, 1), 150); // entry 100 + min(5000,50) = 150
});
(0, node_test_1.test)('settleCurrency applies the server death claw-back (x0.5)', () => {
    node_assert_1.strict.equal((0, settle_js_1.settleCurrency)(140, 100, 40, 1000, 0.5), 120); // entry 100 + floor(40*0.5)=20
});
(0, node_test_1.test)('settleCurrency never restores in-run spends (min with current balance)', () => {
    // Player spent below their entry mid-run — settle must not refund them back up.
    node_assert_1.strict.equal((0, settle_js_1.settleCurrency)(80, 100, 30, 1000, 1), 80);
});
(0, node_test_1.test)('settleCurrency floors at 0 and ignores negative/junk input', () => {
    node_assert_1.strict.equal((0, settle_js_1.settleCurrency)(-5, 0, -10, 50, 1), 0);
    node_assert_1.strict.equal((0, settle_js_1.settleCurrency)(0, 0, 9999, 0, 1), 0); // zero ceiling → no credit
});
// ─── P0.2c high-value ITEM ceiling (Dungeon Legendary Fragment) ──────────────────
(0, node_test_1.test)('HG_HIGH_VALUE_ITEM_ID mirrors the client DUNGEON_LEGENDARY_FRAGMENT_ID (drift guard)', () => {
    node_assert_1.strict.equal(_run_token_js_1.HG_HIGH_VALUE_ITEM_ID, 'dungeon-legendary-fragment');
    const CLIENT_GAME_CONSTS = (0, node_fs_1.readFileSync)((0, node_path_1.join)('shinobij.client', 'src', 'constants', 'game.ts'), 'utf8');
    node_assert_1.strict.ok(CLIENT_GAME_CONSTS.includes('DUNGEON_LEGENDARY_FRAGMENT_ID = "dungeon-legendary-fragment"'), 'client fragment id drifted from the server mirror');
});
(0, node_test_1.test)('maxFragmentsForDepth grows with depth, clamps to 1..20, and is always positive', () => {
    node_assert_1.strict.equal((0, _run_token_js_1.maxFragmentsForDepth)(1), 1);
    node_assert_1.strict.equal((0, _run_token_js_1.maxFragmentsForDepth)(5), 5);
    node_assert_1.strict.ok((0, _run_token_js_1.maxFragmentsForDepth)(5) > (0, _run_token_js_1.maxFragmentsForDepth)(3), 'deeper runs allow more fragments');
    node_assert_1.strict.equal((0, _run_token_js_1.maxFragmentsForDepth)(0), 1, 'floors at 1');
    node_assert_1.strict.equal((0, _run_token_js_1.maxFragmentsForDepth)(999), 20, 'clamps at 20');
    node_assert_1.strict.equal((0, _run_token_js_1.maxFragmentsForDepth)(NaN), 1, 'junk → 1');
});
(0, node_test_1.test)('settleItemCount clamps an over-claim to the sealed ceiling', () => {
    node_assert_1.strict.equal((0, _run_token_js_1.settleItemCount)(99, 5, 1), 5); // claimed 99, ceiling 5 → 5
    node_assert_1.strict.equal((0, _run_token_js_1.settleItemCount)(2, 5, 1), 2); // under the ceiling → claimed
});
(0, node_test_1.test)('settleItemCount applies the death claw-back fraction and floors', () => {
    node_assert_1.strict.equal((0, _run_token_js_1.settleItemCount)(4, 10, 0.5), 2); // floor(min(4,10)*0.5)
    node_assert_1.strict.equal((0, _run_token_js_1.settleItemCount)(1, 10, 0.5), 0); // a lone fragment is lost on death
});
(0, node_test_1.test)('settleItemCount floors at 0 and ignores negative/junk input', () => {
    node_assert_1.strict.equal((0, _run_token_js_1.settleItemCount)(-3, 5, 1), 0);
    node_assert_1.strict.equal((0, _run_token_js_1.settleItemCount)(5, 0, 1), 0); // zero ceiling → no credit
    node_assert_1.strict.equal((0, _run_token_js_1.settleItemCount)('junk', 5, 1), 0);
    node_assert_1.strict.equal((0, _run_token_js_1.settleItemCount)(undefined, 5, 1), 0); // current clients send nothing → inert
});
