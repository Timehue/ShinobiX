import test from 'node:test';
import assert from 'node:assert/strict';
import { PET_CATALOG } from '../api/pet/_catalog.ts';
import { derivePetGrowthStats } from '../api/pet/_growth.ts';
import { resolvePetAbilityProgression } from '../shared/pet-ability-progression.ts';
import { rawPetPool } from '../shinobij.client/src/data/pet-pool.ts';
import { balanceBuiltInPetTemplate } from '../shinobij.client/src/lib/pet-balance.ts';

const stats = ['hp', 'attack', 'defense', 'speed'] as const;
const tiers = ['standard', 'rare', 'legendary', 'mythic'];
const pool = rawPetPool.map(balanceBuiltInPetTemplate);

test('every adjacent rarity improves each base stat for the same role and sub-role', () => {
    let comparisons = 0;
    for (let tier = 1; tier < tiers.length; tier++) {
        for (const lower of pool.filter(pet => pet.rarity === tiers[tier - 1])) {
            for (const higher of pool.filter(pet => pet.rarity === tiers[tier]
                && pet.role === lower.role && pet.subRole === lower.subRole)) {
                comparisons++;
                for (const stat of stats) assert.ok(higher[stat] > lower[stat],
                    `${higher.id} ${stat} must exceed comparable ${lower.id}`);
                for (const level of [1, 10, 50, 100]) {
                    for (const trait of ['Loyal', 'Aggressive', 'Guardian', 'Swift', 'Lucky', 'Battleborn', 'Fateweaver', 'Hollowborn', 'Boonbringer']) {
                        for (const attribute of ['balanced', 'vitality', 'power', 'guard', 'agility']) {
                            const earned = (level - 1) * 3;
                            const growthAllocation = attribute === 'balanced'
                                ? { vitality: earned - 3 * Math.floor(earned / 4), power: Math.floor(earned / 4), guard: Math.floor(earned / 4), agility: Math.floor(earned / 4) }
                                : { vitality: 0, power: 0, guard: 0, agility: 0, [attribute]: earned };
                            const grown = [lower, higher].map(pet => derivePetGrowthStats({
                                ...pet, level, trait, growthAllocation,
                                growthBaseStats: Object.fromEntries(stats.map(stat => [stat, pet[stat]])),
                            }));
                            for (const stat of stats) assert.ok(grown[1][stat] > grown[0][stat],
                                `${higher.id}/${lower.id} ${stat}, level ${level}, ${trait}, ${attribute}`);
                        }
                    }
                }
            }
        }
    }
    assert.ok(comparisons >= 700, 'cover the full built-in roster, including mythics');
});

test('the pictured legendary deer exceeds the rare badger with their actual traits and levels', () => {
    const grown = [['rare-23', 'Swift', 1], ['legendary-3', 'Battleborn', 3]].map(([id, trait, level]) => {
        const pet = PET_CATALOG[String(id)];
        return derivePetGrowthStats({ ...pet, trait, level, growthBaseStats: pet });
    });
    for (const stat of stats) assert.ok(grown[1][stat] > grown[0][stat], stat);
});

test('species position does not create a growing within-tier stat or attack-power bonus', () => {
    for (const pet of pool) {
        const peers = pool.filter(other => other.rarity === pet.rarity
            && other.role === pet.role && other.subRole === pet.subRole
            && other.jutsus.length === pet.jutsus.length);
        for (const other of peers) for (const stat of stats) {
            assert.ok(Math.abs(pet[stat] - other[stat]) <= Math.ceil(other[stat] * 0.045),
                `${pet.id}/${other.id}: unbounded ${stat} variation`);
        }
    }
    for (const rarity of tiers.slice(0, 3)) {
        const attacks = pool.filter(pet => pet.rarity === rarity).flatMap(pet =>
            pet.jutsus.slice(0, 4).filter(move => move.kind === 'damage').map(move => move.power));
        // Different slot positions can contribute up to five power in these kits.
        assert.ok(Math.max(...attacks) - Math.min(...attacks) <= 9, `${rarity}: unbounded regular attack power`);
    }
});

test('ability fallback powers match the retuned catalog without changing milestone identities', () => {
    for (const pet of Object.values(PET_CATALOG).filter(pet => pet.speciesBalanceVersion === 1)) {
        const input = { templateId: pet.id, level: 100 };
        const fallback = resolvePetAbilityProgression(input).allAbilities;
        const supplied = resolvePetAbilityProgression({ ...input, abilities: pet.jutsus as [] }).allAbilities;
        assert.deepEqual(fallback.map(move => [move.abilityId, move.power]),
            supplied.map(move => [move.abilityId, move.power]), String(pet.id));
    }
});
