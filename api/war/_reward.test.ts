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

    it('does not let generation-one reward markers suppress a rematch reward', () => {
        const now = 2_000_000;
        const base = { name: 'Kira', village: 'Leaf', profession: 'vanguard', inventory: [], claimedWarCrateIds: [], ryo: 0 };
        const generationOne = {
            id: 'leaf-vs-sand', declarationGeneration: 1, villages: ['Leaf', 'Sand'] as [string, string],
            endedAt: now - 2, winnerVillage: 'Leaf', warCrateId: 'war-crate-leaf-vs-sand-g1',
            mvpByVillage: { Leaf: 'Kira' }, contributions: { kira: { name: 'Kira', side: 'Leaf', damage: 60 } },
        };
        const first = settleVillageWarRewards(base, generationOne, now);
        assert.equal(first.granted, true);
        const generationTwo = {
            ...generationOne,
            declarationGeneration: 2,
            endedAt: now - 1,
            warCrateId: 'war-crate-leaf-vs-sand-g2',
        };
        const rematch = settleVillageWarRewards(first.character, generationTwo, now);
        assert.equal(rematch.granted, true);
        assert.ok((rematch.character.claimedWarCrateIds as string[]).includes('mvp-crate-leaf-vs-sand-g2'));
        assert.ok((rematch.character.claimedWarCrateIds as string[]).includes('stats-leaf-vs-sand-g2'));
    });

    it('gives the winner crate only to members who fought, and finds damage by slug', () => {
        const now = 2_000_000;
        const war = {
            id: 'leaf-vs-sand', villages: ['Leaf', 'Sand'] as [string, string], endedAt: now - 1,
            winnerVillage: 'Leaf', warCrateId: 'war-crate-leaf-vs-sand', loserCrateId: 'loser-crate-leaf-vs-sand',
            mvpByVillage: { Leaf: 'Rin', Sand: 'Gaara' },
            contributions: {
                kirauchiha: { name: 'Kira Uchiha', side: 'Leaf', damage: 30 },
                sandmiko: { name: 'Sand Miko', side: 'Sand', damage: 60 },
            },
        };
        const bystander = settleVillageWarRewards({ name: 'Bystander', village: 'Leaf', inventory: [], claimedWarCrateIds: [] }, war, now);
        assert.equal(bystander.granted, false, 'a winning member who never fought gets no crate');
        assert.equal(bystander.crates, 0);

        const fighter = settleVillageWarRewards({ name: 'Kira Uchiha', village: 'Leaf', inventory: [], claimedWarCrateIds: [] }, war, now);
        assert.equal(fighter.crates, 1, 'a fighter whose display name differs from the slug still gets the crate');
        assert.equal(fighter.lifetimeDamage, 30, 'and their damage stat');

        const loser = settleVillageWarRewards({ name: 'Sand Miko', village: 'Sand', inventory: [], claimedWarCrateIds: [] }, war, now);
        assert.equal(loser.consolation, true, 'consolation is found by slug, not by the lowercased display name');
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
