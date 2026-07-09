"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _kage_unlock_js_1 = require("./_kage-unlock.js");
const NOW = 1_752_000_000_000;
(0, node_test_1.describe)('applyKageUnlock — first clear seats, later clears never do', () => {
    (0, node_test_1.it)('first verified clear unlocks, seats, and brands firstLiberator', () => {
        const { next, freshUnlock } = (0, _kage_unlock_js_1.applyKageUnlock)({ kageSystemUnlocked: false }, 'FirstHero', NOW);
        node_assert_1.strict.equal(freshUnlock, true);
        node_assert_1.strict.equal(next.kageSystemUnlocked, true);
        node_assert_1.strict.equal(next.seatedKage, 'FirstHero');
        node_assert_1.strict.equal(next.firstLiberator, 'FirstHero');
        node_assert_1.strict.equal(next.unlockedAt, NOW);
    });
    (0, node_test_1.it)('a second clear changes nothing: seat and firstLiberator stay with the first', () => {
        const first = (0, _kage_unlock_js_1.applyKageUnlock)({ kageSystemUnlocked: false }, 'FirstHero', NOW).next;
        const { next, freshUnlock } = (0, _kage_unlock_js_1.applyKageUnlock)(first, 'SecondHero', NOW + 1000);
        node_assert_1.strict.equal(freshUnlock, false);
        node_assert_1.strict.deepEqual(next, first);
        node_assert_1.strict.equal(next.seatedKage, 'FirstHero');
        node_assert_1.strict.equal(next.firstLiberator, 'FirstHero');
    });
    (0, node_test_1.it)('a later clear never reseats even after the seat changed hands via challenges', () => {
        const contested = {
            kageSystemUnlocked: true,
            seatedKage: 'CurrentChampion',
            firstLiberator: 'FirstHero',
            unlockedAt: NOW - 86_400_000,
        };
        const { next, freshUnlock } = (0, _kage_unlock_js_1.applyKageUnlock)(contested, 'ThirdHero', NOW);
        node_assert_1.strict.equal(freshUnlock, false);
        node_assert_1.strict.equal(next.seatedKage, 'CurrentChampion', 'story clears must never override the challenge system');
        node_assert_1.strict.equal(next.firstLiberator, 'FirstHero');
    });
    (0, node_test_1.it)('an admin reset re-seals the village and the next clear seats fresh', () => {
        const resealed = { kageSystemUnlocked: false };
        const { next, freshUnlock } = (0, _kage_unlock_js_1.applyKageUnlock)(resealed, 'NewEraHero', NOW);
        node_assert_1.strict.equal(freshUnlock, true);
        node_assert_1.strict.equal(next.firstLiberator, 'NewEraHero');
    });
});
