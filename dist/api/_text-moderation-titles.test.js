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
(0, node_test_1.test)('reserved terms catch authority/impersonation, leetspeak included', () => {
    for (const bad of [
        'Admin', 'ADMIN', 'admin of pain', 'The Moderator', 'server first',
        'Hokage', 'kage', 'GM', 'Official Support', 'S3rver F1rst', '4dmin',
        'Game Master', 'hall of legends',
    ]) {
        strict_1.default.equal((0, _text_moderation_js_1.hasReservedTitleTerm)(bad), true, `should reserve: ${bad}`);
    }
});
(0, node_test_1.test)('normal player titles pass', () => {
    for (const ok of [
        'Shadow of the Leaf', 'Ramen Enthusiast', 'The Unseen Blade',
        'Moonlight Wanderer', 'Big Toad Energy', 'Kagemusha', // contains "kage" INSIDE a word — boundary rule
    ]) {
        strict_1.default.equal((0, _text_moderation_js_1.hasReservedTitleTerm)(ok), false, `should allow: ${ok}`);
        strict_1.default.equal((0, _text_moderation_js_1.isAllowedCustomTitle)(ok), true, `should allow: ${ok}`);
    }
    strict_1.default.equal((0, _text_moderation_js_1.isAllowedCustomTitle)(''), true, 'clearing is always allowed');
    strict_1.default.equal((0, _text_moderation_js_1.isAllowedCustomTitle)('x'.repeat(200)), false, 'length cap');
});
(0, node_test_1.test)('titles registry covers every legacy + achievement title and flags them', () => {
    strict_1.default.equal(_titles_registry_js_1.ACHIEVEMENT_TITLES.length, 22, 'mirrors TITLE_ACHIEVEMENT_IDS — update both together');
    for (const d of _legacy_defs_js_1.LEGACY_DEFS) {
        strict_1.default.ok((0, _titles_registry_js_1.isKnownEarnedTitle)(d.title), `legacy title missing from registry: ${d.title}`);
    }
    strict_1.default.ok((0, _titles_registry_js_1.isKnownEarnedTitle)('Season Champion'));
    strict_1.default.ok((0, _titles_registry_js_1.isKnownEarnedTitle)('  season champion  '), 'case/space-insensitive');
    strict_1.default.ok((0, _titles_registry_js_1.isKnownEarnedTitle)('Herald of the Mythic Age'), 'era trigger title registered');
    strict_1.default.equal((0, _titles_registry_js_1.isKnownEarnedTitle)('Ramen Enthusiast'), false);
    // Registry sanity: no earned title trips the reserved filter EXCEPT via
    // ownership (owned titles bypass it in the sanitizer).
    strict_1.default.ok(_titles_registry_js_1.KNOWN_EARNED_TITLES.size >= 120, 'legacy(100) + achievements(22) + era titles');
});
