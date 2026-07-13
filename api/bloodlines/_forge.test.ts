import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBloodlineForgePurchase, readPendingBloodlineForges } from './_forge.js';

const id = '12345678-1234-1234-1234-123456789abc';

test('forge purchase debits the rank-specific authoritative material and seals an entitlement', () => {
    const result = applyBloodlineForgePurchase({ auraStones: 140, mythicSeals: 999 }, [], 'A Rank', id, 12345);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.character.auraStones, 40);
    assert.equal(result.character.mythicSeals, 999);
    assert.deepEqual(result.entitlement, { id, rank: 'A Rank', issuedAt: 12345 });
    assert.deepEqual(result.pending, [result.entitlement]);
});

test('forge purchase fails closed on insufficient balance or invalid rank', () => {
    assert.deepEqual(
        applyBloodlineForgePurchase({ mythicSeals: 99 }, [], 'S Rank', id, 12345),
        { ok: false, status: 409, error: 'Not enough mythicSeals.' },
    );
    assert.deepEqual(
        applyBloodlineForgePurchase({ mythicSeals: 999 }, [], 'SS Rank', id, 12345),
        { ok: false, status: 400, error: 'Invalid bloodline rank.' },
    );
});

test('pending forge parser strips malformed, duplicate, and excess entries', () => {
    const entries = Array.from({ length: 5 }, (_, index) => ({
        id: `12345678-1234-1234-1234-123456789ab${index}`,
        rank: 'B Rank',
        issuedAt: index + 1,
    }));
    const parsed = readPendingBloodlineForges([entries[0], entries[0], { id: 'bad', rank: 'S Rank', issuedAt: 1 }, ...entries.slice(1)]);
    assert.equal(parsed.length, 3);
    assert.equal(new Set(parsed.map((entry) => entry.id)).size, 3);
});
