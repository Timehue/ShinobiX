"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _name__js_1 = require("./[name].js");
const _titles_registry_js_1 = require("../_titles-registry.js");
const wrap = (character) => ({ character });
const sanitize = (incoming, existing) => (0, _name__js_1.sanitizeCharacterSave)(wrap(incoming), existing ? wrap(existing) : null).character;
// legacyEnabled() (api/_legacy-track.ts) reads process.env.ENABLE_LEGACY live on
// every call, so each test pins the flag for its body and restores the outer
// value after — no cross-test leakage either way.
function withLegacyFlag(value, fn) {
    const prev = process.env.ENABLE_LEGACY;
    if (value === undefined)
        delete process.env.ENABLE_LEGACY;
    else
        process.env.ENABLE_LEGACY = value;
    try {
        return fn();
    }
    finally {
        if (prev === undefined)
            delete process.env.ENABLE_LEGACY;
        else
            process.env.ENABLE_LEGACY = prev;
    }
}
const legacyOff = (fn) => withLegacyFlag(undefined, fn);
const legacyOn = (fn) => withLegacyFlag('1', fn);
// Stage-5 mythic variant of the Duel Sovereign legacy — server-credited.
const SERVER_TITLE = 'Eternal Duel Sovereign';
// Achievement title (ranked-season-champ) — known-earned but NOT server-credited.
const ACH_TITLE = 'Season Champion';
// Clean free text that matches no registry entry.
const FREE_TITLE = 'Wandering Blade';
(0, node_test_1.test)('registry preconditions: the fixture strings still classify the way the tests below route on', () => {
    strict_1.default.equal((0, _titles_registry_js_1.isServerCreditedTitle)(SERVER_TITLE), true, `${SERVER_TITLE} must be server-credited (legacy mythic variant)`);
    strict_1.default.equal((0, _titles_registry_js_1.isKnownEarnedTitle)(ACH_TITLE), true, `${ACH_TITLE} must be a known earned title`);
    strict_1.default.equal((0, _titles_registry_js_1.isServerCreditedTitle)(ACH_TITLE), false, `${ACH_TITLE} must NOT be server-credited (earnedTitles path)`);
    strict_1.default.equal((0, _titles_registry_js_1.isKnownEarnedTitle)(FREE_TITLE), false, `${FREE_TITLE} must stay free text (isAllowedCustomTitle path)`);
});
// ── (1) server-credited titles: ALWAYS-ON vault gate ────────────────────────
(0, node_test_1.test)('server-credited title: a CHANGED claim with an empty vault clears to \'\' — with ENABLE_LEGACY unset AND set', () => {
    legacyOff(() => {
        strict_1.default.equal(sanitize({ customTitle: SERVER_TITLE }, { customTitle: '' }).customTitle, '', 'flag off: squatting a legacy title is rejected (always-on gate)');
        strict_1.default.equal(sanitize({ customTitle: SERVER_TITLE }, null).customTitle, '', 'first save (no existing) cannot claim one either');
    });
    legacyOn(() => {
        strict_1.default.equal(sanitize({ customTitle: SERVER_TITLE }, { customTitle: '' }).customTitle, '', 'flag on: same rejection');
    });
});
(0, node_test_1.test)('server-credited title: passes when the STORED legacy.titles vault contains it (flag off)', () => {
    legacyOff(() => {
        const out = sanitize({ customTitle: SERVER_TITLE }, { customTitle: '', legacy: { titles: [SERVER_TITLE] } });
        strict_1.default.equal(out.customTitle, SERVER_TITLE, 'trial-granted title is wearable');
    });
});
(0, node_test_1.test)('server-credited title: stored serverTitles is the other half of the ownership union', () => {
    legacyOff(() => {
        const out = sanitize({ customTitle: SERVER_TITLE }, { customTitle: '', serverTitles: [SERVER_TITLE] });
        strict_1.default.equal(out.customTitle, SERVER_TITLE, 'server-vault title is wearable');
    });
});
(0, node_test_1.test)('server-credited title: INCOMING legacy/serverTitles/earnedTitles self-grants do not count — ownership reads the STORED save only', () => {
    legacyOff(() => {
        const out = sanitize({ customTitle: SERVER_TITLE, legacy: { titles: [SERVER_TITLE] }, serverTitles: [SERVER_TITLE], earnedTitles: [SERVER_TITLE] }, { customTitle: '' });
        strict_1.default.equal(out.customTitle, '', 'a tampered save cannot mint its own ownership proof');
    });
});
(0, node_test_1.test)('server-credited title: case/whitespace variants cannot dodge the gate (normalizeTitleKey)', () => {
    legacyOff(() => {
        strict_1.default.equal(sanitize({ customTitle: 'eternal  DUEL sovereign' }, { customTitle: '' }).customTitle, '', 'pixel-identical variant of an unowned title is still rejected');
    });
});
// ── (2) achievement titles: ENABLE_LEGACY-gated earnedTitles ∪ serverTitles ──
(0, node_test_1.test)('achievement title (ENABLE_LEGACY=1): a CHANGED claim clears unless earnedTitles/serverTitles contains it', () => {
    legacyOn(() => {
        strict_1.default.equal(sanitize({ customTitle: ACH_TITLE }, { customTitle: '' }).customTitle, '', 'unowned achievement title rejected');
        strict_1.default.equal(sanitize({ customTitle: ACH_TITLE, earnedTitles: [ACH_TITLE] }, { customTitle: '' }).customTitle, ACH_TITLE, 'earnedTitles grants it (same client-trust level as achievements)');
        strict_1.default.equal(sanitize({ customTitle: ACH_TITLE }, { customTitle: '', serverTitles: [ACH_TITLE] }).customTitle, ACH_TITLE, 'stored serverTitles grants it too');
    });
});
(0, node_test_1.test)('achievement title (flag OFF): the new moderation does not run — a changed title passes through (byte-identical old behavior)', () => {
    legacyOff(() => {
        strict_1.default.equal(sanitize({ customTitle: ACH_TITLE }, { customTitle: '' }).customTitle, ACH_TITLE, 'flag-off behavior is the old mask-only path');
    });
});
// ── (3) free text + grandfathering + non-string tamper ──────────────────────
(0, node_test_1.test)('free text (ENABLE_LEGACY=1): clean custom text passes; a reserved authority term clears', () => {
    legacyOn(() => {
        strict_1.default.equal(sanitize({ customTitle: FREE_TITLE }, { customTitle: '' }).customTitle, FREE_TITLE, 'clean free text kept');
        strict_1.default.equal(sanitize({ customTitle: 'Hokage of the Leaf' }, { customTitle: '' }).customTitle, '', 'reserved impersonation term rejected via isAllowedCustomTitle');
    });
});
(0, node_test_1.test)('unchanged title: grandfathered untouched in both flag states (never re-confiscated)', () => {
    for (const run of [legacyOff, legacyOn]) {
        run(() => {
            strict_1.default.equal(sanitize({ customTitle: SERVER_TITLE }, { customTitle: SERVER_TITLE }).customTitle, SERVER_TITLE, 'an already-worn server-credited title survives with NO vault entry');
            strict_1.default.equal(sanitize({ customTitle: ACH_TITLE }, { customTitle: ACH_TITLE }).customTitle, ACH_TITLE, 'an already-worn achievement title survives with no earnedTitles');
        });
    }
});
(0, node_test_1.test)('non-string customTitle (array/object) clears to \'\' — cannot skip the string gate', () => {
    legacyOff(() => {
        strict_1.default.equal(sanitize({ customTitle: ['x'] }, { customTitle: '' }).customTitle, '', 'array cleared');
        strict_1.default.equal(sanitize({ customTitle: { a: 1 } }, { customTitle: SERVER_TITLE }).customTitle, '', 'object cleared even when a title was stored');
    });
});
