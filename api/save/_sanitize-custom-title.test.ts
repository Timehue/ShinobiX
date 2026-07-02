import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCharacterSave } from './[name].js';
import { isServerCreditedTitle, isKnownEarnedTitle } from '../_titles-registry.js';

// Coverage for the customTitle three-way routing matrix in sanitizeCharacterSave
// (api/save/[name].ts). The matrix, built up across the legacy verification
// passes: (1) a CHANGED server-credited title string (legacy/era) is ALWAYS-ON
// gated — even with ENABLE_LEGACY unset — on the STORED server-owned vault
// (character.legacy.titles ∪ character.serverTitles); (2) a CHANGED achievement
// title is gated behind ENABLE_LEGACY=1 on earnedTitles ∪ stored serverTitles;
// (3) other free text goes through isAllowedCustomTitle. An UNCHANGED title is
// grandfathered (never re-evaluated), and a non-string customTitle clears to ''.

type Char = Record<string, unknown>;
const wrap = (character: Char) => ({ character });
const sanitize = (incoming: Char, existing: Char | null) =>
    sanitizeCharacterSave(wrap(incoming), existing ? wrap(existing) : null).character as Record<string, any>;

// legacyEnabled() (api/_legacy-track.ts) reads process.env.ENABLE_LEGACY live on
// every call, so each test pins the flag for its body and restores the outer
// value after — no cross-test leakage either way.
function withLegacyFlag<T>(value: string | undefined, fn: () => T): T {
    const prev = process.env.ENABLE_LEGACY;
    if (value === undefined) delete process.env.ENABLE_LEGACY;
    else process.env.ENABLE_LEGACY = value;
    try {
        return fn();
    } finally {
        if (prev === undefined) delete process.env.ENABLE_LEGACY;
        else process.env.ENABLE_LEGACY = prev;
    }
}
const legacyOff = <T>(fn: () => T) => withLegacyFlag(undefined, fn);
const legacyOn = <T>(fn: () => T) => withLegacyFlag('1', fn);

// Stage-5 mythic variant of the Duel Sovereign legacy — server-credited.
const SERVER_TITLE = 'Eternal Duel Sovereign';
// Achievement title (ranked-season-champ) — known-earned but NOT server-credited.
const ACH_TITLE = 'Season Champion';
// Clean free text that matches no registry entry.
const FREE_TITLE = 'Wandering Blade';

test('registry preconditions: the fixture strings still classify the way the tests below route on', () => {
    assert.equal(isServerCreditedTitle(SERVER_TITLE), true, `${SERVER_TITLE} must be server-credited (legacy mythic variant)`);
    assert.equal(isKnownEarnedTitle(ACH_TITLE), true, `${ACH_TITLE} must be a known earned title`);
    assert.equal(isServerCreditedTitle(ACH_TITLE), false, `${ACH_TITLE} must NOT be server-credited (earnedTitles path)`);
    assert.equal(isKnownEarnedTitle(FREE_TITLE), false, `${FREE_TITLE} must stay free text (isAllowedCustomTitle path)`);
});

// ── (1) server-credited titles: ALWAYS-ON vault gate ────────────────────────

test('server-credited title: a CHANGED claim with an empty vault clears to \'\' — with ENABLE_LEGACY unset AND set', () => {
    legacyOff(() => {
        assert.equal(sanitize({ customTitle: SERVER_TITLE }, { customTitle: '' }).customTitle, '', 'flag off: squatting a legacy title is rejected (always-on gate)');
        assert.equal(sanitize({ customTitle: SERVER_TITLE }, null).customTitle, '', 'first save (no existing) cannot claim one either');
    });
    legacyOn(() => {
        assert.equal(sanitize({ customTitle: SERVER_TITLE }, { customTitle: '' }).customTitle, '', 'flag on: same rejection');
    });
});

test('server-credited title: passes when the STORED legacy.titles vault contains it (flag off)', () => {
    legacyOff(() => {
        const out = sanitize(
            { customTitle: SERVER_TITLE },
            { customTitle: '', legacy: { titles: [SERVER_TITLE] } },
        );
        assert.equal(out.customTitle, SERVER_TITLE, 'trial-granted title is wearable');
    });
});

test('server-credited title: stored serverTitles is the other half of the ownership union', () => {
    legacyOff(() => {
        const out = sanitize(
            { customTitle: SERVER_TITLE },
            { customTitle: '', serverTitles: [SERVER_TITLE] },
        );
        assert.equal(out.customTitle, SERVER_TITLE, 'server-vault title is wearable');
    });
});

test('server-credited title: INCOMING legacy/serverTitles/earnedTitles self-grants do not count — ownership reads the STORED save only', () => {
    legacyOff(() => {
        const out = sanitize(
            { customTitle: SERVER_TITLE, legacy: { titles: [SERVER_TITLE] }, serverTitles: [SERVER_TITLE], earnedTitles: [SERVER_TITLE] },
            { customTitle: '' },
        );
        assert.equal(out.customTitle, '', 'a tampered save cannot mint its own ownership proof');
    });
});

test('server-credited title: case/whitespace variants cannot dodge the gate (normalizeTitleKey)', () => {
    legacyOff(() => {
        assert.equal(sanitize({ customTitle: 'eternal  DUEL sovereign' }, { customTitle: '' }).customTitle, '', 'pixel-identical variant of an unowned title is still rejected');
    });
});

// ── (2) achievement titles: ENABLE_LEGACY-gated earnedTitles ∪ serverTitles ──

test('achievement title (ENABLE_LEGACY=1): a CHANGED claim clears unless earnedTitles/serverTitles contains it', () => {
    legacyOn(() => {
        assert.equal(sanitize({ customTitle: ACH_TITLE }, { customTitle: '' }).customTitle, '', 'unowned achievement title rejected');
        assert.equal(
            sanitize({ customTitle: ACH_TITLE, earnedTitles: [ACH_TITLE] }, { customTitle: '' }).customTitle,
            ACH_TITLE, 'earnedTitles grants it (same client-trust level as achievements)',
        );
        assert.equal(
            sanitize({ customTitle: ACH_TITLE }, { customTitle: '', serverTitles: [ACH_TITLE] }).customTitle,
            ACH_TITLE, 'stored serverTitles grants it too',
        );
    });
});

test('achievement title (flag OFF): the new moderation does not run — a changed title passes through (byte-identical old behavior)', () => {
    legacyOff(() => {
        assert.equal(sanitize({ customTitle: ACH_TITLE }, { customTitle: '' }).customTitle, ACH_TITLE, 'flag-off behavior is the old mask-only path');
    });
});

// ── (3) free text + grandfathering + non-string tamper ──────────────────────

test('free text (ENABLE_LEGACY=1): clean custom text passes; a reserved authority term clears', () => {
    legacyOn(() => {
        assert.equal(sanitize({ customTitle: FREE_TITLE }, { customTitle: '' }).customTitle, FREE_TITLE, 'clean free text kept');
        assert.equal(sanitize({ customTitle: 'Hokage of the Leaf' }, { customTitle: '' }).customTitle, '', 'reserved impersonation term rejected via isAllowedCustomTitle');
    });
});

test('unchanged title: grandfathered untouched in both flag states (never re-confiscated)', () => {
    for (const run of [legacyOff, legacyOn]) {
        run(() => {
            assert.equal(
                sanitize({ customTitle: SERVER_TITLE }, { customTitle: SERVER_TITLE }).customTitle,
                SERVER_TITLE, 'an already-worn server-credited title survives with NO vault entry',
            );
            assert.equal(
                sanitize({ customTitle: ACH_TITLE }, { customTitle: ACH_TITLE }).customTitle,
                ACH_TITLE, 'an already-worn achievement title survives with no earnedTitles',
            );
        });
    }
});

test('non-string customTitle (array/object) clears to \'\' — cannot skip the string gate', () => {
    legacyOff(() => {
        assert.equal(sanitize({ customTitle: ['x'] }, { customTitle: '' }).customTitle, '', 'array cleared');
        assert.equal(sanitize({ customTitle: { a: 1 } }, { customTitle: SERVER_TITLE }).customTitle, '', 'object cleared even when a title was stored');
    });
});
