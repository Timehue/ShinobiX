"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _name__js_1 = require("./[name].js");
const stored = {
    name: 'Player', level: 10, xp: 0, ryo: 0, stats: {},
    inventory: ['shinobi-vest', 'pet-treat', 'pet-treat'], itemStacks: [], tileCards: ['tc-01'],
    pets: [{ id: 'pet-1', name: 'Fox', rarity: 'rare', maxLevel: 100, level: 5, xp: 2, hp: 40, attack: 20, defense: 20, speed: 20, jutsus: [{ name: 'Bite', power: 10 }], unlockedForPve: true }],
};
(0, node_test_1.describe)('generic-save ownership entitlement', () => {
    (0, node_test_1.it)('rejects ordinary inventory and card additions while allowing consumption and stack migration', () => {
        const result = (0, _name__js_1.sanitizeCharacterSave)({ character: {
                ...stored,
                inventory: ['forged-sword'],
                itemStacks: [{ itemId: 'pet-treat', count: 2 }, { itemId: 'forged-stack', count: 99 }],
                tileCards: ['tc-01', 'tc-21'],
            } }, { character: stored });
        const char = result.character;
        node_assert_1.strict.deepEqual(char.inventory, []);
        node_assert_1.strict.deepEqual(char.itemStacks, [{ itemId: 'pet-treat', count: 2 }]);
        node_assert_1.strict.deepEqual(char.tileCards, ['tc-01']);
    });
    (0, node_test_1.it)('rejects new pets and preserves stored combat identity for existing IDs', () => {
        const result = (0, _name__js_1.sanitizeCharacterSave)({ character: { ...stored, pets: [
                    { ...stored.pets[0], rarity: 'mythic', jutsus: [{ name: 'Forge', power: 9999 }], level: 6 },
                    { id: 'forged-pet', rarity: 'mythic', jutsus: [] },
                ] } }, { character: stored });
        const pets = result.character.pets;
        node_assert_1.strict.equal(pets.length, 1);
        node_assert_1.strict.equal(pets[0].id, 'pet-1');
        node_assert_1.strict.equal(pets[0].rarity, 'rare');
        node_assert_1.strict.deepEqual(pets[0].jutsus, stored.pets[0].jutsus);
        node_assert_1.strict.equal(pets[0].level, 5);
    });
});
