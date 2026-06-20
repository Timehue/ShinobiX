"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _evolution_js_1 = require("./_evolution.js");
// A standard-tier starter at an arbitrary level/stat block.
function fireStarter(over = {}) {
    return {
        id: 'starter-fire',
        name: 'Cinder Cub',
        rarity: 'standard',
        level: 50,
        hp: 300,
        attack: 46,
        defense: 24,
        speed: 32,
        moveRange: 3,
        element: 'Fire',
        jutsus: [{ name: 'Flame Burst', power: 56 }],
        ...over,
    };
}
(0, node_test_1.describe)('evolution spec / lines', () => {
    (0, node_test_1.it)('defines a line for all 5 starters and nothing else', () => {
        node_assert_1.strict.deepEqual(Object.keys(_evolution_js_1.EVOLUTION_LINES).sort(), ['starter-earth', 'starter-fire', 'starter-lightning', 'starter-water', 'starter-wind']);
        node_assert_1.strict.equal((0, _evolution_js_1.evolutionLineFor)('starter-fire')?.element, 'Fire');
        node_assert_1.strict.equal((0, _evolution_js_1.evolutionLineFor)('standard-3'), null);
        node_assert_1.strict.equal((0, _evolution_js_1.evolutionLineFor)('mythic-0'), null);
    });
    (0, node_test_1.it)('each line gates Lv50/Awakening then Lv90/Ascension into rare then legendary', () => {
        for (const line of Object.values(_evolution_js_1.EVOLUTION_LINES)) {
            node_assert_1.strict.equal(line.stages[1].rarity, 'rare');
            node_assert_1.strict.equal(line.stages[1].requiredLevel, 50);
            node_assert_1.strict.equal(line.stages[1].requiredItem, 'evo-stone-awakening');
            node_assert_1.strict.equal(line.stages[2].rarity, 'legendary');
            node_assert_1.strict.equal(line.stages[2].requiredLevel, 90);
            node_assert_1.strict.equal(line.stages[2].requiredItem, 'evo-stone-ascension');
        }
    });
});
(0, node_test_1.describe)('stage inference', () => {
    (0, node_test_1.it)('maps rarity → stage', () => {
        node_assert_1.strict.equal((0, _evolution_js_1.stageFromRarity)('standard'), 0);
        node_assert_1.strict.equal((0, _evolution_js_1.stageFromRarity)('rare'), 1);
        node_assert_1.strict.equal((0, _evolution_js_1.stageFromRarity)('legendary'), 2);
        node_assert_1.strict.equal((0, _evolution_js_1.stageFromRarity)('mythic'), 0);
    });
    (0, node_test_1.it)('explicit evolutionStage wins over rarity', () => {
        node_assert_1.strict.equal((0, _evolution_js_1.currentStage)({ evolutionStage: 2, rarity: 'standard' }), 2);
        node_assert_1.strict.equal((0, _evolution_js_1.currentStage)({ rarity: 'rare' }), 1);
        node_assert_1.strict.equal((0, _evolution_js_1.currentStage)({ rarity: 'standard' }), 0);
    });
});
(0, node_test_1.describe)('checkEvolve gating', () => {
    (0, node_test_1.it)('rejects a non-starter pet', () => {
        const c = (0, _evolution_js_1.checkEvolve)({ id: 'rare-4', rarity: 'rare', level: 99 }, ['evo-stone-ascension']);
        node_assert_1.strict.equal(c.ok, false);
        node_assert_1.strict.equal(c.code, 'not-evolvable');
    });
    (0, node_test_1.it)('rejects when under the level gate', () => {
        const c = (0, _evolution_js_1.checkEvolve)(fireStarter({ level: 49 }), ['evo-stone-awakening']);
        node_assert_1.strict.equal(c.ok, false);
        node_assert_1.strict.equal(c.code, 'level-too-low');
    });
    (0, node_test_1.it)('rejects when the required stone is absent', () => {
        const c = (0, _evolution_js_1.checkEvolve)(fireStarter({ level: 50 }), []);
        node_assert_1.strict.equal(c.ok, false);
        node_assert_1.strict.equal(c.code, 'missing-item');
    });
    (0, node_test_1.it)('rejects a fully evolved (legendary / stage 2) pet', () => {
        const c = (0, _evolution_js_1.checkEvolve)(fireStarter({ rarity: 'legendary', evolutionStage: 2, level: 100 }), ['evo-stone-ascension']);
        node_assert_1.strict.equal(c.ok, false);
        node_assert_1.strict.equal(c.code, 'max-evolved');
    });
    (0, node_test_1.it)('rejects when rarity and stage disagree (tampered save)', () => {
        // Claims stage 0 via rarity but is actually rare → asking for stage-1
        // evolution while already rare is a wrong-tier conflict.
        const c = (0, _evolution_js_1.checkEvolve)(fireStarter({ rarity: 'rare', evolutionStage: 0, level: 60 }), ['evo-stone-awakening']);
        node_assert_1.strict.equal(c.ok, false);
        node_assert_1.strict.equal(c.code, 'wrong-tier');
    });
    (0, node_test_1.it)('accepts a valid stage-1 evolution', () => {
        const c = (0, _evolution_js_1.checkEvolve)(fireStarter({ level: 55 }), ['pet-treat', 'evo-stone-awakening']);
        node_assert_1.strict.equal(c.ok, true);
        node_assert_1.strict.equal(c.nextStage, 1);
        node_assert_1.strict.equal(c.spec?.rarity, 'rare');
    });
    (0, node_test_1.it)('accepts a valid stage-2 evolution from a rare pet', () => {
        const c = (0, _evolution_js_1.checkEvolve)(fireStarter({ rarity: 'rare', evolutionStage: 1, level: 90 }), ['evo-stone-ascension']);
        node_assert_1.strict.equal(c.ok, true);
        node_assert_1.strict.equal(c.nextStage, 2);
        node_assert_1.strict.equal(c.spec?.rarity, 'legendary');
    });
});
(0, node_test_1.describe)('evolvePet stat math', () => {
    (0, node_test_1.it)('applies the standard→rare delta and preserves identity + element', () => {
        const base = fireStarter({ level: 50 });
        const evolved = (0, _evolution_js_1.evolvePet)(base, 1, (0, _evolution_js_1.evolutionLineFor)('starter-fire'));
        node_assert_1.strict.equal(evolved.id, 'starter-fire'); // id NEVER changes
        node_assert_1.strict.equal(evolved.element, 'Fire'); // element preserved
        node_assert_1.strict.equal(evolved.rarity, 'rare');
        node_assert_1.strict.equal(evolved.name, 'Ember Wolf');
        node_assert_1.strict.equal(evolved.evolutionStage, 1);
        node_assert_1.strict.equal(evolved.hp, 350); // 300 + 50
        node_assert_1.strict.equal(evolved.attack, 54); // 46 + 8
        node_assert_1.strict.equal(evolved.defense, 30); // 24 + 6
        node_assert_1.strict.equal(evolved.speed, 38); // 32 + 6
        node_assert_1.strict.equal(evolved.moveRange, 3); // +0 at rare
        node_assert_1.strict.deepEqual(evolved.jutsus, base.jutsus); // kit unchanged
    });
    (0, node_test_1.it)('applies the rare→legendary delta and bumps moveRange', () => {
        const rare = fireStarter({ rarity: 'rare', evolutionStage: 1, level: 90, hp: 800, attack: 120, defense: 90, speed: 100, moveRange: 3 });
        const evolved = (0, _evolution_js_1.evolvePet)(rare, 2, (0, _evolution_js_1.evolutionLineFor)('starter-fire'));
        node_assert_1.strict.equal(evolved.rarity, 'legendary');
        node_assert_1.strict.equal(evolved.name, 'Inferno Fenrir');
        node_assert_1.strict.equal(evolved.evolutionStage, 2);
        node_assert_1.strict.equal(evolved.hp, 846); // 800 + 46
        node_assert_1.strict.equal(evolved.attack, 126); // 120 + 6
        node_assert_1.strict.equal(evolved.moveRange, 4); // 3 + 1
    });
    (0, node_test_1.it)('adds the evolution delta with no cap clamp (HP/ATK/DEF/SPD are uncapped)', () => {
        const maxed = fireStarter({ level: 60, hp: 1700, attack: 260, defense: 210, speed: 190 });
        const evolved = (0, _evolution_js_1.evolvePet)(maxed, 1, (0, _evolution_js_1.evolutionLineFor)('starter-fire'));
        node_assert_1.strict.equal(evolved.hp, 1750); // 1700 + 50
        node_assert_1.strict.equal(evolved.attack, 268); // 260 + 8
        node_assert_1.strict.equal(evolved.defense, 216); // 210 + 6
        node_assert_1.strict.equal(evolved.speed, 196); // 190 + 6
        // A stat that would have blown past the OLD rare cap (240) is no longer
        // clamped — training/evolution stats add freely now.
        const overDef = fireStarter({ level: 60, defense: 238 });
        const e2 = (0, _evolution_js_1.evolvePet)(overDef, 1, (0, _evolution_js_1.evolutionLineFor)('starter-fire'));
        node_assert_1.strict.equal(e2.defense, 244); // 238 + 6, uncapped
    });
});
