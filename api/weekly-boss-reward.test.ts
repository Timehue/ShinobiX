import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyWeeklyBossReward,
    computeWeeklyBossRewardEntries,
    publicWeeklyBossState,
    weeklyBossRewardParams,
    WEEKLY_BOSS_ADMIN_ACTOR,
    type WeeklyBossState,
} from './weekly-boss.js';

/*
 * Weekly Boss payout sizing (2026-10 rebalance, framework #13 + owner
 * amendment A5): a fixed 100,000 reward reference instead of the ISO-week
 * hpMax, a 60,000 per-contributor cap and a 90,000 MVP cap.
 */
const contributors = { alice: 600, bob: 300, cara: 100 };

test('the payout no longer drifts with the ISO week or the fight hpMax', () => {
    const ryoFor = (weekKey: string, hpMax: number) => computeWeeklyBossRewardEntries({ damageByPlayer: contributors, weekKey, aiId: 'boss-ai', hpMax })
        .map((entry) => [entry.name, entry.ryo]);
    const january = ryoFor('2026-W01', 51_900);
    assert.deepEqual(ryoFor('2026-W42', 129_800), january);
    assert.deepEqual(ryoFor('2026-W53', 150_700), january);
    // alice is the MVP on a 60% share (raw 82,775, under the MVP cap); bob 30%; cara 10%.
    assert.deepEqual(january, [['alice', 82_775], ['bob', 20_900], ['cara', 7_150]]);
});

test('a solo contributor is the MVP and is capped at 90,000', () => {
    const [solo, ...rest] = computeWeeklyBossRewardEntries({ damageByPlayer: { alice: 250_000 }, weekKey: '2026-W42', aiId: 'boss-ai' });
    assert.equal(rest.length, 0);
    assert.equal(solo!.name, 'alice');
    assert.equal(solo!.rank, 1);
    assert.equal(solo!.isMvp, true);
    assert.equal(solo!.gotCore, true);
    assert.equal(solo!.gotKey, true);
    assert.equal(solo!.ryo, 90_000, 'was 178,750 at W42 before the cap');
    assert.equal(solo!.ryoCappedAt, 90_000, 'the cap is sealed so the arena can say so');
});

test('an uncapped share seals no cap marker', () => {
    const entries = computeWeeklyBossRewardEntries({ damageByPlayer: contributors, weekKey: '2026-W42', aiId: 'boss-ai' });
    assert.ok(entries.every((entry) => entry.ryoCappedAt === undefined));
});

test('0-damage entries are still not contributors (owner ruling 2026-10-15)', () => {
    const entries = computeWeeklyBossRewardEntries({ damageByPlayer: { alice: 100, idle: 0 }, weekKey: '2026-W42', aiId: 'boss-ai' });
    assert.deepEqual(entries.map((entry) => entry.name), ['alice']);
});

test('the staff actor is left out of the ranking and the share total', () => {
    const entries = computeWeeklyBossRewardEntries({
        damageByPlayer: { [WEEKLY_BOSS_ADMIN_ACTOR]: 900_000, alice: 100_000 },
        weekKey: '2026-W42',
        aiId: 'boss-ai',
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.name, 'alice');
    assert.equal(entries[0]!.rank, 1);
    assert.equal(entries[0]!.isMvp, true, 'admin damage can never take the MVP slot');
    assert.equal(entries[0]!.ryo, 90_000, 'alice holds the whole share, so admin damage shrank nothing');
});

test('the reward dials read their env overrides and fall back on garbage', () => {
    const saved = { ref: process.env.WB_REWARD_REF_HP, player: process.env.WB_PLAYER_CAP, mvp: process.env.WB_MVP_CAP };
    try {
        assert.deepEqual(weeklyBossRewardParams(), { refHp: 100_000, playerCap: 60_000, mvpCap: 90_000 });
        process.env.WB_REWARD_REF_HP = '50000';
        process.env.WB_PLAYER_CAP = 'lots';
        process.env.WB_MVP_CAP = '40000';
        assert.deepEqual(weeklyBossRewardParams(), { refHp: 50_000, playerCap: 60_000, mvpCap: 40_000 });
        const [solo] = computeWeeklyBossRewardEntries({ damageByPlayer: { alice: 1 }, weekKey: 'w', aiId: 'a' });
        assert.equal(solo!.ryo, 40_000);
    } finally {
        for (const [name, value] of [['WB_REWARD_REF_HP', saved.ref], ['WB_PLAYER_CAP', saved.player], ['WB_MVP_CAP', saved.mvp]] as const) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    }
});

test('the public view carries the live ryo caps and still hides hpMax', () => {
    const boss: WeeklyBossState = {
        weekKey: '2026-W42', aiId: 'boss-ai', hpMax: 129_800, hpRemaining: 129_800, scaleFactor: 1,
        damageByPlayer: {}, startedAt: 1, expiresAt: 2,
    };
    const view = publicWeeklyBossState(boss)!;
    assert.deepEqual(view.rewardCaps, { playerRyo: 60_000, mvpRyo: 90_000 });
    assert.equal(view.hpMax, null);
});

test('weekly boss payout receipt is committed with and gates the reward', () => {
    const reward = { name: 'contributor', ryo: 500, gotCore: true, gotKey: true, gotRelic: false };
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
    // The Core is a counted stack (owner ruling A12); the key keeps its old path.
    assert.deepEqual(first.character.inventory, ['dungeon-key']);
    assert.deepEqual(first.character.itemStacks, [{ itemId: 'weekly-boss-core', count: 1 }]);
    assert.equal((first.character.serverSettlementReceipts as unknown[]).length, 1);

    const replay = applyWeeklyBossReward(first.character, '2026-W32', 'boss-ai', reward, 2_000);
    assert.equal(replay.alreadyApplied, true);
    assert.equal(replay.character.ryo, 600);
    assert.equal(replay.character.unspentStats, 10);
    assert.deepEqual(replay.character.inventory, ['dungeon-key']);
    assert.deepEqual(replay.character.itemStacks, [{ itemId: 'weekly-boss-core', count: 1 }]);
});

test('a weekly Core joins the stack and folds a legacy inventory[] copy (owner ruling A12)', () => {
    const reward = { name: 'stacker', ryo: 0, gotCore: true, gotKey: false, gotRelic: false, gotGear: false };
    const out = applyWeeklyBossReward({
        level: 1, unspentStats: 0, ryo: 0, maxHp: 100, maxChakra: 100, maxStamina: 100, hp: 10, chakra: 10, stamina: 10,
        inventory: ['weekly-boss-core', 'rustfang-kunai'], itemStacks: [{ itemId: 'weekly-boss-core', count: 2 }],
    }, '2026-W33', 'boss-ai', reward, 1_000);
    assert.deepEqual(out.character.inventory, ['rustfang-kunai']);
    assert.deepEqual(out.character.itemStacks, [{ itemId: 'weekly-boss-core', count: 4 }], '2 stacked + 1 legacy copy + 1 new');
});

test('replacement spawns preserve the once-per-week payout cap', () => {
    // gotRelic: false — this case is about the once-per-week payout cap, not the
    // relic roll, and a losing roll keeps the replay assertions below unchanged.
    const reward = { name: 'repeat-contributor', ryo: 500, gotCore: true, gotKey: true, gotRelic: false };
    const base = {
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
    };
    const spawnA = applyWeeklyBossReward(base, '2026-W32', 'boss-ai', reward, 1_000);
    const replayA = applyWeeklyBossReward(spawnA.character, '2026-W32', 'boss-ai', reward, 2_000);
    const replacementSpawn = applyWeeklyBossReward(replayA.character, '2026-W32', 'replacement-boss-ai', reward, 3_000);

    assert.equal(spawnA.alreadyApplied, false);
    assert.equal(replayA.alreadyApplied, true);
    assert.equal(replacementSpawn.alreadyApplied, true, 'staff replacement cannot create a second weekly reward authority');
    assert.equal(replacementSpawn.character.ryo, 600);
    assert.equal(replacementSpawn.character.unspentStats, 10);
    assert.deepEqual(replacementSpawn.character.inventory, ['dungeon-key']);
    assert.deepEqual(replacementSpawn.character.itemStacks, [{ itemId: 'weekly-boss-core', count: 1 }], 'still exactly one Core');
    assert.equal((replacementSpawn.character.serverSettlementReceipts as unknown[]).length, 1);
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

test('weekly boss compensates an equipped Cinder and never repeats that payout', () => {
    const reward = { name: 'worn', ryo: 0, gotCore: false, gotKey: false, gotRelic: true };
    const first = applyWeeklyBossReward({ level: 75, inventory: [], equipment: { relic: 'relic-hollow-gate-cinder' }, fateShards: 2 }, '2026-W42', 'boss-ai', reward, 1000);
    assert.equal(first.character.fateShards, 17);
    assert.deepEqual(first.character.inventory, []);
    const retry = applyWeeklyBossReward(first.character, '2026-W42', 'boss-ai', reward, 2000);
    assert.equal(retry.character.fateShards, 17);
    assert.equal(retry.alreadyApplied, true);
});
