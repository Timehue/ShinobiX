"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _name__js_1 = require("./[name].js");
(0, node_test_1.test)('generic saves cannot forge server-owned achievement and combat progression', () => {
    const stored = { character: {
            auraSphereLevel: 7,
            auraDust: 50,
            redeemedAuraFeeds: ['aura_receipt_1'],
            battleTowerAscension: 3,
            rankedSeasonsWon: 1,
            weeklyBossKills: { '2026-W01': 'boss-a' },
            defeatedAiIds: ['enemy-a'],
            hunterRank: 2,
            redeemedHunterRanks: ['hunter_receipt_1'],
            element: 'Fire', elements: ['Fire'], claimedAwakenings: ['awakening-free-lv2'], redeemedAwakeningActions: ['awakening_receipt_1'],
            examsPassed: ['genin'],
            elderFocus: 'trade',
        } };
    const incoming = { character: {
            auraSphereLevel: 300,
            auraDust: 50,
            redeemedAuraFeeds: [],
            battleTowerAscension: 20,
            rankedSeasonsWon: 99,
            weeklyBossKills: { forged1: 'x', forged2: 'x', forged3: 'x', forged4: 'x', forged5: 'x' },
            defeatedAiIds: Array.from({ length: 200 }, (_, i) => `forged-${i}`),
            hunterRank: 5,
            redeemedHunterRanks: [],
            element: 'Lightning', elements: ['Fire', 'Water', 'Wind', 'Earth', 'Lightning'], claimedAwakenings: [], redeemedAwakeningActions: [],
            examsPassed: ['genin', 'chunin', 'jonin', 'specialJonin'],
            elderFocus: 'training',
        } };
    const out = (0, _name__js_1.sanitizeCharacterSave)(incoming, stored);
    const storedCharacter = stored.character;
    for (const field of ['auraSphereLevel', 'redeemedAuraFeeds', 'battleTowerAscension', 'rankedSeasonsWon', 'weeklyBossKills', 'defeatedAiIds', 'hunterRank', 'redeemedHunterRanks', 'element', 'elements', 'claimedAwakenings', 'redeemedAwakeningActions', 'examsPassed', 'elderFocus']) {
        strict_1.default.deepEqual(out.character[field], storedCharacter[field], field);
    }
});
(0, node_test_1.test)('first save canonicalizes server-owned progression', () => {
    const out = (0, _name__js_1.sanitizeCharacterSave)({ character: {
            auraSphereLevel: 300,
            battleTowerAscension: 20,
            rankedSeasonsWon: 99,
            weeklyBossKills: { forged: 'boss' },
            defeatedAiIds: ['forged'],
            redeemedAuraFeeds: ['forged_receipt'],
            hunterRank: 5,
            redeemedHunterRanks: ['forged_receipt'],
            element: 'Fire', elements: ['Fire', 'Water'], claimedAwakenings: ['forged'], redeemedAwakeningActions: ['forged'],
            elderFocus: 'trade',
        } }, null);
    strict_1.default.equal(out.character.auraSphereLevel, 1);
    strict_1.default.equal(out.character.battleTowerAscension, 0);
    strict_1.default.equal(out.character.rankedSeasonsWon, 0);
    strict_1.default.deepEqual(out.character.weeklyBossKills, {});
    strict_1.default.deepEqual(out.character.defeatedAiIds, []);
    strict_1.default.deepEqual(out.character.redeemedAuraFeeds, []);
    strict_1.default.equal(out.character.hunterRank, 0);
    strict_1.default.deepEqual(out.character.redeemedHunterRanks, []);
    strict_1.default.equal(out.character.element, undefined);
    strict_1.default.deepEqual(out.character.elements, []);
    strict_1.default.deepEqual(out.character.claimedAwakenings, []);
    strict_1.default.deepEqual(out.character.redeemedAwakeningActions, []);
    strict_1.default.equal(out.character.elderFocus, undefined);
});
(0, node_test_1.test)('generic saves cannot forge an owned pet combat build or paid loadout', () => {
    const storedPet = { id: 'pet-1', name: 'Wolf', rarity: 'rare', maxLevel: 100, level: 12, xp: 30, hp: 400, attack: 55, defense: 40, speed: 38, jutsus: [{ name: 'Bite', power: 60 }], unlockedForPve: false, happiness: 20, training: null, nickname: 'Ash', loadout: { pvp: 'owned-gear' } };
    const forgedPet = { ...storedPet, level: 100, xp: 0, hp: 99999, attack: 99999, defense: 99999, speed: 99999, jutsus: [{ name: 'Bite', power: 99999 }], unlockedForPve: true, happiness: 100, training: { type: 'strength', endsAt: 1 }, nickname: 'Free Rename', loadout: { pvp: 'unowned-gear' } };
    const out = (0, _name__js_1.sanitizeCharacterSave)({ character: { pets: [forgedPet] } }, { character: { pets: [storedPet] } });
    for (const field of ['level', 'xp', 'hp', 'attack', 'defense', 'speed', 'jutsus', 'unlockedForPve', 'happiness', 'training', 'nickname', 'loadout']) {
        strict_1.default.deepEqual(out.character.pets[0][field], storedPet[field], field);
    }
});
