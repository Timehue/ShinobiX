import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { buildPetCatalog } from './pet-catalog-gen.mjs';
const require = createRequire(import.meta.url);
const { PET_CATALOG } = require('../api/pet/_catalog.ts');

describe('pet catalog parity', () => {
    it('matches the balanced client wild-pet pool', () => assert.deepEqual(PET_CATALOG, buildPetCatalog()));
    it('ships Celestial Lion as a Wind Mythic with Wind status and signature', () => {
        const lion = PET_CATALOG['mythic-15'];
        assert.equal(lion.name, 'Celestial Lion');
        assert.equal(lion.element, 'Wind');
        assert.equal(lion.rarity, 'mythic');
        assert.equal(lion.wildSpawnable, true);
        assert.deepEqual(lion.jutsus.slice(5).map((move) => [move.name, move.kind]), [
            ["Heaven's Vortex", 'confuse'],
            ["Celestial Tempest: Lion's Descent", 'crush'],
            ['Gale Challenge', 'taunt'],
        ]);
    });
    it('contains the complete rarity distribution', () => {
        const pets = Object.values(PET_CATALOG);
        assert.equal(pets.length, 161);
        assert.deepEqual(Object.fromEntries(['standard','rare','legendary','mythic'].map((r) => [r, pets.filter((p) => p.rarity === r).length])), { standard: 55, rare: 55, legendary: 35, mythic: 16 });
        const wild = pets.filter((pet) => pet.wildSpawnable !== false);
        assert.equal(wild.length, 141);
        assert.deepEqual(Object.fromEntries(['standard','rare','legendary','mythic'].map((r) => [r, wild.filter((p) => p.rarity === r).length])), { standard: 50, rare: 50, legendary: 30, mythic: 11 });
        assert.equal(pets.filter((pet) => pet.wildSpawnable === false && pet.breedable === false).length, 15);
    });
});
