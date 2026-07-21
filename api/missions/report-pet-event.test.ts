import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearStuckExpeditionLease } from './report-pet-event.js';

const petWith = (id: string, expedition: unknown) => ({ id, name: id, expedition });

test('clearStuckExpeditionLease frees the pet matching the lease token', () => {
    const char = {
        pets: [
            petWith('p1', { token: 'AAA', endsAt: 1 }),
            petWith('p2', { token: 'BBB', endsAt: 2 }),
        ],
    };
    const { pets, cleared } = clearStuckExpeditionLease(char, { token: 'BBB' });
    assert.equal(cleared, true);
    assert.equal((pets[0].expedition as Record<string, unknown>).token, 'AAA'); // untouched
    assert.equal(pets[1].expedition, undefined);                                // freed (=undefined, not deleted)
    assert.ok(Object.prototype.hasOwnProperty.call(pets[1], 'expedition'));      // key present, value undefined
    // input not mutated
    assert.ok((char.pets[1].expedition as Record<string, unknown>).token === 'BBB');
});

test('clearStuckExpeditionLease frees a tokenless legacy lease by petId', () => {
    const char = { pets: [petWith('p1', { endsAt: 5 }), petWith('p2', { endsAt: 6 })] };
    const { pets, cleared } = clearStuckExpeditionLease(char, { petId: 'p1' });
    assert.equal(cleared, true);
    assert.equal(pets[0].expedition, undefined);
    assert.equal((pets[1].expedition as Record<string, unknown>).endsAt, 6);
});

test('clearStuckExpeditionLease is a no-op when nothing matches (double-claim / already cleared)', () => {
    const char = { pets: [petWith('p1', { token: 'AAA' }), petWith('p2', undefined)] };
    // token that no pet owns (lease already cleared) and a petId that has no lease
    const { cleared } = clearStuckExpeditionLease(char, { token: 'GONE', petId: 'p2' });
    assert.equal(cleared, false);
});

test('clearStuckExpeditionLease tolerates a missing/invalid pets array and empty match', () => {
    assert.deepEqual(clearStuckExpeditionLease({}, { token: 'AAA' }), { pets: [], cleared: false });
    assert.equal(clearStuckExpeditionLease({ pets: [petWith('p1', { token: 'AAA' })] }, {}).cleared, false);
});
