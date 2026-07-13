"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _first_save_baseline_js_1 = require("./_first-save-baseline.js");
const _name__js_1 = require("./[name].js");
(0, node_test_1.describe)('canonical first player save', () => {
    (0, node_test_1.it)('replaces forged economy, progression, stats, inventory, cards, and pets with the starter grant', () => {
        const out = (0, _first_save_baseline_js_1.applyCanonicalFirstSave)({
            name: 'Audit', village: 'Stormveil Village', specialty: 'Ninjutsu', bloodline: 'Ashen Eyes',
            level: 100, xp: 999_999_999, ryo: 999_999_999, fateShards: 999_999,
            stats: { strength: 999_999 }, unspentStats: 999_999,
            inventory: ['legendary-war-crate', 'forged-item'],
            itemStacks: [{ itemId: 'potion-rejuvenation', count: 9_999 }],
            pets: [{ id: 'forged-mythic', rarity: 'mythic' }], tileCards: ['tc-121'],
            equipment: { weapon: 'forged-item' }, profession: 'vanguard',
            masterySpec: { forged: 99 }, totalAiKills: 50_000,
        });
        node_assert_1.strict.equal(out.name, 'Audit', 'identity/customization fields survive');
        node_assert_1.strict.equal(out.village, 'Stormveil Village');
        node_assert_1.strict.equal(out.level, 1);
        node_assert_1.strict.equal(out.xp, 0);
        node_assert_1.strict.equal(out.ryo, _first_save_baseline_js_1.FIRST_SAVE_RYO);
        node_assert_1.strict.equal(out.fateShards, 0);
        node_assert_1.strict.equal(out.unspentStats, 20);
        node_assert_1.strict.deepEqual(out.inventory, [..._first_save_baseline_js_1.FIRST_SAVE_INVENTORY]);
        node_assert_1.strict.deepEqual(out.itemStacks, []);
        node_assert_1.strict.deepEqual(out.pets, []);
        node_assert_1.strict.deepEqual(out.tileCards, []);
        node_assert_1.strict.deepEqual(out.equipment, {});
        node_assert_1.strict.equal(out.profession, undefined);
        node_assert_1.strict.equal(out.masterySpec, undefined);
        node_assert_1.strict.equal(out.totalAiKills, 0);
        node_assert_1.strict.deepEqual(Object.values(out.stats), Array(12).fill(10));
    });
    (0, node_test_1.it)('is idempotent and does not mutate the submitted character', () => {
        const incoming = { name: 'Rill', inventory: ['forged'], ryo: 5000 };
        const once = (0, _first_save_baseline_js_1.applyCanonicalFirstSave)(incoming);
        const twice = (0, _first_save_baseline_js_1.applyCanonicalFirstSave)(once);
        node_assert_1.strict.deepEqual(twice, once);
        node_assert_1.strict.deepEqual(incoming, { name: 'Rill', inventory: ['forged'], ryo: 5000 });
    });
    (0, node_test_1.it)('is enforced by the real generic save sanitizer when no character exists', () => {
        const out = (0, _name__js_1.sanitizeCharacterSave)({
            character: {
                name: 'Hostile', village: 'Stormveil Village', specialty: 'Ninjutsu', bloodline: 'Ashen Eyes',
                level: 100, xp: 999_999_999, ryo: 999_999_999, fateShards: 999_999,
                stats: { strength: 999_999 }, inventory: ['forged-item'],
                itemStacks: [{ itemId: 'forged-stack', count: 9_999 }],
                pets: [{ id: 'forged-pet', rarity: 'mythic', hp: 99_999 }],
                tileCards: ['forged-card'],
            },
        }, null);
        const character = out.character;
        node_assert_1.strict.equal(character.level, 1);
        node_assert_1.strict.equal(character.xp, 0);
        node_assert_1.strict.equal(character.ryo, _first_save_baseline_js_1.FIRST_SAVE_RYO);
        node_assert_1.strict.equal(character.fateShards, 0);
        node_assert_1.strict.deepEqual(character.inventory, [..._first_save_baseline_js_1.FIRST_SAVE_INVENTORY]);
        node_assert_1.strict.deepEqual(character.itemStacks, []);
        node_assert_1.strict.deepEqual(character.pets, []);
        node_assert_1.strict.deepEqual(character.tileCards, []);
    });
    (0, node_test_1.it)('does not let a later generic save erase or forge the war-crate claim ledger', () => {
        const base = { name: 'Audit', level: 10, xp: 0, ryo: 100, stats: {}, claimedWarCrateIds: ['war-crate-a-vs-b'] };
        const out = (0, _name__js_1.sanitizeCharacterSave)({ character: { ...base, claimedWarCrateIds: ['war-crate-forged-vs-id'] } }, { character: base });
        node_assert_1.strict.deepEqual(out.character.claimedWarCrateIds, ['war-crate-a-vs-b']);
    });
});
