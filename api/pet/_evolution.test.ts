import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    EVOLUTION_LINES,
    evolutionLineFor,
    stageFromRarity,
    currentStage,
    checkEvolve,
    evolvePet,
    type PetLike,
} from './_evolution.js';

// A standard-tier starter at an arbitrary level/stat block.
function fireStarter(over: Partial<PetLike> = {}): PetLike {
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

describe('evolution spec / lines', () => {
    it('defines a line for all 5 starters and nothing else', () => {
        assert.deepEqual(
            Object.keys(EVOLUTION_LINES).sort(),
            ['starter-earth', 'starter-fire', 'starter-lightning', 'starter-water', 'starter-wind'],
        );
        assert.equal(evolutionLineFor('starter-fire')?.element, 'Fire');
        assert.equal(evolutionLineFor('standard-3'), null);
        assert.equal(evolutionLineFor('mythic-0'), null);
    });

    it('each line gates Lv50/Awakening then Lv90/Ascension into rare then legendary', () => {
        for (const line of Object.values(EVOLUTION_LINES)) {
            assert.equal(line.stages[1].rarity, 'rare');
            assert.equal(line.stages[1].requiredLevel, 50);
            assert.equal(line.stages[1].requiredItem, 'evo-stone-awakening');
            assert.equal(line.stages[2].rarity, 'legendary');
            assert.equal(line.stages[2].requiredLevel, 90);
            assert.equal(line.stages[2].requiredItem, 'evo-stone-ascension');
        }
    });
});

describe('stage inference', () => {
    it('maps rarity → stage', () => {
        assert.equal(stageFromRarity('standard'), 0);
        assert.equal(stageFromRarity('rare'), 1);
        assert.equal(stageFromRarity('legendary'), 2);
        assert.equal(stageFromRarity('mythic'), 0);
    });
    it('explicit evolutionStage wins over rarity', () => {
        assert.equal(currentStage({ evolutionStage: 2, rarity: 'standard' }), 2);
        assert.equal(currentStage({ rarity: 'rare' }), 1);
        assert.equal(currentStage({ rarity: 'standard' }), 0);
    });
});

describe('checkEvolve gating', () => {
    it('rejects a non-starter pet', () => {
        const c = checkEvolve({ id: 'rare-4', rarity: 'rare', level: 99 }, ['evo-stone-ascension']);
        assert.equal(c.ok, false);
        assert.equal(c.code, 'not-evolvable');
    });

    it('rejects when under the level gate', () => {
        const c = checkEvolve(fireStarter({ level: 49 }), ['evo-stone-awakening']);
        assert.equal(c.ok, false);
        assert.equal(c.code, 'level-too-low');
    });

    it('rejects when the required stone is absent', () => {
        const c = checkEvolve(fireStarter({ level: 50 }), []);
        assert.equal(c.ok, false);
        assert.equal(c.code, 'missing-item');
    });

    it('rejects a fully evolved (legendary / stage 2) pet', () => {
        const c = checkEvolve(fireStarter({ rarity: 'legendary', evolutionStage: 2, level: 100 }), ['evo-stone-ascension']);
        assert.equal(c.ok, false);
        assert.equal(c.code, 'max-evolved');
    });

    it('rejects when rarity and stage disagree (tampered save)', () => {
        // Claims stage 0 via rarity but is actually rare → asking for stage-1
        // evolution while already rare is a wrong-tier conflict.
        const c = checkEvolve(fireStarter({ rarity: 'rare', evolutionStage: 0, level: 60 }), ['evo-stone-awakening']);
        assert.equal(c.ok, false);
        assert.equal(c.code, 'wrong-tier');
    });

    it('accepts a valid stage-1 evolution', () => {
        const c = checkEvolve(fireStarter({ level: 55 }), ['pet-treat', 'evo-stone-awakening']);
        assert.equal(c.ok, true);
        assert.equal(c.nextStage, 1);
        assert.equal(c.spec?.rarity, 'rare');
    });

    it('accepts a valid stage-2 evolution from a rare pet', () => {
        const c = checkEvolve(fireStarter({ rarity: 'rare', evolutionStage: 1, level: 90 }), ['evo-stone-ascension']);
        assert.equal(c.ok, true);
        assert.equal(c.nextStage, 2);
        assert.equal(c.spec?.rarity, 'legendary');
    });
});

describe('evolvePet stat math', () => {
    it('applies the standard→rare delta and preserves identity + element', () => {
        const base = fireStarter({ level: 50 });
        const evolved = evolvePet(base, 1, evolutionLineFor('starter-fire')!);
        assert.equal(evolved.id, 'starter-fire');          // id NEVER changes
        assert.equal(evolved.element, 'Fire');             // element preserved
        assert.equal(evolved.rarity, 'rare');
        assert.equal(evolved.name, 'Ember Wolf');
        assert.equal(evolved.evolutionStage, 1);
        assert.equal(evolved.hp, 350);                     // 300 + 50
        assert.equal(evolved.attack, 54);                  // 46 + 8
        assert.equal(evolved.defense, 30);                 // 24 + 6
        assert.equal(evolved.speed, 38);                   // 32 + 6
        assert.equal(evolved.moveRange, 3);                // +0 at rare
        assert.deepEqual(evolved.jutsus, base.jutsus);     // kit unchanged
    });

    it('applies the rare→legendary delta and bumps moveRange', () => {
        const rare = fireStarter({ rarity: 'rare', evolutionStage: 1, level: 90, hp: 800, attack: 120, defense: 90, speed: 100, moveRange: 3 });
        const evolved = evolvePet(rare, 2, evolutionLineFor('starter-fire')!);
        assert.equal(evolved.rarity, 'legendary');
        assert.equal(evolved.name, 'Inferno Fenrir');
        assert.equal(evolved.evolutionStage, 2);
        assert.equal(evolved.hp, 846);                     // 800 + 46
        assert.equal(evolved.attack, 126);                 // 120 + 6
        assert.equal(evolved.moveRange, 4);                // 3 + 1
    });

    it('adds the evolution delta with no cap clamp (HP/ATK/DEF/SPD are uncapped)', () => {
        const maxed = fireStarter({ level: 60, hp: 1700, attack: 260, defense: 210, speed: 190 });
        const evolved = evolvePet(maxed, 1, evolutionLineFor('starter-fire')!);
        assert.equal(evolved.hp, 1750);                    // 1700 + 50
        assert.equal(evolved.attack, 268);                 // 260 + 8
        assert.equal(evolved.defense, 216);                // 210 + 6
        assert.equal(evolved.speed, 196);                  // 190 + 6
        // A stat that would have blown past the OLD rare cap (240) is no longer
        // clamped — training/evolution stats add freely now.
        const overDef = fireStarter({ level: 60, defense: 238 });
        const e2 = evolvePet(overDef, 1, evolutionLineFor('starter-fire')!);
        assert.equal(e2.defense, 244);                     // 238 + 6, uncapped
    });
});
