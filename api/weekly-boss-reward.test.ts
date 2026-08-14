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
