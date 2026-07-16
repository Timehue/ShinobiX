"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _settle_js_1 = require("./_settle.js");
const _name__js_1 = require("../save/[name].js");
const token = (opponentId) => ({
    playerName: 'tester', tokenId: 'abc', mintedAt: 1, maxXp: 150, maxRyo: 150, opponentId,
});
const character = (overrides = {}) => ({
    name: 'Tester', village: 'Stormveil Village', level: 50, xp: 0, ryo: 100,
    auraDust: 3, storyProgress: 0, hp: 100, maxHp: 100, stamina: 80,
    maxStamina: 100, chakra: 70, maxChakra: 100, inventory: [],
    ...overrides,
});
(0, node_test_1.test)('story settlement requires the exact next opponent and grants the canonical milestone once', () => {
    const c = character();
    const settled = (0, _settle_js_1.applyStoryBossSettlement)(c, token((0, _settle_js_1.storyOpponentId)('Stormveil Village', 4)), 40);
    strict_1.default.equal(settled.ok, true);
    if (!settled.ok)
        return;
    strict_1.default.equal(settled.progress, 1);
    strict_1.default.equal(settled.xp, 120);
    strict_1.default.equal(settled.ryo, 75);
    strict_1.default.equal(settled.character.ryo, 175);
    strict_1.default.equal(settled.character.auraDust, 15);
    strict_1.default.equal(settled.character.storyProgress, 1);
    strict_1.default.equal(settled.character.hp, 65);
});
(0, node_test_1.test)('story settlement rejects skipped, mismatched, under-level, and completed milestones', () => {
    strict_1.default.equal((0, _settle_js_1.applyStoryBossSettlement)(character(), token((0, _settle_js_1.storyOpponentId)('Stormveil Village', 15)), 100).ok, false);
    strict_1.default.equal((0, _settle_js_1.applyStoryBossSettlement)(character({ level: 3 }), token((0, _settle_js_1.storyOpponentId)('Stormveil Village', 4)), 100).ok, false);
    strict_1.default.equal((0, _settle_js_1.applyStoryBossSettlement)(character({ storyProgress: 9 }), token('anything'), 100).ok, false);
});
(0, node_test_1.test)('finale stamps the village title and grants one Hollow Gate Key', () => {
    const c = character({ level: 100, storyProgress: 8, inventory: ['hollow-gate-key'] });
    const settled = (0, _settle_js_1.applyStoryBossSettlement)(c, token((0, _settle_js_1.storyOpponentId)('Stormveil Village', 100)), 20);
    strict_1.default.equal(settled.ok, true);
    if (!settled.ok)
        return;
    strict_1.default.equal(settled.finale, true);
    strict_1.default.equal(settled.character.storyProgress, 9);
    strict_1.default.equal(settled.character.storyTitle, 'Stormbreaker');
    strict_1.default.equal(settled.character.inventory.filter((id) => id === 'hollow-gate-key').length, 1);
});
(0, node_test_1.test)('all four finales grant their canonical title and remain one-shot on replay', () => {
    const villages = new Map([
        ['Stormveil Village', 'Stormbreaker'],
        ['Ashen Leaf Village', 'Root Liberator'],
        ['Frostfang Village', 'Oathbreaker'],
        ['Moonshadow Village', 'Moon Unmasked'],
    ]);
    for (const [village, title] of villages) {
        const fightToken = token((0, _settle_js_1.storyOpponentId)(village, 100));
        const first = (0, _settle_js_1.applyStoryBossSettlement)(character({ village, level: 100, storyProgress: 8 }), fightToken, 20);
        strict_1.default.equal(first.ok, true, `${village}: finale should settle`);
        if (!first.ok)
            continue;
        strict_1.default.equal(first.character.storyTitle, title);
        strict_1.default.equal(first.character.inventory.filter((id) => id === 'hollow-gate-key').length, 1);
        strict_1.default.equal((0, _settle_js_1.applyStoryBossSettlement)(first.character, fightToken, 20).ok, false, `${village}: replay must not pay twice`);
    }
});
(0, node_test_1.test)('generic saves cannot skip story progress or forge the redemption ledger', () => {
    const out = (0, _name__js_1.sanitizeCharacterSave)({ character: { ...character(), storyProgress: 9, redeemedStoryBattles: [{ token: 'forged' }] } }, { character: { ...character(), storyProgress: 2, redeemedStoryBattles: [{ token: 'server', progress: 2 }] } }).character;
    strict_1.default.equal(out.storyProgress, 2);
    strict_1.default.deepEqual(out.redeemedStoryBattles, [{ token: 'server', progress: 2 }]);
});
(0, node_test_1.test)('Academy spar is a one-step canonical grant bound to its temporary opponent token', () => {
    const c = character({ level: 1, onboardingStep: 'academySpar', maxHp: 100, hp: 100 });
    const settled = (0, _settle_js_1.applyAcademySparSettlement)(c, token(`temp-academy-spar-${Date.now()}`));
    strict_1.default.equal(settled.ok, true);
    if (!settled.ok)
        return;
    strict_1.default.equal(settled.xp, 60);
    strict_1.default.equal(settled.ryo, 30);
    strict_1.default.equal(settled.character.onboardingStep, 'cafeteria');
    strict_1.default.equal(settled.character.academySparClaimed, true);
    strict_1.default.equal(settled.character.hp, Number(settled.character.maxHp) - 25);
    strict_1.default.equal((0, _settle_js_1.applyAcademySparSettlement)({ ...c, onboardingStep: 'cafeteria' }, token(`temp-academy-spar-${Date.now()}`)).ok, false);
    strict_1.default.equal((0, _settle_js_1.applyAcademySparSettlement)({ ...c, academySparClaimed: true }, token(`temp-academy-spar-${Date.now()}`)).ok, false);
});
