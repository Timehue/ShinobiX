import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { buildPetCatalog } from './pet-catalog-gen.mjs';
const require = createRequire(import.meta.url);
const { PET_CATALOG } = require('../api/pet/_catalog.ts');

describe('pet catalog parity', () => {
    it('matches the balanced client wild-pet pool', () => assert.deepEqual(PET_CATALOG, buildPetCatalog()));
    it('contains the complete rarity distribution', () => {
        const pets = Object.values(PET_CATALOG);
        assert.equal(pets.length, 140);
        assert.deepEqual(Object.fromEntries(['standard','rare','legendary','mythic'].map((r) => [r, pets.filter((p) => p.rarity === r).length])), { standard: 50, rare: 50, legendary: 30, mythic: 10 });
    });
});
