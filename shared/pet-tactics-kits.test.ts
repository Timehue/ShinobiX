import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PET_TACTICS_IDENTITIES } from './pet-tactics-catalog.js';
import { PET_TACTICS_FLAVOR_MOVES, PET_TACTICS_KITS, petTacticsElementMove } from './pet-tactics-kits.js';
import { TACTICS_MOVES, TACTICS_ROSTER, tacticsPreset, tacticsSpecies } from './pet-tactics-roster.js';
import { validateTacticsBuild } from './pet-tactics-build.js';
import type { TacticsElement } from './pet-tactics-contract.js';

const authored = new Set(TACTICS_ROSTER.map(species => species.id));
const kitted = PET_TACTICS_IDENTITIES.map(([id]) => id).filter(id => !authored.has(id));
// The generic kit every one of these species had before, by role. A kit may
// only ADD to it, so a ranked build saved against the old pool stays legal.
const GENERIC_TOOLS: Record<string, readonly string[]> = {
    striker: ['open-wound', 'expose', 'rally', 'protect'],
    sentinel: ['open-wound', 'intercept', 'aegis', 'purify'],
    medic: ['undertow', 'mend', 'purify', 'aegis'],
    scout: ['expose', 'rally', 'protect', 'purify'],
    balanced: ['open-wound', 'expose', 'protect', 'rally'],
};

test('every species outside the twelve authored profiles has its own kit, and no other id does', () => {
    assert.equal(kitted.length, 149);
    assert.deepEqual(new Set(Object.keys(PET_TACTICS_KITS)), new Set(kitted));
});

test('kits only add role-appropriate moves that already exist, to the pool each species had', () => {
    for (const id of kitted) {
        const species = tacticsSpecies(id)!;
        const [flavor] = PET_TACTICS_KITS[id];
        const elementMove = petTacticsElementMove(species.element as TacticsElement, species.role);
        assert.ok(PET_TACTICS_FLAVOR_MOVES[species.role]?.includes(flavor), `${id}: ${flavor} is not a ${species.role} flavor move`);
        for (const move of [flavor, elementMove]) assert.ok(TACTICS_MOVES[move], `${id}: unknown move ${move}`);
        const generic = [...species.pool.slice(0, 4), ...GENERIC_TOOLS[species.role]];
        assert.deepEqual(species.pool.slice(0, 8), generic, `${id} lost a move from its old pool`);
        assert.deepEqual(species.pool.slice(8), [elementMove, flavor]);
        assert.equal(new Set(species.pool).size, species.pool.length, `${id} lists a move twice`);
    }
});

test('bound control stays off defenders and healers, and elemental moves stay in their element', () => {
    for (const id of kitted) {
        const species = tacticsSpecies(id)!;
        const added = species.pool.slice(8).map(move => TACTICS_MOVES[move]);
        if (species.role === 'sentinel' || species.role === 'medic') assert.ok(!added.some(move => move.kind === 'stun'), id);
        for (const move of added) {
            if (move.element !== 'None') assert.equal(move.element, species.element, `${id}: ${move.id}`);
        }
    }
});

test('every species signature has its own name and keeps its role kind', () => {
    const names = new Set<string>();
    for (const [id] of PET_TACTICS_IDENTITIES) {
        const species = tacticsSpecies(id)!;
        assert.ok(!names.has(species.signature.name) || authored.has(id), `${id} repeats ${species.signature.name}`);
        names.add(species.signature.name);
        if (!authored.has(id)) {
            const expected = species.role === 'medic' ? 'heal' : species.role === 'sentinel' ? 'shield' : 'damage';
            assert.equal(species.signature.kind, expected, id);
        }
    }
});

test('both presets of every kitted species are legal, and Tactics equips the element move', () => {
    for (const id of kitted) {
        for (const preset of [0, 1]) validateTacticsBuild(tacticsPreset(id, preset));
        const species = tacticsSpecies(id)!;
        assert.ok(tacticsPreset(id, 1).moveIds.includes(species.pool[8]), id);
    }
});
