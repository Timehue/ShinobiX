"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _name__js_1 = require("./[name].js");
const existingCharacter = {
    name: 'Player', level: 12, xp: 345, experience: 345, profession: 'vanguard', professionXp: 900,
    ryo: 10_000, fateShards: 10, boneCharms: 11, auraStones: 12, auraDust: 13,
    mythicSeals: 14, honorSeals: 15, hollowShards: 16, stats: {}, inventory: [], pets: [],
};
(0, node_test_1.describe)('generic-save economy entitlement', () => {
    (0, node_test_1.it)('rejects every positive wallet, XP, level, and profession-XP delta', () => {
        const forged = Object.fromEntries(Object.entries(existingCharacter).map(([key, value]) => [key, typeof value === 'number' ? value + 999_999 : value]));
        const result = (0, _name__js_1.sanitizeCharacterSave)({ character: forged }, { character: existingCharacter });
        const char = result.character;
        for (const field of ['level', 'xp', 'experience', 'professionXp', 'ryo', 'fateShards', 'boneCharms', 'auraStones', 'auraDust', 'mythicSeals', 'honorSeals', 'hollowShards']) {
            node_assert_1.strict.equal(char[field], existingCharacter[field], field);
        }
    });
    (0, node_test_1.it)('continues to allow legitimate wallet spending', () => {
        const incoming = {
            ...existingCharacter,
            ryo: 9_000, fateShards: 9, boneCharms: 10, auraStones: 11, auraDust: 12,
            mythicSeals: 13, honorSeals: 14, hollowShards: 15,
        };
        const result = (0, _name__js_1.sanitizeCharacterSave)({ character: incoming }, { character: existingCharacter });
        const char = result.character;
        node_assert_1.strict.equal(char.ryo, 9_000);
        node_assert_1.strict.equal(char.fateShards, 9);
        node_assert_1.strict.equal(char.hollowShards, 15);
        node_assert_1.strict.equal(char.level, 12);
        node_assert_1.strict.equal(char.xp, 345);
    });
});
