import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { shouldWriteRegistry, type RegistryIdentity } from './_registry-throttle.js';

const REFRESH = 60_000;
const ID: RegistryIdentity = { name: 'Akira', level: 5, village: 'Stormveil', specialty: 'Ninjutsu' };
const base = {
    isClanSave: false,
    existingChar: { name: 'Akira', level: 5, village: 'Stormveil', specialty: 'Ninjutsu' } as Record<string, unknown>,
    next: ID,
    prevRegistryAt: 1_000_000,
    now: 1_000_000 + 1_000, // 1s later — within the refresh window
    refreshMs: REFRESH,
};

describe('shouldWriteRegistry', () => {
    it('always writes for a brand-new save (no existing character)', () => {
        assert.equal(shouldWriteRegistry({ ...base, existingChar: null }), true);
    });

    it('always writes for clan saves', () => {
        assert.equal(shouldWriteRegistry({ ...base, isClanSave: true }), true);
    });

    it('skips a rapid re-save when nothing roster-visible changed', () => {
        assert.equal(shouldWriteRegistry(base), false);
    });

    it('writes when level changed (level-up must reach the roster)', () => {
        assert.equal(shouldWriteRegistry({ ...base, next: { ...ID, level: 6 } }), true);
    });

    it('writes when village changed', () => {
        assert.equal(shouldWriteRegistry({ ...base, next: { ...ID, village: 'Emberfall' } }), true);
    });

    it('writes when specialty changed', () => {
        assert.equal(shouldWriteRegistry({ ...base, next: { ...ID, specialty: 'Taijutsu' } }), true);
    });

    it('writes when display name changed', () => {
        assert.equal(shouldWriteRegistry({ ...base, next: { ...ID, name: 'Akira II' } }), true);
    });

    it('refreshes lastSeen once the cached stamp drifts past refreshMs', () => {
        // 61s after the last registry write, with no identity change → refresh.
        assert.equal(shouldWriteRegistry({ ...base, now: base.prevRegistryAt + REFRESH + 1 }), true);
    });

    it('does not refresh exactly at the boundary (strictly greater than)', () => {
        assert.equal(shouldWriteRegistry({ ...base, now: base.prevRegistryAt + REFRESH }), false);
    });

    it('treats a never-stamped entry (prevRegistryAt 0) as stale → writes', () => {
        assert.equal(shouldWriteRegistry({ ...base, prevRegistryAt: 0 }), true);
    });

    it('tolerates missing/absent fields on the existing character', () => {
        // A legacy save missing village/specialty should be seen as "changed"
        // against a populated incoming identity, so the registry gets corrected.
        assert.equal(shouldWriteRegistry({ ...base, existingChar: { name: 'Akira', level: 5 } }), true);
    });
});
