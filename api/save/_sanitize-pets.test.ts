import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePetRoster } from './_sanitize-pets.js';

/*
 * I-2 (2026-10 economy rebalance): pet ownership is server-owned. A generic
 * save keeps the pets the server already holds, with their identity fields
 * forced from storage, and can never add one, in either ledger mode.
 */

const forgedPet = (id: string) => ({
    id, name: 'Forged', rarity: 'mythic', trait: 'Boonbringer',
    hp: 100, attack: 100, defense: 100, speed: 100,
    growthBaseStats: { hp: 9999, attack: 9999, defense: 9999, speed: 9999 },
    maxLevel: 100,
});

const storedPet = (id: string) => ({
    id, name: 'Kumo', rarity: 'standard', trait: 'Loyal', level: 12, xp: 40, maxLevel: 100,
    hp: 320, attack: 40, defense: 28, speed: 30, jutsus: [], templateId: 'standard-0',
});

function run(incoming: Record<string, unknown>, stored: Record<string, unknown>, strict: boolean) {
    const char = structuredClone(incoming);
    sanitizePetRoster(char, structuredClone(stored), strict);
    return char;
}

describe('a generic save can never add a pet (I-2)', () => {
    for (const strict of [false, true]) {
        it(`drops every client-defined pet on an empty roster (strict ledger ${strict})`, () => {
            const out = run(
                { pets: [1, 2, 3, 4, 5].map((n) => forgedPet(`forged-${n}`)), activePetId: 'forged-1', activePetId2v2: 'forged-2' },
                { pets: [] },
                strict,
            );
            assert.deepEqual(out.pets, []);
            assert.equal('activePetId' in out, false);
            assert.equal('activePetId2v2' in out, false);
        });
    }

    it('drops a batch of duplicate forged ids', () => {
        const out = run({ pets: [forgedPet('dupe'), forgedPet('dupe'), forgedPet('dupe')] }, { pets: [] }, false);
        assert.deepEqual(out.pets, []);
    });

    it('keeps the stored pets with storage-owned identity and drops a forged newcomer', () => {
        const stored = { pets: [storedPet('pet-1'), storedPet('pet-2')], activePetId: 'pet-1' };
        const out = run({
            pets: [
                { ...storedPet('pet-1'), rarity: 'mythic', trait: 'Boonbringer', level: 100, xp: 999_999 },
                storedPet('pet-2'),
                forgedPet('forged-3'),
            ],
            activePetId: 'pet-1',
        }, stored, false);
        const pets = out.pets as Array<Record<string, unknown>>;
        assert.deepEqual(pets.map((pet) => pet.id), ['pet-1', 'pet-2']);
        assert.equal(pets[0].rarity, 'standard', 'rarity comes from storage');
        assert.equal(pets[0].trait, 'Loyal', 'the trait comes from storage');
        assert.equal(pets[0].level, 12, 'level comes from storage');
        assert.equal(out.activePetId, 'pet-1');
    });
});
