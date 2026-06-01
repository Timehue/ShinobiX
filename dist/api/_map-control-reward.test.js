"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _map_control_reward_js_1 = require("./_map-control-reward.js");
// The reward must stay BYTE-FOR-BYTE identical to the client's
// claimMapControlRewards (shinobij.client/src/App.tsx). These helpers replicate
// the client's exact inline expressions INDEPENDENTLY of the core under test, so
// any future drift in either side fails here (the "server == client output"
// non-negotiable for #7 / Stage 3).
// vanguardOnlyHonorSeals(character, amount) — App.tsx:3101
function clientVanguardOnlyHonorSeals(isVanguard, amount) {
    if (!isVanguard)
        return 0;
    return Math.max(0, Math.floor(amount));
}
// bonusFateShardsForHonor(_character, honorSealAmount) — App.tsx:3125
function clientBonusFateShardsForHonor(honorSealAmount) {
    const n = Math.max(0, Math.floor(honorSealAmount));
    if (n === 0)
        return 0;
    return Math.floor(n / 25);
}
// The exact client claim expressions, for `sectors` owned village sectors.
function clientReward(sectors, isVanguard) {
    const mapControlRyo = sectors * 100;
    const mapControlHonor = sectors * 2;
    const mapControlBone = Math.floor(sectors / 3);
    return {
        ryo: mapControlRyo,
        honorSeals: clientVanguardOnlyHonorSeals(isVanguard, mapControlHonor),
        boneCharms: mapControlBone,
        fateShards: clientBonusFateShardsForHonor(mapControlHonor),
    };
}
(0, node_test_1.describe)('computeMapControlReward', () => {
    (0, node_test_1.it)('matches the client formula for every sector count 0..60 (vanguard + non-vanguard)', () => {
        for (let s = 0; s <= 60; s++) {
            for (const isVanguard of [true, false]) {
                node_assert_1.strict.deepEqual((0, _map_control_reward_js_1.computeMapControlReward)(s, isVanguard), clientReward(s, isVanguard), `mismatch at sectors=${s}, vanguard=${isVanguard}`);
            }
        }
    });
    (0, node_test_1.it)('zero sectors yields nothing', () => {
        node_assert_1.strict.deepEqual((0, _map_control_reward_js_1.computeMapControlReward)(0, true), { ryo: 0, honorSeals: 0, boneCharms: 0, fateShards: 0 });
        node_assert_1.strict.deepEqual((0, _map_control_reward_js_1.computeMapControlReward)(0, false), { ryo: 0, honorSeals: 0, boneCharms: 0, fateShards: 0 });
    });
    (0, node_test_1.it)('honorSeals are Vanguard-only; the other three are profession-agnostic', () => {
        const vanguard = (0, _map_control_reward_js_1.computeMapControlReward)(13, true);
        const civilian = (0, _map_control_reward_js_1.computeMapControlReward)(13, false);
        // 13 sectors → honor 26 → 1 fate shard; bone floor(13/3)=4; ryo 1300.
        node_assert_1.strict.equal(vanguard.honorSeals, 26);
        node_assert_1.strict.equal(civilian.honorSeals, 0);
        node_assert_1.strict.equal(vanguard.ryo, civilian.ryo);
        node_assert_1.strict.equal(vanguard.boneCharms, civilian.boneCharms);
        node_assert_1.strict.equal(vanguard.fateShards, civilian.fateShards);
        node_assert_1.strict.equal(vanguard.fateShards, 1);
        node_assert_1.strict.equal(vanguard.boneCharms, 4);
    });
    (0, node_test_1.it)('clamps a fractional / negative sector count to a non-negative integer', () => {
        node_assert_1.strict.deepEqual((0, _map_control_reward_js_1.computeMapControlReward)(-5, true), { ryo: 0, honorSeals: 0, boneCharms: 0, fateShards: 0 });
        node_assert_1.strict.deepEqual((0, _map_control_reward_js_1.computeMapControlReward)(3.9, true), (0, _map_control_reward_js_1.computeMapControlReward)(3, true));
    });
});
