import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCharacterSave } from './[name].js';
import { bloodlinePoints } from '../_jutsu-points.js';

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

test('incoming payload cannot forge its own pending entitlement', () => {
    const forged = entitlement('S Rank');
    const out = sanitizeCharacterSave(incoming([mkBloodline()], { pendingBloodlineForges: [forged] }), stored());
    assert.deepEqual(out.savedBloodlines, []);
    assert.deepEqual(out.pendingBloodlineForges, []);
});

test('exact-rank server entitlement accepts one new bloodline, consumes purchase, and applies point budget', () => {
    const out = sanitizeCharacterSave(incoming([mkBloodline('bl-paid', 'S Rank')]), stored([], [entitlement('S Rank')]));
    const bloodlines = out.savedBloodlines as Array<Record<string, any>>;
    assert.equal(bloodlines.length, 1);
    assert.equal(bloodlines[0].rank, 'S Rank');
    assert.ok(bloodlinePoints(bloodlines[0].jutsus, 'S Rank') <= 11);
    assert.deepEqual(out.pendingBloodlineForges, []);
});

test('forge entitlement is rank-specific and remains pending after a mismatched attempt', () => {
    const pending = entitlement('A Rank');
    const out = sanitizeCharacterSave(incoming([mkBloodline('bl-wrong-rank', 'S Rank')]), stored([], [pending]));
    assert.deepEqual(out.savedBloodlines, []);
    assert.deepEqual(out.pendingBloodlineForges, [pending]);
});

test('existing A-rank id is grandfathered but cannot self-promote to S', () => {
    const existing = mkBloodline('bl-existing', 'A Rank');
    const out = sanitizeCharacterSave(incoming([mkBloodline('bl-existing', 'S Rank')]), stored([existing]));
    const bloodline = (out.savedBloodlines as Array<Record<string, any>>)[0];
    assert.equal(bloodline.rank, 'A Rank');
    assert.ok(bloodlinePoints(bloodline.jutsus, 'A Rank') <= 10);
});

test('one entitlement cannot authorize two new bloodline ids', () => {
    const out = sanitizeCharacterSave(
        incoming([mkBloodline('bl-one', 'B Rank'), mkBloodline('bl-two', 'B Rank')]),
        stored([], [entitlement('B Rank')]),
    );
    assert.deepEqual((out.savedBloodlines as Array<Record<string, unknown>>).map((bl) => bl.id), ['bl-one']);
    assert.deepEqual(out.pendingBloodlineForges, []);
});
