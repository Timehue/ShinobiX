"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _pet_stat_ceil_js_1 = require("./_pet-stat-ceil.js");
const STATS = ['hp', 'attack', 'defense', 'speed'];
// The in-game all-in level-100 growth ceiling: base * (1 + PET_LEVEL_GROWTH * 99)
// = base * (1 + 0.04 * 99) = base * 4.96 (see gainPetXp in client pet-balance).
const ALL_IN_MULT = 1 + 0.04 * 99;
(0, node_test_1.describe)('petStatCeil — pet-ladder anti-tamper ceiling', () => {
    (0, node_test_1.it)('bounds a tampered 100k stat far below the old flat clamp', () => {
        for (const rarity of Object.keys(_pet_stat_ceil_js_1.PET_BASE_STATS)) {
            for (const stat of STATS) {
                const ceil = (0, _pet_stat_ceil_js_1.petStatCeil)(rarity, stat);
                node_assert_1.strict.ok(ceil < 100_000, `${rarity}.${stat} ceiling ${ceil} must be < 100000`);
                node_assert_1.strict.equal(ceil, Math.round(_pet_stat_ceil_js_1.PET_BASE_STATS[rarity][stat] * _pet_stat_ceil_js_1.PET_STAT_CEIL_FACTOR));
            }
        }
    });
    (0, node_test_1.it)('NEVER clips a legit all-in level-100 build (base*4.96)', () => {
        for (const rarity of Object.keys(_pet_stat_ceil_js_1.PET_BASE_STATS)) {
            for (const stat of STATS) {
                const legitMax = Math.round(_pet_stat_ceil_js_1.PET_BASE_STATS[rarity][stat] * ALL_IN_MULT);
                node_assert_1.strict.ok((0, _pet_stat_ceil_js_1.petStatCeil)(rarity, stat) >= legitMax, `${rarity}.${stat}: ceiling ${(0, _pet_stat_ceil_js_1.petStatCeil)(rarity, stat)} must be >= legit max ${legitMax}`);
            }
        }
    });
    (0, node_test_1.it)('keeps a comfortable safety margin above the legit max (≥40%)', () => {
        for (const rarity of Object.keys(_pet_stat_ceil_js_1.PET_BASE_STATS)) {
            for (const stat of STATS) {
                const legitMax = _pet_stat_ceil_js_1.PET_BASE_STATS[rarity][stat] * ALL_IN_MULT;
                node_assert_1.strict.ok((0, _pet_stat_ceil_js_1.petStatCeil)(rarity, stat) >= legitMax * 1.4, `${rarity}.${stat}: ceiling should keep a ≥40% margin over the legit max`);
            }
        }
    });
    (0, node_test_1.it)('falls back to mythic (loosest tier) for an unknown / tampered rarity', () => {
        for (const stat of STATS) {
            node_assert_1.strict.equal((0, _pet_stat_ceil_js_1.petStatCeil)('not-a-rarity', stat), (0, _pet_stat_ceil_js_1.petStatCeil)('mythic', stat));
            node_assert_1.strict.equal((0, _pet_stat_ceil_js_1.petStatCeil)(undefined, stat), (0, _pet_stat_ceil_js_1.petStatCeil)('mythic', stat));
            node_assert_1.strict.equal((0, _pet_stat_ceil_js_1.petStatCeil)(123, stat), (0, _pet_stat_ceil_js_1.petStatCeil)('mythic', stat));
        }
    });
});
