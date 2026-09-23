import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCharacterSave } from './[name].js';
import { bloodlinePoints } from '../_jutsu-points.js';
import { versionedPlayerRecord } from './_mutate-player-save.js';

type Save = Record<string, unknown>;

const mkBloodline = (id = 'bl-forged', rank = 'S Rank') => ({
    id, name: 'Forged', rank, totalPoints: 99,
    // 5 jutsu x {Copy 3, Mirror 3, Stun 2} = 40 points.
    jutsus: Array.from({ length: 5 }, (_, i) => ({
        id: `${id}-${i}`, name: 'X', type: 'Ninjutsu', ap: 60, range: 4, effectPower: 50, cooldown: 7,
        tags: [{ name: 'Copy' }, { name: 'Mirror' }, { name: 'Stun' }],
    })),
});

const incoming = (bloodlines: unknown[], extra: Save = {}): Save => ({
    character: { name: 'Tester', level: 50 },
    savedBloodlines: bloodlines,
    ...extra,
});

const stored = (bloodlines: unknown[] = [], pendingBloodlineForges: unknown[] = []): Save => ({
    character: { name: 'Tester', level: 50 },
    savedBloodlines: bloodlines,
    pendingBloodlineForges,
});

const entitlement = (rank: 'B Rank' | 'A Rank' | 'S Rank', id = '12345678-1234-1234-1234-123456789abc') => ({
    id, rank, issuedAt: 1_750_000_000_000,
});

test('new bloodline without a server forge entitlement is discarded', () => {
    const out = sanitizeCharacterSave(incoming([mkBloodline()]), stored());
    assert.deepEqual(out.savedBloodlines, []);
});

test('an unentitled replacement cannot erase an existing bloodline', () => {
    const existing = mkBloodline('bl-existing', 'A Rank');
    const out = sanitizeCharacterSave(
        incoming([mkBloodline('bl-unpaid-replacement', 'A Rank')]),
        stored([existing]),
    );
    assert.deepEqual(
        (out.savedBloodlines as Array<Record<string, unknown>>).map((bloodline) => bloodline.id),
        ['bl-existing'],
    );
});

test('a stale empty roster cannot erase a forged bloodline after ranked settlement', () => {
    const current = mkBloodline('bl-current', 'A Rank');
    const existing = stored([current]);
    existing.character = { name: 'Tester', level: 50, equippedBloodlineId: current.id };
    const ranked = versionedPlayerRecord(existing, { ...(existing.character as Record<string, unknown>), rankedRating: 1012 }).record;
    const out = sanitizeCharacterSave(
        incoming([], { character: { name: 'Tester', level: 50, equippedBloodlineId: 'bl-old' } }),
        ranked,
    );
    assert.deepEqual((out.savedBloodlines as Array<Record<string, unknown>>).map((bloodline) => bloodline.id), [current.id]);
    assert.equal((out.character as Record<string, unknown>).equippedBloodlineId, current.id);
});

test('a stale subset cannot remove an owned bloodline or reset the equipped custom slot', () => {
    const older = mkBloodline('bl-older', 'B Rank');
    const current = mkBloodline('bl-current', 'A Rank');
    const existing = stored([current, older]);
    existing.character = { name: 'Tester', level: 50, equippedBloodlineId: current.id };
    const out = sanitizeCharacterSave(
        incoming([older], { character: { name: 'Tester', level: 50, equippedBloodlineId: older.id } }),
        existing,
    );
    assert.deepEqual((out.savedBloodlines as Array<Record<string, unknown>>).map((bloodline) => bloodline.id), [older.id, current.id]);
    assert.equal((out.character as Record<string, unknown>).equippedBloodlineId, current.id);
});

test('a stale full save cannot replace a refined bloodline definition with an older copy', () => {
    const refined = { ...mkBloodline('bl-current', 'A Rank'), name: 'Refined' };
    const stale = { ...refined, name: 'Old name' };
    const out = sanitizeCharacterSave(incoming([stale]), stored([refined]));
    assert.equal((out.savedBloodlines as Array<Record<string, unknown>>)[0].name, 'Refined');
});

test('a maker write may refine an owned bloodline definition', () => {
    const old = { ...mkBloodline('bl-current', 'A Rank'), name: 'Old name' };
    const refined = { ...old, name: 'Refined' };
    const out = sanitizeCharacterSave(incoming([refined]), stored([old]), { bloodlineWriteIntent: old.id });
    assert.equal((out.savedBloodlines as Array<Record<string, unknown>>)[0].name, 'Refined');
});

test('a first save retains a built-in equipped bloodline', () => {
    const id = 'starter-bloodline-ashen-eyes';
    const out = sanitizeCharacterSave(incoming([], { character: { name: 'Tester', level: 1, equippedBloodlineId: id } }), null);
    assert.equal((out.character as Record<string, unknown>).equippedBloodlineId, id);
});

test('an explicit owned-bloodline swap survives the ordinary save boundary', () => {
    const older = mkBloodline('bl-older', 'B Rank');
    const current = mkBloodline('bl-current', 'A Rank');
    const existing = stored([current, older]);
    existing.character = { name: 'Tester', level: 50, equippedBloodlineId: current.id };
    const out = sanitizeCharacterSave(
        incoming([current, older], { character: { name: 'Tester', level: 50, equippedBloodlineId: older.id } }),
        existing,
        { bloodlineEquipIntent: older.id },
    );
    assert.equal((out.character as Record<string, unknown>).equippedBloodlineId, older.id);
});

test('incoming payload cannot forge its own pending entitlement', () => {
    const forged = entitlement('S Rank');
    const out = sanitizeCharacterSave(incoming([mkBloodline()], { pendingBloodlineForges: [forged] }), stored());
    assert.deepEqual(out.savedBloodlines, []);
    assert.deepEqual(out.pendingBloodlineForges, []);
});

test('exact-rank server entitlement accepts one new bloodline, consumes purchase, and applies point budget', () => {
    const out = sanitizeCharacterSave(incoming([mkBloodline('bl-paid', 'S Rank')]), stored([], [entitlement('S Rank')]),
        { bloodlineWriteIntent: 'bl-paid' });
    const bloodlines = out.savedBloodlines as Array<Record<string, any>>;
    assert.equal(bloodlines.length, 1);
    assert.equal(bloodlines[0].rank, 'S Rank');
    assert.ok(bloodlinePoints(bloodlines[0].jutsus, 'S Rank') <= 11);
    assert.deepEqual(out.pendingBloodlineForges, []);
});

test('an autosave cannot spend a pending forge on a stale local bloodline draft', () => {
    const pending = entitlement('A Rank');
    const out = sanitizeCharacterSave(incoming([mkBloodline('bl-stale-draft', 'A Rank')]), stored([], [pending]));
    assert.deepEqual(out.savedBloodlines, []);
    assert.deepEqual(out.pendingBloodlineForges, [pending]);
});

test('a paid replacement equips the new bloodline while retiring the old slot', () => {
    const old = mkBloodline('bl-old', 'B Rank');
    const next = mkBloodline('bl-new', 'A Rank');
    const existing = stored([old], [entitlement('A Rank')]);
    existing.character = { name: 'Tester', level: 50, equippedBloodlineId: old.id };
    const out = sanitizeCharacterSave(
        incoming([next], { character: { name: 'Tester', level: 50, equippedBloodlineId: next.id } }),
        existing,
        { bloodlineWriteIntent: next.id },
    );
    assert.deepEqual((out.savedBloodlines as Array<Record<string, unknown>>).map((bloodline) => bloodline.id), [next.id]);
    assert.equal((out.character as Record<string, unknown>).equippedBloodlineId, next.id);
    assert.deepEqual(out.pendingBloodlineForges, []);
});

test('forge entitlement is rank-specific and remains pending after a mismatched attempt', () => {
    const pending = entitlement('A Rank');
    const out = sanitizeCharacterSave(incoming([mkBloodline('bl-wrong-rank', 'S Rank')]), stored([], [pending]),
        { bloodlineWriteIntent: 'bl-wrong-rank' });
    assert.deepEqual(out.savedBloodlines, []);
    assert.deepEqual(out.pendingBloodlineForges, [pending]);
});

test('existing A-rank id is grandfathered but cannot self-promote to S', () => {
    const existing = mkBloodline('bl-existing', 'A Rank');
    const out = sanitizeCharacterSave(incoming([mkBloodline('bl-existing', 'S Rank')]), stored([existing]),
        { bloodlineWriteIntent: 'bl-existing' });
    const bloodline = (out.savedBloodlines as Array<Record<string, any>>)[0];
    assert.equal(bloodline.rank, 'A Rank');
    assert.ok(bloodlinePoints(bloodline.jutsus, 'A Rank') <= 10);
});

test('one entitlement cannot authorize two new bloodline ids', () => {
    const out = sanitizeCharacterSave(
        incoming([mkBloodline('bl-one', 'B Rank'), mkBloodline('bl-two', 'B Rank')]),
        stored([], [entitlement('B Rank')]),
        { bloodlineWriteIntent: 'bl-one' },
    );
    assert.deepEqual((out.savedBloodlines as Array<Record<string, unknown>>).map((bl) => bl.id), ['bl-one']);
    assert.deepEqual(out.pendingBloodlineForges, []);
});
