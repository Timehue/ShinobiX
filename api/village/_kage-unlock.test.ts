import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyKageUnlock, type KageUnlockState } from './_kage-unlock.js';

const NOW = 1_752_000_000_000;

describe('applyKageUnlock — first clear seats, later clears never do', () => {
    it('first verified clear unlocks, seats, and brands firstLiberator', () => {
        const { next, freshUnlock } = applyKageUnlock({ kageSystemUnlocked: false }, 'FirstHero', NOW);
        assert.equal(freshUnlock, true);
        assert.equal(next.kageSystemUnlocked, true);
        assert.equal(next.seatedKage, 'FirstHero');
        assert.equal(next.firstLiberator, 'FirstHero');
        assert.equal(next.unlockedAt, NOW);
    });

    it('a second clear changes nothing: seat and firstLiberator stay with the first', () => {
        const first = applyKageUnlock({ kageSystemUnlocked: false }, 'FirstHero', NOW).next;
        const { next, freshUnlock } = applyKageUnlock(first, 'SecondHero', NOW + 1000);
        assert.equal(freshUnlock, false);
        assert.deepEqual(next, first);
        assert.equal(next.seatedKage, 'FirstHero');
        assert.equal(next.firstLiberator, 'FirstHero');
    });

    it('a later clear never reseats even after the seat changed hands via challenges', () => {
        const contested: KageUnlockState = {
            kageSystemUnlocked: true,
            seatedKage: 'CurrentChampion',
            firstLiberator: 'FirstHero',
            unlockedAt: NOW - 86_400_000,
        };
        const { next, freshUnlock } = applyKageUnlock(contested, 'ThirdHero', NOW);
        assert.equal(freshUnlock, false);
        assert.equal(next.seatedKage, 'CurrentChampion', 'story clears must never override the challenge system');
        assert.equal(next.firstLiberator, 'FirstHero');
    });

    it('an admin reset re-seals the village and the next clear seats fresh', () => {
        const resealed: KageUnlockState = { kageSystemUnlocked: false };
        const { next, freshUnlock } = applyKageUnlock(resealed, 'NewEraHero', NOW);
        assert.equal(freshUnlock, true);
        assert.equal(next.firstLiberator, 'NewEraHero');
    });
});
