import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { computeMapControlReward } from './_map-control-reward.js';

// The reward must stay BYTE-FOR-BYTE identical to the client's
// claimMapControlRewards (shinobij.client/src/App.tsx). These helpers replicate
// the client's exact inline expressions INDEPENDENTLY of the core under test, so
// any future drift in either side fails here (the "server == client output"
// non-negotiable for #7 / Stage 3).

// vanguardOnlyHonorSeals(character, amount) — App.tsx:3101
function clientVanguardOnlyHonorSeals(isVanguard: boolean, amount: number): number {
    if (!isVanguard) return 0;
    return Math.max(0, Math.floor(amount));
}
// bonusFateShardsForHonor(_character, honorSealAmount) — App.tsx:3125
function clientBonusFateShardsForHonor(honorSealAmount: number): number {
    const n = Math.max(0, Math.floor(honorSealAmount));
    if (n === 0) return 0;
    return Math.floor(n / 25);
}
// The exact client claim expressions, for `sectors` owned village sectors.
function clientReward(sectors: number, isVanguard: boolean) {
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

describe('computeMapControlReward', () => {
    it('matches the client formula for every sector count 0..60 (vanguard + non-vanguard)', () => {
        for (let s = 0; s <= 60; s++) {
            for (const isVanguard of [true, false]) {
                assert.deepEqual(
                    computeMapControlReward(s, isVanguard),
                    clientReward(s, isVanguard),
                    `mismatch at sectors=${s}, vanguard=${isVanguard}`,
                );
            }
        }
    });

    it('zero sectors yields nothing', () => {
        assert.deepEqual(computeMapControlReward(0, true), { ryo: 0, honorSeals: 0, boneCharms: 0, fateShards: 0 });
        assert.deepEqual(computeMapControlReward(0, false), { ryo: 0, honorSeals: 0, boneCharms: 0, fateShards: 0 });
    });

    it('honorSeals are Vanguard-only; the other three are profession-agnostic', () => {
        const vanguard = computeMapControlReward(13, true);
        const civilian = computeMapControlReward(13, false);
        // 13 sectors → honor 26 → 1 fate shard; bone floor(13/3)=4; ryo 1300.
        assert.equal(vanguard.honorSeals, 26);
        assert.equal(civilian.honorSeals, 0);
        assert.equal(vanguard.ryo, civilian.ryo);
        assert.equal(vanguard.boneCharms, civilian.boneCharms);
        assert.equal(vanguard.fateShards, civilian.fateShards);
        assert.equal(vanguard.fateShards, 1);
        assert.equal(vanguard.boneCharms, 4);
    });

    it('clamps a fractional / negative sector count to a non-negative integer', () => {
        assert.deepEqual(computeMapControlReward(-5, true), { ryo: 0, honorSeals: 0, boneCharms: 0, fateShards: 0 });
        assert.deepEqual(computeMapControlReward(3.9, true), computeMapControlReward(3, true));
    });
});
