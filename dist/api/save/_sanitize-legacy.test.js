"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _name__js_1 = require("./[name].js");
const sanitize = (incoming, existing) => (0, _name__js_1.sanitizeCharacterSave)({ character: incoming }, existing ? { character: existing } : null).character;
function withLegacyFlag(on, fn) {
    const prev = process.env.ENABLE_LEGACY;
    if (on)
        process.env.ENABLE_LEGACY = '1';
    else
        delete process.env.ENABLE_LEGACY;
    try {
        fn();
    }
    finally {
        if (prev === undefined)
            delete process.env.ENABLE_LEGACY;
        else
            process.env.ENABLE_LEGACY = prev;
    }
}
const FORGED_LEGACY = { legacyId: 'duel-sovereign', stage: 5, titles: ['Eternal Duel Sovereign'] };
const STORED_LEGACY = { legacyId: 'duel-sovereign', stage: 2, titles: ['Duel Initiate'], startedAt: 1234 };
// ── character.legacy: server-owned, stored copy always wins ─────────────────
(0, node_test_1.test)('legacy: a forged legacy with none stored is deleted outright', () => {
    const out = sanitize({ legacy: FORGED_LEGACY }, {});
    strict_1.default.equal('legacy' in out, false, 'client cannot self-grant a legacy');
});
(0, node_test_1.test)('legacy: forged on a FIRST save (no existing record at all) is deleted too', () => {
    const out = sanitize({ legacy: FORGED_LEGACY }, null);
    strict_1.default.equal('legacy' in out, false, 'first-save baseline grants no legacy either');
});
(0, node_test_1.test)('legacy: a forged stage/title jump is reverted — output deep-equals the stored copy', () => {
    const out = sanitize({ legacy: FORGED_LEGACY }, { legacy: STORED_LEGACY });
    strict_1.default.deepEqual(out.legacy, STORED_LEGACY, 'stored legacy wins verbatim (stage, titles, extra fields)');
});
(0, node_test_1.test)('legacy: omitting the field cannot shed a stored legacy — it is re-injected', () => {
    const out = sanitize({}, { legacy: STORED_LEGACY });
    strict_1.default.deepEqual(out.legacy, STORED_LEGACY, 'stored legacy re-injected when the save omits it');
});
(0, node_test_1.test)('legacy: the vault overwrite is flag-independent (holds with ENABLE_LEGACY on)', () => {
    withLegacyFlag(true, () => {
        strict_1.default.deepEqual(sanitize({ legacy: FORGED_LEGACY }, { legacy: STORED_LEGACY }).legacy, STORED_LEGACY, 'stored wins with flag on');
        strict_1.default.equal('legacy' in sanitize({ legacy: FORGED_LEGACY }, {}), false, 'self-grant still deleted with flag on');
    });
});
// ── character.serverTitles: same server-owned vault (era Herald grants) ─────
(0, node_test_1.test)('serverTitles: a forged vault with none stored is deleted', () => {
    const out = sanitize({ serverTitles: ['Herald of the Mythic Age'] }, {});
    strict_1.default.equal('serverTitles' in out, false, 'client cannot self-grant a server title');
});
(0, node_test_1.test)('serverTitles: the stored vault always wins over a forged list', () => {
    const out = sanitize({ serverTitles: ['Herald of the Mythic Age', 'Eternal Duel Sovereign'] }, { serverTitles: ['Herald of the First Flame'] });
    strict_1.default.deepEqual(out.serverTitles, ['Herald of the First Flame'], 'stored copy replaces the forged one verbatim');
});
(0, node_test_1.test)('serverTitles: omission cannot clear the stored vault — it is re-injected', () => {
    const out = sanitize({}, { serverTitles: ['Herald of the First Flame'] });
    strict_1.default.deepEqual(out.serverTitles, ['Herald of the First Flame'], 'stored vault re-injected when the save omits it');
});
(0, node_test_1.test)('serverTitles: the vault overwrite is flag-independent (holds with ENABLE_LEGACY on)', () => {
    withLegacyFlag(true, () => {
        strict_1.default.equal('serverTitles' in sanitize({ serverTitles: ['Herald of the Mythic Age'] }, {}), false, 'self-grant still deleted with flag on');
        strict_1.default.deepEqual(sanitize({ serverTitles: ['Forged'] }, { serverTitles: ['Herald of the First Flame'] }).serverTitles, ['Herald of the First Flame'], 'stored wins with flag on');
    });
});
// ── customTitleStyle / customTitleIcon: legacy-gated cosmetics ──────────────
(0, node_test_1.test)('cosmetics flag OFF: incoming style/icon are replaced by the stored copy (kill-switch keeps purchases, blocks smuggling)', () => {
    withLegacyFlag(false, () => {
        const out = sanitize({ customTitleStyle: 'royal', customTitleIcon: '👑' }, { customTitleStyle: 'ember', customTitleIcon: '🔥' });
        strict_1.default.equal(out.customTitleStyle, 'ember', 'stored style wins while the flag is off');
        strict_1.default.equal(out.customTitleIcon, '🔥', 'stored icon wins while the flag is off');
    });
});
(0, node_test_1.test)('cosmetics flag OFF: nothing stored → the incoming fields are deleted (flag-off saves stay byte-identical)', () => {
    withLegacyFlag(false, () => {
        const out = sanitize({ customTitleStyle: 'royal', customTitleIcon: '👑' }, {});
        strict_1.default.equal('customTitleStyle' in out, false, 'style deleted when none stored');
        strict_1.default.equal('customTitleIcon' in out, false, 'icon deleted when none stored');
    });
});
(0, node_test_1.test)('cosmetics flag ON: allowlisted values pass; off-list values clamp to the free default', () => {
    withLegacyFlag(true, () => {
        const ok = sanitize({ customTitleStyle: 'royal', customTitleIcon: '👑' }, {});
        strict_1.default.equal(ok.customTitleStyle, 'royal', 'allowlisted style kept');
        strict_1.default.equal(ok.customTitleIcon, '👑', 'allowlisted icon kept');
        const bad = sanitize({ customTitleStyle: 'hax-rainbow', customTitleIcon: '💀' }, {});
        strict_1.default.equal(bad.customTitleStyle, '', 'off-list style clamped to empty');
        strict_1.default.equal(bad.customTitleIcon, '', 'off-list icon clamped to empty');
    });
});
