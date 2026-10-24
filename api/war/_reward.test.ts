import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClanWar } from '../clan/war/_storage.js';
import {
    settleClanWarRewards,
    settleVillageWarRewards,
    VILLAGE_WAR_CONSOLATION_HONOR,
    villageWarMvpRyoFull,
    villageWarPursePoints,
    type VillageWarRewardRecord,
    type WarRewardDials,
} from './_reward.js';

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
        // MVP honor 50 → 100 (2026-10 rebalance, #28); every profession also
        // gets ⌊honor/8⌋ BC and ⌊honor/25⌋ FS on top of the MVP's 2 FS.
        assert.equal(first.character.ryo, 10_000);
        assert.equal(first.character.honorSeals, 100);
        assert.equal(first.character.boneCharms, 12);
        assert.equal(first.character.fateShards, 6);
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
        // Consolation is an explicit floor: no seals for Healers, 6 BC and 1 FS.
        assert.equal(result.character.honorSeals, 0);
        assert.equal(result.character.boneCharms, 6);
        assert.equal(result.character.fateShards, 1);
        assert.equal(result.character.ryo, 5_000);
    });

    it('a Vanguard loser receives the consolation seals as well', () => {
        const now = 2_000_000;
        const result = settleVillageWarRewards(
            { name: 'Miko', village: 'Sand', profession: 'vanguard', inventory: [], claimedWarCrateIds: [] },
            { id: 'leaf-vs-sand', villages: ['Leaf', 'Sand'], endedAt: now, winnerVillage: 'Leaf', loserCrateId: 'loser-crate-leaf-vs-sand', contributions: { miko: { name: 'Miko', side: 'Sand', damage: 50 } } },
            now,
        );
        assert.equal(result.character.honorSeals, VILLAGE_WAR_CONSOLATION_HONOR);
        assert.equal(VILLAGE_WAR_CONSOLATION_HONOR, 50);
        assert.equal(result.character.boneCharms, 6);
        assert.equal(result.character.fateShards, 1);
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
                kiraemberfall: { name: 'Kira Emberfall', side: 'Leaf', damage: 30 },
                sandmiko: { name: 'Sand Miko', side: 'Sand', damage: 60 },
            },
        };
        const bystander = settleVillageWarRewards({ name: 'Bystander', village: 'Leaf', inventory: [], claimedWarCrateIds: [] }, war, now);
        assert.equal(bystander.granted, false, 'a winning member who never fought gets no crate');
        assert.equal(bystander.crates, 0);

        const fighter = settleVillageWarRewards({ name: 'Kira Emberfall', village: 'Leaf', inventory: [], claimedWarCrateIds: [] }, war, now);
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

// ── 2026-10 rebalance: the MVP ryo and the village-war purse (framework #7 / #32) ──

const HOUR = 60 * 60 * 1000;
const FULL: WarRewardDials = { purseScale: 1, winK: 0.3, loseK: 0.18, epochMs: 0, minDurationMs: 72 * HOUR };
const NOW = 10_000 * HOUR;

/** A five-day campaign war that ran its full length (a score ending). */
function campaignWar(over: Partial<VillageWarRewardRecord> = {}): VillageWarRewardRecord {
    return {
        id: 'leaf-vs-sand', declarationGeneration: 3, villages: ['Leaf', 'Sand'],
        startedAt: NOW - 122 * HOUR, pendingUntil: NOW - 121 * HOUR, endedAt: NOW - HOUR,
        winnerVillage: 'Leaf', warCrateId: 'war-crate-leaf-vs-sand-g3', loserCrateId: 'loser-crate-leaf-vs-sand-g3',
        mvpByVillage: {}, campaign: {},
        contributions: {
            kira: { name: 'Kira', side: 'Leaf', damage: 250 },
            miko: { name: 'Miko', side: 'Sand', damage: 250 },
        },
        ...over,
    };
}

function fighter(over: Record<string, unknown> = {}) {
    return { name: 'Kira', village: 'Leaf', profession: 'healer', level: 90, inventory: [], claimedWarCrateIds: [], ryo: 0, ...over };
}

describe('the MVP ryo scales with level: max(10,000, 50 x A(L))', () => {
    it('is 10,000 at L30, 11,000 at L50 and 15,000 at L70 and L100', () => {
        assert.equal(villageWarMvpRyoFull(30), 10_000);
        assert.equal(villageWarMvpRyoFull(50), 11_000);
        assert.equal(villageWarMvpRyoFull(70), 15_000);
        assert.equal(villageWarMvpRyoFull(100), 15_000);
    });

    it('pays the claimant level, staged by WAR_PURSE_SCALE (0 = the old 10,000)', () => {
        const war = campaignWar({ mvpByVillage: { Leaf: 'Kira' }, contributions: {} });
        const at = (scale: number, level: number) => settleVillageWarRewards(fighter({ level }), war, NOW, { ...FULL, purseScale: scale }).character.ryo;
        assert.equal(at(1, 70), 15_000);
        assert.equal(at(1, 50), 11_000);
        assert.equal(at(0.5, 70), 12_500);
        assert.equal(at(0, 70), 10_000);
    });
});

describe('the village-war purse', () => {
    it('pays winners 0.3 x A(L) and losers 0.18 x A(L) per point, with ⌊points/8⌋ honor', () => {
        const win = settleVillageWarRewards(fighter(), campaignWar(), NOW, FULL);
        assert.equal(win.purse, 22_500, '250 points x 0.3 x 300 at L90');
        assert.equal(win.purseHonor, 31);
        // The winner's crate pays nothing in ryo here; the purse is the ryo.
        assert.equal(win.character.ryo, 22_500);
        assert.ok((win.character.claimedWarCrateIds as string[]).includes('purse-leaf-vs-sand-g3'));

        const loss = settleVillageWarRewards(fighter({ name: 'Miko', village: 'Sand' }), campaignWar(), NOW, FULL);
        assert.equal(loss.purse, 13_500, '250 points x 0.18 x 300');
        assert.equal(loss.consolation, true);
        assert.equal(loss.ryo, 13_500, 'the purse already exceeds the support floor');
    });

    it('needs 40 points and caps at 400', () => {
        const few = campaignWar({ contributions: { kira: { name: 'Kira', side: 'Leaf', damage: 39 } } });
        assert.equal(settleVillageWarRewards(fighter(), few, NOW, FULL).purse, 0);
        const many = campaignWar({ contributions: { kira: { name: 'Kira', side: 'Leaf', damage: 1_000 } } });
        const capped = settleVillageWarRewards(fighter(), many, NOW, FULL);
        assert.equal(capped.purse, 36_000);
        assert.equal(capped.purseHonor, 50);
    });

    it('a draw pays both sides the losers\' rate', () => {
        const draw = campaignWar({ winnerVillage: undefined, warCrateId: undefined, loserCrateId: undefined });
        assert.equal(settleVillageWarRewards(fighter(), draw, NOW, FULL).purse, 13_500);
        assert.equal(settleVillageWarRewards(fighter({ name: 'Miko', village: 'Sand' }), draw, NOW, FULL).purse, 13_500);
    });

    it('WAR_PURSE_SCALE scales the purse ryo and its honor; 0 pays no purse at all', () => {
        const half = settleVillageWarRewards(fighter(), campaignWar(), NOW, { ...FULL, purseScale: 0.5 });
        assert.equal(half.purse, 11_250);
        assert.equal(half.purseHonor, 15);
        const off = settleVillageWarRewards(fighter(), campaignWar(), NOW, { ...FULL, purseScale: 0 });
        assert.equal(off.purse, 0);
        assert.ok(!(off.character.claimedWarCrateIds as string[]).includes('purse-leaf-vs-sand-g3'), 'and consumes nothing');
    });

    it('an agreement before the floor pays none; one at 72 h pays the share of the campaign fought', () => {
        const early = campaignWar({ endedAt: NOW - 119 * HOUR, surrenderedBy: 'Sand' });
        assert.equal(settleVillageWarRewards(fighter(), early, NOW, FULL).purse, 0);
        const at72 = campaignWar({ endedAt: NOW - 121 * HOUR + 72 * HOUR, surrenderedBy: 'Sand' });
        const paid = settleVillageWarRewards(fighter(), at72, NOW, FULL);
        assert.equal(paid.purse, 13_500, '60% of 22,500');
        assert.equal(paid.purseHonor, 18, '60% of 31, floored');
    });

    it('pays once per war generation; a rematch pays again', () => {
        const first = settleVillageWarRewards(fighter(), campaignWar(), NOW, FULL);
        const again = settleVillageWarRewards(first.character, campaignWar(), NOW, FULL);
        assert.equal(again.granted, false);
        assert.equal(again.purse, 0);
        const rematch = settleVillageWarRewards(first.character, campaignWar({ declarationGeneration: 4, warCrateId: 'war-crate-leaf-vs-sand-g4' }), NOW, FULL);
        assert.equal(rematch.purse, 22_500);
    });

    it('pays no purse on wars that ended before it shipped, on legacy HP wars, or to a fresh alt', () => {
        assert.equal(settleVillageWarRewards(fighter(), campaignWar(), NOW, { ...FULL, epochMs: NOW }).purse, 0, 'ended before the epoch');
        assert.equal(settleVillageWarRewards(fighter(), campaignWar({ campaign: undefined }), NOW, FULL).purse, 0, 'HP damage is not campaign points');
        const alt = fighter({ createdAt: NOW - 2 * HOUR - 24 * HOUR, level: 19 });
        assert.equal(settleVillageWarRewards(alt, campaignWar(), NOW, FULL).purse, 0, 'an account under 72 h old and below L20 when the war ended');
        const freshEstablished = fighter({ createdAt: NOW - 2 * HOUR - 24 * HOUR });
        assert.ok(settleVillageWarRewards(freshEstablished, campaignWar(), NOW, FULL).purse > 0, 'a fresh account at L20+ is established (owner A14)');
        const veteran = fighter({ createdAt: NOW - 30 * 24 * HOUR });
        assert.equal(settleVillageWarRewards(veteran, campaignWar(), NOW, FULL).purse, 22_500);
        assert.equal(settleVillageWarRewards(fighter({ createdAt: undefined }), campaignWar(), NOW, FULL).purse, 22_500, 'fail-open on a missing stamp');
    });

    it('pays on points without the War Academy bonus the treasury bought', () => {
        // 120 PvE points earned at Academy tier 2 (x1.2) are 100 raw points.
        const war = campaignWar({
            contributions: { kira: { name: 'Kira', side: 'Leaf', damage: 120 + 60 } },
            campaign: {
                receipts: {
                    'run:op1': { points: 120, village: 'Leaf', player: 'kira' },
                    'pvp:b1': { points: 60, village: 'Leaf', player: 'kira' },
                },
                admissions: { op1: { npc: true, supportTiers: { warAcademy: 2 } } },
            },
        });
        assert.equal(villageWarPursePoints(war, 'kira', 'Leaf', 180), 160);
        assert.equal(settleVillageWarRewards(fighter(), war, NOW, FULL).purse, Math.round(160 * 0.3 * 300));
    });
});
