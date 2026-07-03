"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _text_moderation_js_1 = require("./_text-moderation.js");
const _titles_registry_js_1 = require("./_titles-registry.js");
const _legacy_defs_js_1 = require("./_legacy-defs.js");
(0, node_test_1.test)('reserved terms catch authority/impersonation, leet + homoglyph + zero-width included', () => {
    for (const bad of [
        'Admin', 'ADMIN', 'admin of pain', 'The Moderator', 'server first',
        'Hokage', 'Official Staff', '4dmin', 'Game Master', 'hall of legends',
        'Ádmín', // diacritics folded
        'Ad​min', // zero-width space
        'аdmin', // Cyrillic 'а'
        'World First',
    ]) {
        strict_1.default.equal((0, _text_moderation_js_1.hasReservedTitleTerm)(bad), true, `should reserve: ${bad}`);
    }
});
(0, node_test_1.test)('game vocabulary and normal titles pass (tightened reserved list)', () => {
    for (const ok of [
        'Shadow of the Leaf', 'Ramen Enthusiast', 'The Unseen Blade',
        'Moonlight Wanderer', 'Big Toad Energy', 'Kagemusha',
        'Kage Slayer', // "kage" is game vocabulary — no longer reserved
        'Modest Blade', // "mod" no longer a bare reserved token
        'Devout Monk', // "dev" no longer reserved
    ]) {
        strict_1.default.equal((0, _text_moderation_js_1.hasReservedTitleTerm)(ok), false, `should allow: ${ok}`);
        strict_1.default.equal((0, _text_moderation_js_1.isAllowedCustomTitle)(ok), true, `should allow: ${ok}`);
    }
    strict_1.default.equal((0, _text_moderation_js_1.isAllowedCustomTitle)(''), true, 'clearing is always allowed');
    strict_1.default.equal((0, _text_moderation_js_1.isAllowedCustomTitle)('x'.repeat(200)), false, 'length cap');
});
(0, node_test_1.test)('era trigger titles are server-credited (strict), not just achievement-trusted', () => {
    strict_1.default.equal((0, _titles_registry_js_1.isServerCreditedTitle)('Herald of the Mythic Age'), true, 'era Herald is strict');
    strict_1.default.equal((0, _titles_registry_js_1.isLegacyOnlyTitle)('Herald of the Mythic Age'), false, 'not a legacy title, but still strict');
    strict_1.default.equal((0, _titles_registry_js_1.isServerCreditedTitle)('Moonlit Ghost'), true, 'legacy titles are strict');
    strict_1.default.equal((0, _titles_registry_js_1.isServerCreditedTitle)('Season Champion'), false, 'achievement titles are client-trusted');
    // Whitespace-normalized comparison closes the doubled-space impersonation.
    strict_1.default.equal((0, _titles_registry_js_1.normalizeTitleKey)('Moonlit   Ghost'), 'moonlit ghost');
    strict_1.default.equal((0, _titles_registry_js_1.isServerCreditedTitle)('Moonlit   Ghost'), true, 'doubled space still matched');
});
(0, node_test_1.test)('stage 4/5 prestige variants are registered and strict for every legacy', () => {
    strict_1.default.equal((0, _titles_registry_js_1.isServerCreditedTitle)('Proven Moonlit Ghost'), true);
    strict_1.default.equal((0, _titles_registry_js_1.isServerCreditedTitle)('Eternal Moonlit Ghost'), true);
    strict_1.default.equal((0, _titles_registry_js_1.isKnownEarnedTitle)('Proven Duel King'), true);
    for (const d of _legacy_defs_js_1.LEGACY_DEFS) {
        strict_1.default.ok((0, _titles_registry_js_1.isServerCreditedTitle)(`Proven ${d.title}`), `missing proven variant: ${d.title}`);
        strict_1.default.ok((0, _titles_registry_js_1.isServerCreditedTitle)(`Eternal ${d.title}`), `missing eternal variant: ${d.title}`);
    }
    // 100 base + 100 proven + 100 eternal + 22 achievements + era titles.
    strict_1.default.ok(_titles_registry_js_1.KNOWN_EARNED_TITLES.size >= 320, `registry too small: ${_titles_registry_js_1.KNOWN_EARNED_TITLES.size}`);
});
(0, node_test_1.test)('titles registry covers every legacy + achievement title and flags them', () => {
    strict_1.default.equal(_titles_registry_js_1.ACHIEVEMENT_TITLES.length, 26, 'mirrors TITLE_ACHIEVEMENT_IDS — update both together');
    for (const d of _legacy_defs_js_1.LEGACY_DEFS) {
        strict_1.default.ok((0, _titles_registry_js_1.isKnownEarnedTitle)(d.title), `legacy title missing from registry: ${d.title}`);
    }
    strict_1.default.ok((0, _titles_registry_js_1.isKnownEarnedTitle)('Season Champion'));
    strict_1.default.ok((0, _titles_registry_js_1.isKnownEarnedTitle)('  season champion  '), 'case/space-insensitive');
    strict_1.default.ok((0, _titles_registry_js_1.isKnownEarnedTitle)('Herald of the Mythic Age'), 'era trigger title registered');
    strict_1.default.equal((0, _titles_registry_js_1.isKnownEarnedTitle)('Ramen Enthusiast'), false);
    // Registry sanity: base legacy(100) + achievements(22) + era titles at
    // minimum (prestige variants push it past 320 — asserted below).
    strict_1.default.ok(_titles_registry_js_1.KNOWN_EARNED_TITLES.size >= 120, 'legacy(100) + achievements(22) + era titles');
});
