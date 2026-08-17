import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    creditPvpWarGroundReward,
    pvpWarGroundRewardEligible,
} from './_war-ground-reward.js';

const NOW = Date.parse('2026-08-15T10:00:00.000Z');

describe('creditPvpWarGroundReward', () => {
    it('publishes reward fields and the battle receipt in one replay-stable character', () => {
        const first = creditPvpWarGroundReward({
            name: 'Aria',
            ryo: 100,
            fateShards: 2,
            inventory: [],
        }, 'pvp-12345678', NOW);
        assert.equal(first.fresh, true);
        assert.equal(first.character.ryo, 600);
        assert.equal(first.character.fateShards, 3);
        assert.equal(first.character.villageWarRaidProgress, 1);
        assert.ok(Array.isArray(first.character.serverSettlementReceipts));

        const replay = creditPvpWarGroundReward(first.character, 'pvp-12345678', NOW + 1_000);
        assert.equal(replay.fresh, false);
        assert.equal(replay.character.ryo, 600);
        assert.equal(replay.character.fateShards, 3);
        assert.equal(replay.character.villageWarRaidProgress, 1);
    });

    it('increments separate battles but pays the daily bounty only once', () => {
        const first = creditPvpWarGroundReward({ ryo: 0, fateShards: 0 }, 'pvp-aaaaaaaa', NOW);
        const second = creditPvpWarGroundReward(first.character, 'pvp-bbbbbbbb', NOW + 1_000);
        assert.equal(second.fresh, true);
        assert.equal(second.character.villageWarRaidProgress, 2);
        assert.equal(second.character.ryo, 500);
        assert.equal(second.character.fateShards, 1);
    });

    it('stamps a delayed prior-day battle without regressing or double-paying newer daily state', () => {
        const delayed = creditPvpWarGroundReward({
            ryo: 900,
            fateShards: 4,
            villageWarMissionDate: '2026-08-16',
            villageWarRaidProgress: 3,
            villageWarMissionsCompleted: 1,
            warGroundBountyDate: '2026-08-16',
        }, 'pvp-delayed1', NOW);
        assert.equal(delayed.fresh, true);
        assert.equal(delayed.bountyCredited, false);
        assert.equal(delayed.raidProgress, 3);
        assert.equal(delayed.character.villageWarMissionDate, '2026-08-16');
        assert.equal(delayed.character.villageWarRaidProgress, 3);
        assert.equal(delayed.character.villageWarMissionsCompleted, 1);
        assert.equal(delayed.character.warGroundBountyDate, '2026-08-16');
        assert.equal(delayed.character.ryo, 900);
        assert.equal(delayed.character.fateShards, 4);
    });
});

describe('pvpWarGroundRewardEligible', () => {
    const war = {
        villages: ['Moon', 'Frost'],
        warGroundSector: 40,
        startedAt: 1_000,
        pendingUntil: 2_000,
        endedAt: 5_000,
    };
    it('requires the exact villages, war-ground sector, and active battle timestamp', () => {
        assert.equal(pvpWarGroundRewardEligible({ actorVillage: 'Moon', loserVillage: 'Frost', rewardSector: 40, battleCreatedAt: 3_000, battleEndedAt: 4_000, war }), true);
        assert.equal(pvpWarGroundRewardEligible({ actorVillage: 'Moon', loserVillage: 'Frost', rewardSector: 41, battleCreatedAt: 3_000, battleEndedAt: 4_000, war }), false);
        assert.equal(pvpWarGroundRewardEligible({ actorVillage: 'Moon', loserVillage: 'Frost', rewardSector: 40, battleCreatedAt: 1_500, battleEndedAt: 3_000, war }), false);
        assert.equal(pvpWarGroundRewardEligible({ actorVillage: 'Moon', loserVillage: 'Frost', rewardSector: 40, battleCreatedAt: 3_000, battleEndedAt: 6_000, war }), false);
    });

    it('rejects a fight started during the war but finished after another blow ended it', () => {
        assert.equal(pvpWarGroundRewardEligible({
            actorVillage: 'Moon',
            loserVillage: 'Frost',
            rewardSector: 40,
            battleCreatedAt: 4_500,
            battleEndedAt: 5_001,
            war,
        }), false);
    });

    it('rejects fractional timestamps and battles outside the bounded 14-day lifetime', () => {
        assert.equal(pvpWarGroundRewardEligible({
            actorVillage: 'Moon', loserVillage: 'Frost', rewardSector: 40,
            battleCreatedAt: 3_000.5, battleEndedAt: 4_000, war,
        }), false);
        assert.equal(pvpWarGroundRewardEligible({
            actorVillage: 'Moon', loserVillage: 'Frost', rewardSector: 40,
            battleCreatedAt: 3_000, battleEndedAt: 4_000.5, war,
        }), false);
        assert.equal(pvpWarGroundRewardEligible({
            actorVillage: 'Moon', loserVillage: 'Frost', rewardSector: 40,
            battleCreatedAt: 3_000, battleEndedAt: 4_000,
            war: { ...war, endedAt: undefined, pendingUntil: 2_000.5 },
        }), false);
        assert.equal(pvpWarGroundRewardEligible({
            actorVillage: 'Moon', loserVillage: 'Frost', rewardSector: 40,
            battleCreatedAt: 2_000,
            battleEndedAt: 2_000 + 14 * 24 * 60 * 60 * 1_000 + 1,
            war: { ...war, endedAt: undefined },
        }), false);
    });
});
