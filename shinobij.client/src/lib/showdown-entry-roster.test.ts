import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pet } from '../types/pet';
import type { ShowdownStateView } from '../../../shared/pet-showdown-contract';
import { adoptShowdownEntrySnapshot, showdownEntryRoster } from './showdown-entry-roster';

test('paid recovery follows the sealed roster and reserves rather than new lobby selection', () => {
    const sealed = { player: [{ id: 'original-active' }, { id: 'original-reserve', benched: true }] } as ShowdownStateView;
    const owned = [{ id: 'new-lobby-choice' }, { id: 'original-reserve' }, { id: 'original-active' }] as Pet[];
    const entry = showdownEntryRoster(sealed, owned);
    assert.deepEqual(entry.petIds, ['original-active', 'original-reserve']);
    assert.deepEqual(entry.pets.map(pet => pet.id), entry.petIds);
});

test('a missing current owned pet does not remove its sealed resume identity', () => {
    const sealed = { player: [{ id: 'sealed-pet' }] } as ShowdownStateView;
    const entry = showdownEntryRoster(sealed, []);
    assert.deepEqual(entry.petIds, ['sealed-pet']);
    assert.deepEqual(entry.pets, []);
});

test('admission spends commit through the authoritative version gate exactly once', () => {
    const character = { name: 'Rin', pets: [{ id: 'owned', loadout: {} }] };
    const calls: unknown[] = [];
    assert.equal(adoptShowdownEntrySnapshot({ character, saveVersion: 8 }, (next, version) => { calls.push({ next, version }); return true; }), true);
    assert.deepEqual(calls, [{ next: character, version: 8 }]);
    assert.equal(adoptShowdownEntrySnapshot({ character, saveVersion: 7 }, () => false), false);
});

test('old or incomplete admission responses do not bypass the version gate', () => {
    let calls = 0;
    const commit = () => { calls++; return true; };
    assert.equal(adoptShowdownEntrySnapshot({}, commit), false);
    assert.equal(adoptShowdownEntrySnapshot({ character: {}, saveVersion: NaN }, commit), false);
    assert.equal(adoptShowdownEntrySnapshot({ character: {} }, commit), false);
    assert.equal(adoptShowdownEntrySnapshot({ saveVersion: 1 }, commit), false);
    assert.equal(calls, 0);
});
