process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

/*
 * F13 — deterministic regeneration.
 *
 * `_regenAt` is the regeneration cursor; `_saveAt` stays the mutation / gain-cap
 * timestamp. The cursor advances by whole ticks and keeps the remainder, every
 * authoritative mutation settles elapsed recovery BEFORE it reads a vital, a
 * mutation that changes a vital fences the cursor, and excluded activity is
 * never counted as idle recovery.
 */

type Json = Record<string, unknown>;

let kv: typeof import('./_storage.js').kv;
let elapsed: typeof import('./_elapsed-state.js');
let mutatePlayerSave: typeof import('./save/_mutate-player-save.js').mutatePlayerSave;
let bumpSaveVersion: typeof import('./save/_save-version.js').bumpSaveVersion;
let PET_BREEDING_MIGRATION_VERSION: number;

const NOW = 1_800_000_000_000;

function record(over: Json = {}, character: Json = {}): Json {
    return {
        _saveVersion: 3,
        _saveAt: NOW - 10_500,
        worldGeoV: 2,
        character: {
            name: 'Cursor', hp: 10, maxHp: 100, chakra: 10, maxChakra: 100, stamina: 10, maxStamina: 100,
            petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION,
            ...character,
        },
        ...over,
    };
}

before(async () => {
    ({ kv } = await import('./_storage.js'));
    elapsed = await import('./_elapsed-state.js');
    ({ mutatePlayerSave } = await import('./save/_mutate-player-save.js'));
    ({ bumpSaveVersion } = await import('./save/_save-version.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('./pet/_owned-pet.js'));
});

after(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

describe('settleVitalsRegen — the cursor keeps the remainder', () => {
    it('credits whole ticks and advances the cursor by exactly those ticks, not to now', () => {
        const first = elapsed.settleVitalsRegen(record(), { now: NOW, battleLocked: false });
        assert.equal(first.changed, true);
        assert.equal((first.record.character as Json).hp, 20, '10.5s elapsed → 10 ticks');
        assert.equal(first.record._regenAt, NOW - 500, 'the 500ms remainder is kept on the cursor');
        assert.equal(first.record._saveAt, NOW, '_saveAt stays the write timestamp');

        // 700ms later: 500 + 700 = 1200ms since the cursor → one more tick.
        const second = elapsed.settleVitalsRegen(first.record, { now: NOW + 700, battleLocked: false });
        assert.equal(second.changed, true);
        assert.equal((second.record.character as Json).hp, 21);
        assert.equal(second.record._regenAt, NOW + 500);
    });

    it('equal elapsed time yields the same recovery under one read or many', () => {
        const oneShot = elapsed.settleVitalsRegen(record(), { now: NOW + 4_300, battleLocked: false });
        let many = record();
        for (const at of [NOW + 900, NOW + 1_700, NOW + 2_600, NOW + 3_100, NOW + 4_300]) {
            many = elapsed.settleVitalsRegen(many, { now: at, battleLocked: false }).record;
        }
        assert.equal((oneShot.record.character as Json).hp, 24, '14.8s → 14 ticks');
        assert.equal((many.character as Json).hp, (oneShot.record.character as Json).hp, 'no fractional loss across reads');
    });

    it('falls back to _saveAt for a record without a cursor, granting nothing extra', () => {
        const legacy = elapsed.settleVitalsRegen(record({ _saveAt: NOW - 3_000 }), { now: NOW, battleLocked: false });
        assert.equal((legacy.record.character as Json).hp, 13);
        assert.equal(legacy.record._regenAt, NOW);
        const noClock = elapsed.settleVitalsRegen(record({ _saveAt: undefined }), { now: NOW, battleLocked: false });
        assert.equal(noClock.changed, false);
        assert.equal(noClock.cursor, 0);
    });

    it('excludes real activity and counts recovery after a stay from the discharge, not the admission', () => {
        const locked = elapsed.settleVitalsRegen(record(), { now: NOW, battleLocked: true });
        assert.equal(locked.changed, false);
        assert.equal(locked.excluded, true);
        const admitted = elapsed.settleVitalsRegen(record({}, { hospitalized: true, hospitalizedUntil: NOW + 30_000 }), { now: NOW, battleLocked: false });
        assert.equal(admitted.excluded, true);
        // Discharged by the timer 4s ago; the cursor still sits at the admission.
        const discharged = elapsed.settleVitalsRegen(
            record({ _regenAt: NOW - 64_000 }, { hospitalized: false, hospitalizedUntil: NOW - 4_000 }),
            { now: NOW, battleLocked: false },
        );
        assert.equal((discharged.record.character as Json).hp, 14, 'only the 4s since discharge count');
    });

    it('never banks recovery while capped', () => {
        const full = elapsed.settleVitalsRegen(record({}, { hp: 100, chakra: 100, stamina: 100 }), { now: NOW, battleLocked: false });
        assert.equal(full.changed, false);
        assert.equal(full.cursor, NOW - 500, 'the cursor a write carries forward has still advanced');
    });
});

describe('bumpSaveVersion — the cursor is fenced unless a settled cursor is passed', () => {
    it('fences to the write instant by default and carries an explicit cursor', () => {
        const fenced = bumpSaveVersion({ _saveVersion: 1, _regenAt: NOW - 9_000 });
        assert.equal(fenced._regenAt, fenced._saveAt);
        const carried = bumpSaveVersion({ _saveVersion: 1 }, { regenAt: NOW - 500 });
        assert.equal(carried._regenAt, NOW - 500);
    });
});

describe('mutatePlayerSave settles elapsed recovery before the mutation reads a vital', { concurrency: false }, () => {
    it('a consumer sees regenerated stamina with no owner GET first, and a spend fences the cursor', async () => {
        const key = 'save:cursorspend';
        await kv.set(key, record({ _saveAt: Date.now() - 10_500 }, { name: 'cursorspend', stamina: 0 }));
        const out = await mutatePlayerSave('cursorspend', ({ character }) => {
            assert.equal(character.stamina, 10, 'ten seconds of recovery are credited before validation');
            return { ok: true, character: { ...character, stamina: Number(character.stamina) - 4 }, value: null };
        });
        assert.equal(out.ok, true);
        const durable = await kv.get<Json>(key);
        assert.equal((durable?.character as Json).stamina, 6);
        assert.equal(durable?._regenAt, durable?._saveAt, 'a vitals-changing mutation fences the cursor to the write');
    });

    it('a mutation that leaves vitals alone carries the settled cursor and its remainder forward', async () => {
        const key = 'save:cursorbank';
        const startedAt = Date.now() - 10_500;
        await kv.set(key, record({ _saveAt: startedAt }, { name: 'cursorbank', ryo: 100 }));
        const out = await mutatePlayerSave('cursorbank', ({ character }) => ({
            ok: true,
            character: { ...character, ryo: 75 },
            value: null,
        }));
        assert.equal(out.ok, true);
        const durable = await kv.get<Json>(key);
        assert.equal((durable?.character as Json).hp, 20, 'the elapsed recovery is persisted with the mutation');
        assert.equal(durable?._regenAt, startedAt + 10_000, 'ten whole ticks — the remainder survives the write');
        assert.ok(Number(durable?._saveAt) > Number(durable?._regenAt), '_saveAt is the write, _regenAt the cursor');
    });

    it('a battle-locked mutation credits nothing and fences the cursor', async () => {
        const key = 'save:cursorlocked';
        await kv.set(key, record({ _saveAt: Date.now() - 10_500 }, { name: 'cursorlocked' }));
        await kv.set('battle-lock:cursorlocked', { since: Date.now() }, { ex: 60 });
        const out = await mutatePlayerSave('cursorlocked', ({ character }) => {
            assert.equal(character.hp, 10, 'no recovery during a battle lock');
            return { ok: true, character: { ...character, ryo: 1 }, value: null };
        });
        assert.equal(out.ok, true);
        const durable = await kv.get<Json>(key);
        assert.equal(durable?._regenAt, durable?._saveAt, 'combat time is never counted as idle recovery later');
    });
});
