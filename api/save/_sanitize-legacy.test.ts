import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCharacterSave } from './[name].js';

// Anti-self-grant coverage for the Legacy-system fields in the save sanitizer.
// character.legacy and character.serverTitles are written ONLY by the server
// (api/legacy/sage.ts / api/legacy/trial.ts / api/_era.ts / api/admin/legacy.ts):
// whatever a client save claims, the STORED copy always wins — and that vault
// overwrite is deliberately flag-INDEPENDENT, so a legacy/title squatted while
// ENABLE_LEGACY is still off cannot survive the flag flip. The title cosmetics
// (customTitleStyle/customTitleIcon) ARE legacy-gated: flag on = allowlist
// clamp, flag off = the stored copy wins (a kill-switch toggle can't strip an
// already-purchased style, and a client can't smuggle one in while it's off).

type Char = Record<string, unknown>;
const sanitize = (incoming: Char, existing: Char | null) =>
    sanitizeCharacterSave({ character: incoming }, existing ? { character: existing } : null).character as Record<string, any>;

function withLegacyFlag(on: boolean, fn: () => void) {
    const prev = process.env.ENABLE_LEGACY;
    if (on) process.env.ENABLE_LEGACY = '1'; else delete process.env.ENABLE_LEGACY;
    try { fn(); } finally {
        if (prev === undefined) delete process.env.ENABLE_LEGACY; else process.env.ENABLE_LEGACY = prev;
    }
}

const FORGED_LEGACY = { legacyId: 'duel-sovereign', stage: 5, titles: ['Eternal Duel Sovereign'] };
const STORED_LEGACY = { legacyId: 'duel-sovereign', stage: 2, titles: ['Duel Initiate'], startedAt: 1234 };

// ── character.legacy: server-owned, stored copy always wins ─────────────────

test('legacy: a forged legacy with none stored is deleted outright', () => {
    const out = sanitize({ legacy: FORGED_LEGACY }, {});
    assert.equal('legacy' in out, false, 'client cannot self-grant a legacy');
});

test('legacy: forged on a FIRST save (no existing record at all) is deleted too', () => {
    const out = sanitize({ legacy: FORGED_LEGACY }, null);
    assert.equal('legacy' in out, false, 'first-save baseline grants no legacy either');
});

test('legacy: a forged stage/title jump is reverted — output deep-equals the stored copy', () => {
    const out = sanitize({ legacy: FORGED_LEGACY }, { legacy: STORED_LEGACY });
    assert.deepEqual(out.legacy, STORED_LEGACY, 'stored legacy wins verbatim (stage, titles, extra fields)');
});

test('legacy: omitting the field cannot shed a stored legacy — it is re-injected', () => {
    const out = sanitize({}, { legacy: STORED_LEGACY });
    assert.deepEqual(out.legacy, STORED_LEGACY, 'stored legacy re-injected when the save omits it');
});

test('legacy: the vault overwrite is flag-independent (holds with ENABLE_LEGACY on)', () => {
    withLegacyFlag(true, () => {
        assert.deepEqual(sanitize({ legacy: FORGED_LEGACY }, { legacy: STORED_LEGACY }).legacy, STORED_LEGACY, 'stored wins with flag on');
        assert.equal('legacy' in sanitize({ legacy: FORGED_LEGACY }, {}), false, 'self-grant still deleted with flag on');
    });
});

// ── character.serverTitles: same server-owned vault (era Herald grants) ─────

test('serverTitles: a forged vault with none stored is deleted', () => {
    const out = sanitize({ serverTitles: ['Herald of the Mythic Age'] }, {});
    assert.equal('serverTitles' in out, false, 'client cannot self-grant a server title');
});

test('serverTitles: the stored vault always wins over a forged list', () => {
    const out = sanitize(
        { serverTitles: ['Herald of the Mythic Age', 'Eternal Duel Sovereign'] },
        { serverTitles: ['Herald of the First Flame'] },
    );
    assert.deepEqual(out.serverTitles, ['Herald of the First Flame'], 'stored copy replaces the forged one verbatim');
});

test('serverTitles: omission cannot clear the stored vault — it is re-injected', () => {
    const out = sanitize({}, { serverTitles: ['Herald of the First Flame'] });
    assert.deepEqual(out.serverTitles, ['Herald of the First Flame'], 'stored vault re-injected when the save omits it');
});

test('serverTitles: the vault overwrite is flag-independent (holds with ENABLE_LEGACY on)', () => {
    withLegacyFlag(true, () => {
        assert.equal('serverTitles' in sanitize({ serverTitles: ['Herald of the Mythic Age'] }, {}), false, 'self-grant still deleted with flag on');
        assert.deepEqual(
            sanitize({ serverTitles: ['Forged'] }, { serverTitles: ['Herald of the First Flame'] }).serverTitles,
            ['Herald of the First Flame'], 'stored wins with flag on');
    });
});

// ── customTitleStyle / customTitleIcon: legacy-gated cosmetics ──────────────

test('cosmetics flag OFF: incoming style/icon are replaced by the stored copy (kill-switch keeps purchases, blocks smuggling)', () => {
    withLegacyFlag(false, () => {
        const out = sanitize(
            { customTitleStyle: 'royal', customTitleIcon: '👑' },
            { customTitleStyle: 'ember', customTitleIcon: '🔥' },
        );
        assert.equal(out.customTitleStyle, 'ember', 'stored style wins while the flag is off');
        assert.equal(out.customTitleIcon, '🔥', 'stored icon wins while the flag is off');
    });
});

test('cosmetics flag OFF: nothing stored → the incoming fields are deleted (flag-off saves stay byte-identical)', () => {
    withLegacyFlag(false, () => {
        const out = sanitize({ customTitleStyle: 'royal', customTitleIcon: '👑' }, {});
        assert.equal('customTitleStyle' in out, false, 'style deleted when none stored');
        assert.equal('customTitleIcon' in out, false, 'icon deleted when none stored');
    });
});

test('cosmetics flag ON: allowlisted values pass; off-list values clamp to the free default', () => {
    withLegacyFlag(true, () => {
        const ok = sanitize({ customTitleStyle: 'royal', customTitleIcon: '👑' }, {});
        assert.equal(ok.customTitleStyle, 'royal', 'allowlisted style kept');
        assert.equal(ok.customTitleIcon, '👑', 'allowlisted icon kept');
        const bad = sanitize({ customTitleStyle: 'hax-rainbow', customTitleIcon: '💀' }, {});
        assert.equal(bad.customTitleStyle, '', 'off-list style clamped to empty');
        assert.equal(bad.customTitleIcon, '', 'off-list icon clamped to empty');
    });
});
