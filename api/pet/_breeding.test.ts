import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PET_CATALOG } from './_catalog.js';
import { alternateSpeciesPool, buildSealedBreedingResult, breedingOddsForParents, deterministicBreedingSessionId, publicPetBreedingSession, rollChromatic, selectOffspringTemplate } from './_breeding.js';

const parent1 = { ...PET_CATALOG['standard-0'], id: 'p1', templateId: 'standard-0' };
const parent2 = { ...PET_CATALOG['standard-6'], id: 'p2', templateId: 'standard-6' };
const first = (min: number) => min;

describe('sealed pet breeding outcome table', () => {
    it('uses exact 45/45/9/1 species boundaries without rerolling the table', () => {
        assert.equal(selectOffspringTemplate(parent1, parent2, 0, first).outcome, 'parent1');
        assert.equal(selectOffspringTemplate(parent1, parent2, 4_499, first).outcome, 'parent1');
        assert.equal(selectOffspringTemplate(parent1, parent2, 4_500, first).outcome, 'parent2');
        assert.equal(selectOffspringTemplate(parent1, parent2, 8_999, first).outcome, 'parent2');
        assert.equal(selectOffspringTemplate(parent1, parent2, 9_000, first).outcome, 'sameElementTier');
        assert.equal(selectOffspringTemplate(parent1, parent2, 9_899, first).outcome, 'sameElementTier');
        assert.equal(selectOffspringTemplate(parent1, parent2, 9_900, first).outcome, 'randomNonStandard');
        assert.equal(selectOffspringTemplate(parent1, parent2, 9_999, first).outcome, 'randomNonStandard');
    });

    it('rolls Chromatic independently at exactly one result in 2,000', () => {
        assert.equal(rollChromatic(0), true);
        for (const roll of [1, 2, 1_000, 1_999]) assert.equal(rollChromatic(roll), false);
    });

    it('seals the private apex/ordinary trait with species and palette at breeding start', () => {
        const rolls = [0, 1, 0, 2]; // parent 1, non-Chromatic, apex success, Boonbringer
        const secureInt = (min: number, max: number) => {
            const value = rolls.shift();
            assert.notEqual(value, undefined);
            assert.ok(value! >= min && value! < max);
            return value!;
        };
        const sealed = buildSealedBreedingResult({ playerName: 'Player', requestId: 'request-1234567890', parent1, parent2, now: 123, secureInt });
        assert.equal(sealed.trait, 'Boonbringer');
        assert.equal(sealed.createdAt, 123);
        assert.equal(rolls.length, 0);
    });

    it('reports the authoritative pool-aware odds and hides the request receipt', () => {
        assert.deepEqual(breedingOddsForParents(parent1, parent2), { parent1: 45, parent2: 45, alternate: 9, randomNonStandard: 1, chromatic: 0.05, apexTrait: 0.5 });
        const session = { sessionId: 'breed-a', state: 'breeding' as const, parentIds: ['p1', 'p2'] as [string, string], parentNames: ['One', 'Two'] as [string, string], parentElement: 'Fire', startedAt: 1, readyAt: 2, rulesVersion: 1, startRequestId: 'private' };
        assert.equal('startRequestId' in publicPetBreedingSession(session)!, false);
        assert.equal(deterministicBreedingSessionId('Player', 'request-1234567890'), deterministicBreedingSessionId('player', 'request-1234567890'));
    });

    it('keeps the 9% alternate branch available for every same-element mythic pair', () => {
        const mythicsByElement = new Map<string, Record<string, unknown>[]>();
        for (const pet of Object.values(PET_CATALOG)) {
            if (pet.rarity !== 'mythic' || typeof pet.element !== 'string') continue;
            const list = mythicsByElement.get(pet.element) ?? [];
            list.push(pet);
            mythicsByElement.set(pet.element, list);
        }
        assert.deepEqual([...mythicsByElement.keys()].sort(), ['Earth', 'Fire', 'Lightning', 'Water', 'Wind']);
        for (const [element, pair] of mythicsByElement) {
            assert.ok(pair.length >= 2, `${element} needs at least two active mythics`);
            const [firstParent, secondParent] = pair;
            const pool = alternateSpeciesPool(firstParent, secondParent, 'mythic');
            assert.ok(pool.length >= 1, `${element} same-element mythic pair has no 9% candidate`);
            assert.ok(!pool.includes(String(firstParent.id)) && !pool.includes(String(secondParent.id)));
            assert.deepEqual(breedingOddsForParents(firstParent, secondParent), {
                parent1: 45, parent2: 45, alternate: 9, randomNonStandard: 1, chromatic: 0.05, apexTrait: 0.5,
            });
        }
    });
});
