"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const _reward_js_1 = require("./_reward.js");
(0, node_test_1.describe)('authoritative war reward settlement', () => {
    (0, node_test_1.it)('settles village winner, MVP, contribution stats, and currencies once', () => {
        const now = 2_000_000;
        const character = { name: 'Kira', village: 'Leaf', profession: 'vanguard', inventory: [], claimedWarCrateIds: [], ryo: 0 };
        const war = {
            id: 'leaf-vs-sand', villages: ['Leaf', 'Sand'], endedAt: now - 1,
            winnerVillage: 'Leaf', warCrateId: 'war-crate-leaf-vs-sand',
            mvpByVillage: { Leaf: 'Kira' }, contributions: { kira: { name: 'Kira', side: 'Leaf', damage: 90 } },
        };
        const first = (0, _reward_js_1.settleVillageWarRewards)(character, war, now);
        strict_1.default.equal(first.crates, 2);
        strict_1.default.equal(first.character.ryo, 10_000);
        strict_1.default.equal(first.character.honorSeals, 50);
        strict_1.default.equal(first.character.boneCharms, 6);
        strict_1.default.equal(first.character.fateShards, 4);
        strict_1.default.equal(first.character.warsWon, 1);
        strict_1.default.equal(first.character.warMvpCount, 1);
        strict_1.default.equal(first.character.lifetimeWarDamage, 90);
        strict_1.default.equal((0, _reward_js_1.settleVillageWarRewards)(first.character, war, now).granted, false);
    });
    (0, node_test_1.it)('validates village loss consolation from the stamped contribution', () => {
        const now = 2_000_000;
        const result = (0, _reward_js_1.settleVillageWarRewards)({ name: 'Miko', village: 'Sand', profession: 'healer', inventory: [], claimedWarCrateIds: [] }, { id: 'leaf-vs-sand', villages: ['Leaf', 'Sand'], endedAt: now, winnerVillage: 'Leaf', loserCrateId: 'loser-crate-leaf-vs-sand', contributions: { miko: { name: 'Miko', side: 'Sand', damage: 50 } } }, now);
        strict_1.default.equal(result.consolation, true);
        strict_1.default.equal(result.character.honorSeals, 0);
        strict_1.default.equal(result.character.boneCharms, 3);
        strict_1.default.equal(result.character.fateShards, 2);
    });
    (0, node_test_1.it)('derives clan consolation and lifetime damage from completed server challenges', () => {
        const now = 2_000_000;
        const war = {
            id: 'alpha-vs-beta', clans: ['Alpha', 'Beta'], villages: { Alpha: 'Leaf', Beta: 'Sand' },
            hp: { Alpha: 0, Beta: 100 }, startedAt: 1, updatedAt: now, endedAt: now, winnerClan: 'Beta', declaredBy: 'X',
            pendingChallenges: [], mvpByClan: {}, completedChallenges: [{
                    id: 'c1', mode: 'pet1v1', fromClan: 'Alpha', fromPlayer: 'Kira', createdAt: 1,
                    status: 'completed', expiresAt: now, acceptedPlayer: 'B', result: 'from-wins', completedAt: now,
                }],
        };
        const result = (0, _reward_js_1.settleClanWarRewards)({ name: 'Kira', clan: 'Alpha', profession: 'healer', inventory: [], claimedWarCrateIds: [] }, war, now);
        strict_1.default.equal(result.consolation, true);
        strict_1.default.equal(result.lifetimeDamage, 20);
        strict_1.default.equal(result.character.ryo, 2_500);
        strict_1.default.equal(result.character.lifetimeWarDamage, 20);
    });
});
