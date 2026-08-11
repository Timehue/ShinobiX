import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCharacterSave } from './[name].js';
import { bloodlinePoints } from '../_jutsu-points.js';
import { resolveEquippedLoadout } from '../pvp/session.js';

type Save = Record<string, unknown>;

const mkBloodline = (id = 'bl-forged', rank = 'S Rank') => ({
    id, name: 'Forged', rank, totalPoints: 99,
    // 5 jutsu x {Copy 3, Mirror 3, Stun 2} = 40 points.
    jutsus: Array.from({ length: 5 }, (_, i) => ({
        id: `${id}-${i}`, name: 'X', type: 'Ninjutsu', ap: 60, range: 4, effectPower: 50, cooldown: 7,
        tags: [{ name: 'Copy' }, { name: 'Mirror' }, { name: 'Stun' }],
    })),
});

const incoming = (bloodlines: unknown[], extra: Save = {}, character: Save = {}): Save => ({
    character: { name: 'Tester', level: 50, ...character },
    savedBloodlines: bloodlines,
    ...extra,
});

const stored = (bloodlines: unknown[] = [], pendingBloodlineForges: unknown[] = [], character: Save = {}): Save => ({
    character: { name: 'Tester', level: 50, ...character },
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

test('a Base account cannot grow past one active stored bloodline even with another pending forge', () => {
    const existing = mkBloodline('bl-existing', 'S Rank');
    const pending = entitlement('S Rank');
    const out = sanitizeCharacterSave(
        incoming([existing, mkBloodline('bl-cap-bypass', 'S Rank')]),
        stored([existing], [pending], { patreon: { active: false }, equippedBloodlineId: 'bl-existing' }),
    );
    assert.deepEqual((out.savedBloodlines as Array<Record<string, unknown>>).map((bl) => bl.id), ['bl-existing']);
    assert.deepEqual(out.pendingBloodlineForges, [pending], 'cap rejection must not burn the paid forge receipt');
});

test('a Shinobi Supporter can grow from one to two active stored bloodlines', () => {
    const existing = mkBloodline('bl-existing', 'S Rank');
    const out = sanitizeCharacterSave(
        incoming(
            [mkBloodline('bl-supporter-second', 'S Rank'), existing],
            {},
            { equippedBloodlineId: 'bl-supporter-second' },
        ),
        stored(
            [existing],
            [entitlement('S Rank')],
            { patreon: { active: true }, equippedBloodlineId: 'bl-existing' },
        ),
    );
    assert.deepEqual(
        (out.savedBloodlines as Array<Record<string, unknown>>).map((bl) => bl.id),
        ['bl-supporter-second', 'bl-existing'],
    );
    assert.equal((out.character as Record<string, unknown>).equippedBloodlineId, 'bl-supporter-second');
    assert.deepEqual(out.pendingBloodlineForges, []);
});

test('a lapsed second bloodline remains stored but cannot be edited or equipped as overflow', () => {
    const first = { ...mkBloodline('bl-first', 'A Rank'), name: 'Preserved First' };
    const equipped = { ...mkBloodline('bl-equipped', 'A Rank'), name: 'Current Build' };
    const out = sanitizeCharacterSave(
        incoming(
            [{ ...first, name: 'Tampered Overflow' }, equipped],
            {},
            { patreon: { active: true }, equippedBloodlineId: 'bl-first' },
        ),
        stored(
            [first, equipped],
            [],
            { patreon: { active: false }, equippedBloodlineId: 'bl-equipped' },
        ),
    );
    const bloodlines = out.savedBloodlines as Array<Record<string, unknown>>;
    assert.deepEqual(bloodlines.map((bl) => bl.id), ['bl-equipped', 'bl-first']);
    assert.equal(bloodlines[1].name, 'Preserved First', 'overflow edits are ignored in favor of stored ownership data');
    assert.equal((out.character as Record<string, unknown>).equippedBloodlineId, 'bl-equipped');
    assert.equal(bloodlines.length, 2, 'lapse never deletes the second stored bloodline');

    const overflowJutsuId = String((bloodlines[1].jutsus as Array<Record<string, unknown>>)[0].id);
    const resolved = resolveEquippedLoadout(
        { ...(out.character as Record<string, unknown>), equippedJutsuIds: [overflowJutsuId] },
        out,
        {},
    ) as Array<{ id: string }>;
    assert.deepEqual(resolved.map(({ id }) => id), [], 'preserved overflow jutsu cannot enter a PvP seal');
});

test('a paid Base-account replacement preserves pre-existing lapse overflow', () => {
    const active = mkBloodline('bl-old-active', 'S Rank');
    const overflow = { ...mkBloodline('bl-safe-overflow', 'S Rank'), name: 'Safe Overflow' };
    const out = sanitizeCharacterSave(
        incoming(
            [mkBloodline('bl-new-active', 'S Rank')],
            {},
            { equippedBloodlineId: 'bl-new-active' },
        ),
        stored(
            [active, overflow],
            [entitlement('S Rank')],
            { patreon: { active: false }, equippedBloodlineId: 'bl-old-active' },
        ),
    );
    const bloodlines = out.savedBloodlines as Array<Record<string, unknown>>;
    assert.deepEqual(bloodlines.map((bl) => bl.id), ['bl-new-active', 'bl-safe-overflow']);
    assert.equal(bloodlines[1].name, 'Safe Overflow');
    assert.equal((out.character as Record<string, unknown>).equippedBloodlineId, 'bl-new-active');
});

test('a partial save cannot equip preserved overflow by omitting savedBloodlines', () => {
    const active = mkBloodline('bl-active', 'A Rank');
    const overflow = mkBloodline('bl-overflow', 'A Rank');
    const out = sanitizeCharacterSave(
        { character: { name: 'Tester', level: 50, equippedBloodlineId: 'bl-overflow' } },
        stored(
            [active, overflow],
            [],
            { patreon: { active: false }, equippedBloodlineId: 'bl-active' },
        ),
    );
    assert.deepEqual(
        (out.savedBloodlines as Array<Record<string, unknown>>).map((bloodline) => bloodline.id),
        ['bl-active', 'bl-overflow'],
    );
    assert.equal((out.character as Record<string, unknown>).equippedBloodlineId, 'bl-active');
});

test('oversized prepended submissions cannot push authoritative stored bloodlines outside normalization', () => {
    const active = { ...mkBloodline('bl-active', 'A Rank'), name: 'Authoritative Active' };
    const overflow = { ...mkBloodline('bl-overflow', 'A Rank'), name: 'Authoritative Overflow' };
    const prepended = Array.from({ length: 20 }, (_, index) => mkBloodline(`unpaid-${index + 1}`, 'A Rank'));
    const out = sanitizeCharacterSave(
        incoming(
            [...prepended, active, overflow],
            {},
            { equippedBloodlineId: 'bl-active' },
        ),
        stored(
            [active, overflow],
            [],
            { patreon: { active: false }, equippedBloodlineId: 'bl-active' },
        ),
    );

    const bloodlines = out.savedBloodlines as Array<Record<string, unknown>>;
    assert.deepEqual(bloodlines.map((bloodline) => bloodline.id), ['bl-active', 'bl-overflow']);
    assert.equal(bloodlines[0].name, 'Authoritative Active');
    assert.equal(bloodlines[1].name, 'Authoritative Overflow');
});

test('admin content slots may author the shared bloodline catalog beyond player storage caps', () => {
    const existing = [mkBloodline('admin-one', 'A Rank'), mkBloodline('admin-two', 'A Rank')];
    const edited = { ...existing[1], name: 'Edited by admin' };
    const created = mkBloodline('admin-three', 'S Rank');
    const out = sanitizeCharacterSave(
        incoming([existing[0], edited, created], {}, { equippedBloodlineId: 'admin-three' }),
        stored(existing, [], { patreon: { active: false }, equippedBloodlineId: 'admin-one' }),
        { adminContentSlot: true },
    );
    const bloodlines = out.savedBloodlines as Array<Record<string, unknown>>;
    assert.deepEqual(bloodlines.map((bloodline) => bloodline.id), ['admin-one', 'admin-two', 'admin-three']);
    assert.equal(bloodlines[1].name, 'Edited by admin');
    assert.equal((out.character as Record<string, unknown>).equippedBloodlineId, 'admin-three');
});

test('admin content slots may delete catalog bloodlines instead of restoring omitted entries', () => {
    const existing = [mkBloodline('admin-one', 'A Rank'), mkBloodline('admin-two', 'A Rank')];
    const out = sanitizeCharacterSave(
        incoming([existing[1]], {}, { equippedBloodlineId: 'admin-two' }),
        stored(existing, [], { equippedBloodlineId: 'admin-one' }),
        { adminContentSlot: true },
    );
    assert.deepEqual(
        (out.savedBloodlines as Array<Record<string, unknown>>).map((bloodline) => bloodline.id),
        ['admin-two'],
    );
});

test('admin content bloodline growth is explicitly capped while larger stored catalogs are grandfathered', () => {
    const submitted = Array.from({ length: 55 }, (_, index) => mkBloodline(`admin-${index + 1}`, 'B Rank'));
    const out = sanitizeCharacterSave(
        incoming(submitted),
        stored(),
        { adminContentSlot: true },
    );
    assert.equal((out.savedBloodlines as unknown[]).length, 50);

    const grandfathered = sanitizeCharacterSave(
        incoming(submitted),
        stored(submitted),
        { adminContentSlot: true },
    );
    assert.equal((grandfathered.savedBloodlines as unknown[]).length, 55);
});
