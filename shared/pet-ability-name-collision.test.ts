import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePetAbilityProgression, type AuthoredPetAbility, type PetAbilityTier } from './pet-ability-progression.js';

const strike = { id: 'saved-strike', name: 'Final Bite', power: 70, kind: 'damage', signature: true,
    cooldown: 3, currentCooldown: 2, rounds: 2, cost: 18, element: 'water', priority: 1 };
const fixtures: { label: string; moves: AuthoredPetAbility[]; tiers: PetAbilityTier[]; names: string[]; sources: number[] }[] = [
    { label: 'one signature in three slots', moves: [strike], tiers: ['basic', 'advanced', 'signature'],
        names: ['Final Bite', 'Greater Final Bite', 'Greater Final Bite 2'], sources: [0, 0, 0] },
    ...['mark', 'slow'].map(kind => ({ label: 'powered ' + kind + ' in three slots',
        moves: [{ ...strike, name: 'Pressure', kind, signature: false }],
        tiers: ['basic', 'utility', 'advanced'] as PetAbilityTier[],
        names: ['Pressure', 'Greater Pressure', 'Greater Pressure 2'], sources: [0, 0, 0] })),
    { label: 'numbered fallback already taken',
        moves: [{ ...strike, name: 'Bite', signature: false },
            { id: 'saved-heal', name: 'Greater Bite 2', kind: 'heal', power: 20 }, { ...strike, name: 'Bite' }],
        tiers: ['basic', 'utility', 'advanced', 'signature'],
        names: ['Bite', 'Greater Bite 2', 'Greater Bite', 'Greater Bite 3'], sources: [0, 1, 0, 2] },
    { label: 'authored Greater name already taken',
        moves: [{ ...strike, name: 'Bite', signature: false }, { id: 'saved-heal', name: 'Greater Bite', kind: 'heal', power: 20, cooldown: 5 }],
        tiers: ['basic', 'utility', 'advanced'], names: ['Bite', 'Greater Bite', 'Greater Bite 2'], sources: [0, 1, 0] },
];

for (const fixture of fixtures) test('legacy labels stay distinct: ' + fixture.label, () => {
    const saved = structuredClone(fixture.moves);
    const moves = Object.freeze(fixture.moves.map(move => Object.freeze({ ...move })));
    for (const level of [1, 4, 5, 9, 10, 19, 20, 29, 30, 49, 50, 74, 75, 100]) {
        const result = resolvePetAbilityProgression({ level, abilities: moves });
        const slots = result.allAbilities.filter(move => !move.upgrade);
        assert.deepEqual(slots.map(move => move.name), fixture.names);
        assert.deepEqual(slots.map(move => move.tier), fixture.tiers);
        assert.equal(new Set(result.abilities.map(move => move.name)).size, result.abilities.length);
        assert.deepEqual(result, resolvePetAbilityProgression({ level, abilities: [...moves].reverse() }));
        for (const ability of result.allAbilities) {
            const index = fixture.tiers.indexOf(ability.tier);
            const source = moves[fixture.sources[index]];
            assert.equal(ability.name, fixture.names[index]);
            assert.equal(ability.cooldownKey, ability.name === source.name ? undefined : source.name);
            const { name: _name, cooldownKey: _key, ...contract } = ability;
            const { name: _sourceName, ...authored } = source;
            assert.deepEqual(contract, {
                ...authored,
                abilityId: 'legacy:' + ability.tier + ':' + ability.tier + (ability.upgrade ? ':mastery-' + ability.unlockLevel : ''),
                baseAbilityId: 'legacy:' + ability.tier, unlockLevel: ability.unlockLevel, tier: ability.tier, upgrade: ability.upgrade,
                signature: ability.tier === 'signature', restrained: ability.tier === 'basic',
            });
        }
    }
    assert.deepEqual(moves, saved, 'stored/authored moves are never rewritten');
});
