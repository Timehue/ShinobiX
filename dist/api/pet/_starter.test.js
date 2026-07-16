"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _starter_js_1 = require("./_starter.js");
const FIRE = {
    id: 'starter-fire', name: 'Cinder Cub', rarity: 'standard', level: 1, xp: 0, maxLevel: 100,
    hp: 280, attack: 56, defense: 22, speed: 38, moveRange: 3, element: 'Fire', trait: 'Aggressive',
    unlockedForPve: false,
    description: "A hot-tempered fox kit whose fur smolders when it's spoiling for a fight.",
    jutsus: [
        { name: 'Cinder Pounce', power: 48, cooldown: 2, currentCooldown: 0, kind: 'damage' },
        { name: 'Searing Wound', power: 30, cooldown: 4, currentCooldown: 0, kind: 'wound', rounds: 2 },
        { name: 'Flame Burst', power: 58, cooldown: 3, currentCooldown: 0, kind: 'damage', signature: true },
        { name: 'Ember Dash', power: 0, cooldown: 3, currentCooldown: 0, kind: 'move' },
    ],
};
(0, node_test_1.describe)('starter pet entitlement', () => {
    (0, node_test_1.it)('accepts an exact canonical starter and rejects modified payloads', () => {
        node_assert_1.strict.ok((0, _starter_js_1.validateStarterPet)(FIRE));
        node_assert_1.strict.equal((0, _starter_js_1.validateStarterPet)({ ...FIRE, attack: 9999 }), null);
    });
    (0, node_test_1.it)('grants once and applies the canonical trait bonus', () => {
        const result = (0, _starter_js_1.chooseStarterPet)({ onboardingStep: 'starter', pets: [] }, FIRE);
        node_assert_1.strict.equal(result.ok, true);
        if (result.ok) {
            const pet = result.character.pets[0];
            node_assert_1.strict.equal(pet.attack, Math.round(56 * 1.15));
            node_assert_1.strict.equal(result.character.onboardingStep, 'training');
        }
    });
    (0, node_test_1.it)('persists the cinematic starter before the companion-introduction pass', () => {
        const result = (0, _starter_js_1.chooseStarterPet)({ onboardingStep: 'academyIntro', pets: [] }, FIRE);
        node_assert_1.strict.equal(result.ok, true);
        if (result.ok) {
            node_assert_1.strict.equal(result.character.activePetId, 'starter-fire');
            node_assert_1.strict.equal(result.character.onboardingStep, 'companionIntro');
            node_assert_1.strict.equal(result.character.starterPetClaimed, true);
        }
    });
    (0, node_test_1.it)('rejects replay and out-of-sequence claims', () => {
        node_assert_1.strict.equal((0, _starter_js_1.chooseStarterPet)({ onboardingStep: 'training', pets: [] }, FIRE).ok, false);
        node_assert_1.strict.equal((0, _starter_js_1.chooseStarterPet)({ onboardingStep: 'starter', pets: [{}] }, FIRE).ok, false);
    });
});
