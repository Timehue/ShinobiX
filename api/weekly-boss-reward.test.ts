import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyWeeklyBossReward } from './weekly-boss.js';

test('weekly boss payout receipt is committed with and gates the reward', () => {
    const reward = { name: 'contributor', ryo: 500, gotCore: true, gotKey: true };
    const first = applyWeeklyBossReward({
        level: 1,
        unspentStats: 0,
        spentStats: {},
        examsPassed: [],
        ryo: 100,
        inventory: [],
        maxHp: 100,
        maxChakra: 100,
        maxStamina: 100,
        hp: 10,
        chakra: 10,
        stamina: 10,
    }, '2026-W32', 'boss-ai', reward, 1_000);
    assert.equal(first.alreadyApplied, false);
    assert.equal(first.character.ryo, 600);
    assert.equal(first.character.unspentStats, 10);
    assert.deepEqual(first.character.inventory, ['weekly-boss-core', 'dungeon-key']);
    assert.equal((first.character.serverSettlementReceipts as unknown[]).length, 1);

    const replay = applyWeeklyBossReward(first.character, '2026-W32', 'boss-ai', reward, 2_000);
    assert.equal(replay.alreadyApplied, true);
    assert.equal(replay.character.ryo, 600);
    assert.equal(replay.character.unspentStats, 10);
    assert.deepEqual(replay.character.inventory, ['weekly-boss-core', 'dungeon-key']);
});

/*
 * The Hollow-Gate Cinder is the one relic the world does not give up from the
 * ground — it comes off the Weekly Boss instead (every other relic is
 * biome-locked to Ancient Chests). Because this settlement is receipt-guarded
 * and can be recomputed on a retry, the roll is a stable hash of
 * (week, boss, player) rather than live RNG: a player must never be able to
 * re-roll a loss, and a replay must never mint a second copy.
 */
test('weekly boss grants the rift relic, and pays Fate Shards for a duplicate', () => {
    const base = {
        level: 1, unspentStats: 0, spentStats: {}, examsPassed: [], ryo: 0,
        maxHp: 100, maxChakra: 100, maxStamina: 100, hp: 10, chakra: 10, stamina: 10,
    };
    const winner = applyWeeklyBossReward(
        { ...base, inventory: [] },
        '2026-W40', 'boss-ai',
        { name: 'lucky', ryo: 0, gotCore: true, gotKey: false, gotRelic: true },
        1_000,
    );
    assert.ok(
        (winner.character.inventory as string[]).includes('relic-hollow-gate-cinder'),
        'a winning roll grants the Cinder',
    );

    // Same roll, but the player already owns one: no second copy, real payout.
    const dupe = applyWeeklyBossReward(
        { ...base, fateShards: 3, inventory: ['relic-hollow-gate-cinder'] },
        '2026-W41', 'boss-ai',
        { name: 'lucky', ryo: 0, gotCore: false, gotKey: false, gotRelic: true },
        1_000,
    );
    const inv = dupe.character.inventory as string[];
    assert.equal(
        inv.filter((id) => id === 'relic-hollow-gate-cinder').length, 1,
        'a duplicate never mints a second copy',
    );
    assert.equal(dupe.character.fateShards, 3 + 15, 'the duplicate pays Fate Shards instead');
});

test('a losing relic roll grants nothing and costs nothing', () => {
    const out = applyWeeklyBossReward(
        {
            level: 1, unspentStats: 0, spentStats: {}, examsPassed: [], ryo: 0, fateShards: 4,
            inventory: [], maxHp: 100, maxChakra: 100, maxStamina: 100, hp: 10, chakra: 10, stamina: 10,
        },
        '2026-W42', 'boss-ai',
        { name: 'unlucky', ryo: 0, gotCore: true, gotKey: false, gotRelic: false },
        1_000,
    );
    assert.ok(!(out.character.inventory as string[]).includes('relic-hollow-gate-cinder'));
    assert.equal(out.character.fateShards, 4, 'no shards for a roll that simply lost');
});
