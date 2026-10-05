import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WANDERER_ARCHETYPES } from './wanderer-roster.js';
import {
    WANDERER_BEAST_SUFFIX,
    wandererBeastName,
    wandererBeastRival,
    wandererBeastSpecies,
} from './wanderer-beast.js';

/*
 * The road beast used to wear a name from a fixed list ("Stray Oni-Hound") and
 * one fox portrait, while the fight drew a random team. These pin the shared
 * rule that now ties the two together, and the properties that let the client
 * and server agree on it without talking.
 */

const kit = [{ name: 'Fang', power: 40, kind: 'damage' }];
const CATALOG = [
    { id: 'standard-1', name: 'Snow Rabbit', rarity: 'standard', jutsus: kit },
    { id: 'standard-6', name: 'Desert Lizard', rarity: 'standard', jutsus: kit },
    { id: 'standard-9', name: 'Wild Boar', rarity: 'standard', jutsus: kit },
    { id: 'standard-x', name: 'Locked Starter', rarity: 'standard', jutsus: kit, wildSpawnable: false },
    { id: 'standard-y', name: 'Kitless', rarity: 'standard' },
    { id: 'rare-3', name: 'Sky Falcon', rarity: 'rare', jutsus: kit },
    { id: 'rare-7', name: 'Ashwing Raven', rarity: 'rare', jutsus: kit },
    { id: 'mythic-4', name: 'Abyssal Oni Hound', rarity: 'mythic', jutsus: kit },
];
const PETS = ['p-1', 'p-2', 'p-3', 'p-4'].map((id) => ({ id, rarity: 'standard' }));
const IDS = Array.from({ length: 40 }, (_, i) => `w-${1 + (i % 9)}-20000-${i % 2}`);

test('every natural beast name is species-neutral and takes the suffix', () => {
    for (const name of WANDERER_ARCHETYPES.beast.names) {
        assert.ok(name.endsWith(WANDERER_BEAST_SUFFIX), `${name} must end in "${WANDERER_BEAST_SUFFIX}"`);
        assert.doesNotMatch(name, /hound|lynx|crow|hawk/i, `${name} must not promise a species`);
    }
});

test('the beast name swaps "Beast" for the species', () => {
    assert.equal(wandererBeastName('Stray Beast', 'Desert Lizard'), 'Stray Desert Lizard');
    assert.equal(wandererBeastName('Lone Beast', 'Abyssal Oni Hound'), 'Lone Abyssal Oni Hound');
    // A name without the suffix keeps only its first word.
    assert.equal(wandererBeastName('Feral Stormcrow', 'Sky Falcon'), 'Feral Sky Falcon');
});

test('the rival does not depend on roster order', () => {
    for (const id of IDS) {
        const forward = wandererBeastRival(id, PETS);
        const reversed = wandererBeastRival(id, [...PETS].reverse());
        assert.equal(forward?.id, reversed?.id, id);
    }
});

test('the rival only moves when the rival itself leaves', () => {
    for (const id of IDS) {
        const rival = wandererBeastRival(id, PETS)!;
        for (const other of PETS.filter((pet) => pet.id !== rival.id)) {
            const without = PETS.filter((pet) => pet.id !== other.id);
            assert.equal(wandererBeastRival(id, without)?.id, rival.id, `${id} reshuffled when ${other.id} left`);
        }
    }
});

test('different beasts pick out different pets', () => {
    const picked = new Set(IDS.map((id) => wandererBeastRival(id, PETS)?.id));
    assert.ok(picked.size > 1, 'every beast locked onto the same pet');
});

test('no ready pet means no rival', () => {
    assert.equal(wandererBeastRival('w-1-20000-0', []), null);
});

test('the species is a wild, kitted pet of exactly the rival rarity', () => {
    for (const id of IDS) {
        for (const rarity of ['standard', 'rare', 'mythic']) {
            const species = wandererBeastSpecies(id, rarity, CATALOG);
            assert.ok(species, `${id} found no ${rarity} species`);
            assert.equal(species.rarity, rarity);
            assert.notEqual(species.wildSpawnable, false);
            assert.ok(Array.isArray(species.jutsus));
        }
    }
});

test('a missing rarity reads as standard, as the server draw does', () => {
    for (const id of IDS) {
        assert.equal(wandererBeastSpecies(id, undefined, CATALOG)?.id, wandererBeastSpecies(id, 'standard', CATALOG)?.id);
    }
});

test('the species does not depend on catalog order', () => {
    for (const id of IDS) {
        assert.equal(
            wandererBeastSpecies(id, 'standard', CATALOG)?.id,
            wandererBeastSpecies(id, 'standard', [...CATALOG].reverse())?.id,
        );
    }
});

test('a rarity with no wild pets has no species', () => {
    assert.equal(wandererBeastSpecies('w-1-20000-0', 'legendary', CATALOG), null);
});
