import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOODLINE_FORGE_COSTS, applyBloodlineForgePurchase, readPendingBloodlineForges } from './_forge.js';
import { BLOODLINE_FORGE_COSTS as SHARED_FORGE_COSTS } from '../../shared/bloodline-forge-costs.js';

const id = '12345678-1234-1234-1234-123456789abc';

test('forge purchase debits the rank-specific authoritative material and seals an entitlement', () => {
    const result = applyBloodlineForgePurchase({ auraStones: 140, mythicSeals: 999 }, [], 'A Rank', id, 12345);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.character.auraStones, 40);
    assert.equal(result.character.mythicSeals, 999);
    assert.deepEqual(result.entitlement, { id, rank: 'A Rank', issuedAt: 12345 });
    assert.deepEqual(result.pending, [result.entitlement]);
    assert.equal(result.resumed, false);
});

test('a pending paid forge resumes after refresh without another material debit', () => {
    const first = applyBloodlineForgePurchase({ auraStones: 140 }, [], 'A Rank', id, 12345);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const resumed = applyBloodlineForgePurchase(first.character, first.pending, 'A Rank',
        '12345678-1234-1234-1234-123456789abd', 12346);
    assert.equal(resumed.ok, true);
    if (!resumed.ok) return;
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.cost, 0);
    assert.equal(resumed.balance, 40);
    assert.equal(resumed.character.auraStones, 40);
    assert.deepEqual(resumed.pending, first.pending);
    assert.deepEqual(resumed.entitlement, first.entitlement);
});

test('resume-only cannot start or charge for a new ritual', () => {
    assert.deepEqual(
        applyBloodlineForgePurchase({ auraStones: 140 }, [], 'A Rank', id, 12345, true),
        { ok: false, status: 409, error: 'No paid Bloodline Awakening is pending for this rank.' },
    );
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

test('B Rank costs 200 Bone Charms (2026-10 rebalance); A and S stay at 100', () => {
    assert.equal(BLOODLINE_FORGE_COSTS['B Rank'].cost, 200);
    assert.equal(BLOODLINE_FORGE_COSTS['B Rank'].currency, 'boneCharms');
    assert.equal(BLOODLINE_FORGE_COSTS['A Rank'].cost, 100);
    assert.equal(BLOODLINE_FORGE_COSTS['S Rank'].cost, 100);
    // The route's table is the shared one the Awakening Stone screen quotes.
    assert.equal(BLOODLINE_FORGE_COSTS, SHARED_FORGE_COSTS);
});

test('B Rank refuses 199 Bone Charms without a debit and takes exactly 200', () => {
    const short = { boneCharms: 199 };
    assert.deepEqual(
        applyBloodlineForgePurchase(short, [], 'B Rank', id, 12345),
        { ok: false, status: 409, error: 'Not enough boneCharms.' },
    );
    assert.equal(short.boneCharms, 199);
    const paid = applyBloodlineForgePurchase({ boneCharms: 200 }, [], 'B Rank', id, 12345);
    assert.equal(paid.ok, true);
    if (!paid.ok) return;
    assert.equal(paid.cost, 200);
    assert.equal(paid.balance, 0);
    assert.equal(paid.character.boneCharms, 0);
    assert.equal(paid.pending.length, 1);
});

test('a B entitlement paid before the re-price resumes free, whatever the balance', () => {
    const pending = [{ id, rank: 'B Rank', issuedAt: 12345 }];
    const resumed = applyBloodlineForgePurchase({ boneCharms: 50 }, pending, 'B Rank',
        '12345678-1234-1234-1234-123456789abd', 12346);
    assert.equal(resumed.ok, true);
    if (!resumed.ok) return;
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.cost, 0);
    assert.equal(resumed.balance, 50);
    assert.equal(resumed.character.boneCharms, 50);
});
