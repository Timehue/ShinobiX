import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClanWar } from '../clan/war/_storage.js';
import { settleClanWarRewards, settleVillageWarRewards } from './_reward.js';

describe('authoritative war reward settlement', () => {
    it('settles village winner, MVP, contribution stats, and currencies once', () => {
        const now = 2_000_000;
        const character = { name: 'Kira', village: 'Leaf', profession: 'vanguard', inventory: [], claimedWarCrateIds: [], ryo: 0 };
        const war = {
            id: 'leaf-vs-sand', villages: ['Leaf', 'Sand'] as [string, string], endedAt: now - 1,
            winnerVillage: 'Leaf', warCrateId: 'war-crate-leaf-vs-sand',
            mvpByVillage: { Leaf: 'Kira' }, contributions: { kira: { name: 'Kira', side: 'Leaf', damage: 90 } },
        };
        const first = settleVillageWarRewards(character, war, now);
        assert.equal(first.crates, 2);
        assert.equal(first.character.ryo, 10_000);
        assert.equal(first.character.honorSeals, 50);
        assert.equal(first.character.boneCharms, 6);
        assert.equal(first.character.fateShards, 4);
        assert.equal(first.character.warsWon, 1);
        assert.equal(first.character.warMvpCount, 1);
        assert.equal(first.character.lifetimeWarDamage, 90);
        assert.equal(settleVillageWarRewards(first.character, war, now).granted, false);
    });

    it('validates village loss consolation from the stamped contribution', () => {
        const now = 2_000_000;
        const result = settleVillageWarRewards(
            { name: 'Miko', village: 'Sand', profession: 'healer', inventory: [], claimedWarCrateIds: [] },
            { id: 'leaf-vs-sand', villages: ['Leaf', 'Sand'], endedAt: now, winnerVillage: 'Leaf', loserCrateId: 'loser-crate-leaf-vs-sand', contributions: { miko: { name: 'Miko', side: 'Sand', damage: 50 } } },
            now,
        );
        assert.equal(result.consolation, true);
        assert.equal(result.character.honorSeals, 0);
        assert.equal(result.character.boneCharms, 3);
        assert.equal(result.character.fateShards, 2);
    });

    it('derives clan consolation and lifetime damage from completed server challenges', () => {
        const now = 2_000_000;
        const war: ClanWar = {
            id: 'alpha-vs-beta', clans: ['Alpha', 'Beta'], villages: { Alpha: 'Leaf', Beta: 'Sand' },
            hp: { Alpha: 0, Beta: 100 }, startedAt: 1, updatedAt: now, endedAt: now, winnerClan: 'Beta', declaredBy: 'X',
            pendingChallenges: [], mvpByClan: {}, completedChallenges: [{
                id: 'c1', mode: 'pet1v1', fromClan: 'Alpha', fromPlayer: 'Kira', createdAt: 1,
                status: 'completed', expiresAt: now, acceptedPlayer: 'B', result: 'from-wins', completedAt: now,
            }],
        };
        const result = settleClanWarRewards({ name: 'Kira', clan: 'Alpha', profession: 'healer', inventory: [], claimedWarCrateIds: [] }, war, now);
        assert.equal(result.consolation, true);
        assert.equal(result.lifetimeDamage, 20);
        assert.equal(result.character.ryo, 2_500);
        assert.equal(result.character.lifetimeWarDamage, 20);
    });
});
