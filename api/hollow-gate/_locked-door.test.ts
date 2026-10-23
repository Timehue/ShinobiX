import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    LOCKED_DOOR_AURA_DUST_BAND,
    LOCKED_DOOR_BONE_CHARM_BAND,
    LOCKED_DOOR_FATE_SHARD_BAND,
    maxLockedDoorsForDepth,
    rollHollowLockedDoor,
} from './_locked-door.js';

/** A scripted RNG: each call returns the next value, then `fallback`. */
const sequence = (values: number[], fallback = 0.99) => { let i = 0; return () => values[i++] ?? fallback; };

describe('Hollow Gate locked-door authority', () => {
    it('keeps the canonical chest loot and trap band', () => {
        const chest = rollHollowLockedDoor(sequence([0.1, 0.4, 0.5, 0.1, 0.5], 0.5), 1, 5);
        assert.equal(chest.outcome, 'chest');
        // Character XP retired: the old xp line (100 + floor·10) is now a
        // guaranteed ryo floor (75 + floor·8); this sequence also wins the
        // 50% bonus ryo roll (0.4 → +100+floor(0.5·401)=+300).
        assert.equal(chest.loot?.xp, 0);
        assert.equal(chest.loot?.ryo, (75 + 40) + 100 + 200);
        assert.equal(chest.loot?.fateShards, 1, 'a 0.1 loot roll is still the Fate Shard band');
        assert.equal(chest.loot?.hollowShards, 9, 'door shards are 0.6x the launch curve (rebalance #26)');
        assert.equal(rollHollowLockedDoor(() => 0.6).outcome, 'trap');
        assert.equal(rollHollowLockedDoor(() => 0.5).outcome, 'trap');
    });

    it('rolls a chest where it used to offer a pet nobody could befriend (rebalance #38)', () => {
        for (const roll of [0.75, 0.8, 0.995, 0.999]) {
            const result = rollHollowLockedDoor(sequence([roll, 0.9, 0.1, 0.9]), 123, 2);
            assert.equal(result.outcome, 'chest', `roll ${roll} pays a chest`);
            assert.equal(result.pet, undefined);
            assert.equal(result.loot?.fateShards, 1);
        }
    });

    it('splits the chest loot 26.7 / 42.8 / 24.4 / 6.1 between FS, Aura Dust, BC and AS (rebalance #11)', () => {
        // Draws: outcome, bonus-ryo gate, [bonus amount], loot roll, [AD amount], dust gate, [dust amount].
        const loot = (lootRoll: number, extra: number[] = []) =>
            rollHollowLockedDoor(sequence([0.1, 0.9, lootRoll, ...extra]), 0, 1).loot!;
        assert.equal(loot(LOCKED_DOOR_FATE_SHARD_BAND - 0.001).fateShards, 1);
        const dust = loot(LOCKED_DOOR_FATE_SHARD_BAND, [0, 0.9]);
        assert.equal(dust.fateShards, undefined);
        assert.equal(dust.auraDust, 10, 'the Aura Dust band pays 10-20');
        assert.equal(loot(LOCKED_DOOR_AURA_DUST_BAND - 0.001, [0.999, 0.9]).auraDust, 20);
        assert.equal(loot(LOCKED_DOOR_AURA_DUST_BAND).boneCharms, 1);
        assert.equal(loot(LOCKED_DOOR_BONE_CHARM_BAND - 0.001).boneCharms, 1);
        assert.equal(loot(LOCKED_DOOR_BONE_CHARM_BAND).auraStones, 1);
        // The 20% bonus dust adds to the Aura Dust band instead of replacing it.
        assert.equal(loot(0.5, [0, 0.1, 0]).auraDust, 10 + 5);
    });

    it('scales the door ryo by the sealed run scale after the bonus roll', () => {
        const draws = [0.1, 0.4, 0.5, 0.1, 0.5];
        const full = rollHollowLockedDoor(sequence(draws, 0.5), 0, 5);
        const half = rollHollowLockedDoor(sequence(draws, 0.5), 0, 5, 0.5);
        assert.equal(half.loot?.ryo, Math.floor(full.loot!.ryo! * 0.5));
        assert.equal(half.loot?.hollowShards, full.loot?.hollowShards, 'only ryo scales');
    });

    it('pays a chest on three doors in four and never a pet', () => {
        // mulberry32: a seeded, repeatable stream for the distribution check.
        let seed = 7;
        const random = () => {
            seed = (seed + 0x6D2B79F5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
        };
        const counts = { chest: 0, trap: 0, pet: 0, fateShards: 0 };
        const rolls = 10_000;
        for (let i = 0; i < rolls; i += 1) {
            const result = rollHollowLockedDoor(random, 0, 3);
            counts[result.outcome] += 1;
            counts.fateShards += result.loot?.fateShards ?? 0;
        }
        assert.equal(counts.pet, 0);
        assert.ok(Math.abs(counts.chest / rolls - 0.75) < 0.02, `chest share ${counts.chest / rolls}`);
        assert.ok(Math.abs(counts.trap / rolls - 0.25) < 0.02, `trap share ${counts.trap / rolls}`);
        // ~0.2 FS per door, so a five-door full run pays ~1.0 (framework #11).
        assert.ok(Math.abs(counts.fateShards / rolls - 0.75 * LOCKED_DOOR_FATE_SHARD_BAND) < 0.02, `FS per door ${counts.fateShards / rolls}`);
    });

    it('bounds distinct locked-door rolls by sealed depth', () => {
        assert.equal(maxLockedDoorsForDepth(1), 3);
        assert.equal(maxLockedDoorsForDepth(5), 15);
        assert.equal(maxLockedDoorsForDepth(999), 60);
    });
});
