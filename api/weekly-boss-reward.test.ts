import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyWeeklyBossReward,
    reconcileWeeklyBossPayoutAcknowledgements,
    type WeeklyBossState,
} from './weekly-boss.js';

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
    }, '2026-W32', 'boss-ai', 900, reward, 1_000);
    assert.equal(first.alreadyApplied, false);
    assert.equal(first.character.ryo, 600);
    assert.equal(first.character.unspentStats, 10);
    assert.deepEqual(first.character.inventory, ['weekly-boss-core', 'dungeon-key']);
    assert.equal((first.character.serverSettlementReceipts as unknown[]).length, 1);

    const replay = applyWeeklyBossReward(first.character, '2026-W32', 'boss-ai', 900, reward, 2_000);
    assert.equal(replay.alreadyApplied, true);
    assert.equal(replay.character.ryo, 600);
    assert.equal(replay.character.unspentStats, 10);
    assert.deepEqual(replay.character.inventory, ['weekly-boss-core', 'dungeon-key']);
});

test('a crash after the boss credit CAS resumes marker acknowledgement exactly once', async () => {
    const boss: WeeklyBossState = {
        weekKey: '2026-W32',
        aiId: 'boss-ai',
        hpMax: 1_000,
        hpRemaining: 1_000,
        scaleFactor: 1,
        damageByPlayer: { Alice: 500 },
        startedAt: 1_000,
        expiresAt: 2_000,
        distributedAt: 2_001,
        rewardsDistributed: true,
        creditedPlayers: ['Alice'],
        distributionSummary: [{
            name: 'Alice', damage: 500, rank: 1, ryo: 500, xp: 0,
            gotCore: true, gotKey: true, isMvp: true,
        }],
    };
    const calls: string[] = [];
    const recovered = await reconcileWeeklyBossPayoutAcknowledgements(boss, {
        now: () => 3_000,
        credit: async (payout) => {
            calls.push(`credit:${payout.playerName}`);
            return {
                ok: true as const,
                replayed: true,
                migratedLegacy: false,
                creditedAt: 2_001,
                character: {},
                _saveVersion: 2,
            };
        },
        acknowledge: async (payout) => {
            calls.push(`ack:${payout.playerName}`);
            return {
                ok: true as const,
                replayed: false,
                acknowledgedAt: 3_000,
                character: {},
                _saveVersion: 3,
            };
        },
        commitAcknowledged: async (current, playerNames) => ({
            ...current,
            payoutMarkersAcknowledgedPlayers: [
                ...(current.payoutMarkersAcknowledgedPlayers ?? []),
                ...playerNames,
            ],
        }),
    });
    assert.deepEqual(calls, ['credit:Alice', 'ack:Alice']);
    assert.deepEqual(recovered.payoutMarkersAcknowledgedPlayers, ['Alice']);

    const replay = await reconcileWeeklyBossPayoutAcknowledgements(recovered, {
        credit: async () => { throw new Error('must-not-credit-again'); },
        acknowledge: async () => { throw new Error('must-not-ack-again'); },
    });
    assert.deepEqual(replay, recovered);
});
