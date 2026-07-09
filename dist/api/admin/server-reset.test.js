"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/*
 * Reset-coverage guard: the full server reset must wipe the story-rebuild
 * keys with the world they belong to. A stale `story:<player>` record would
 * hand a pre-reset player's lane tally and interlude history to whoever
 * re-registers that name; a surviving `hall:nx:kage-first-liberation:*`
 * dedup would make the new era's first liberator seat silently (no
 * announcement, no Hall entry). Protected accounts keep their saves, so
 * they must keep their story records too — wiping one side desyncs them.
 */
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const server_reset_js_1 = require("./server-reset.js");
(0, node_test_1.test)('full reset wipes story records, announcements, and first-only dedup keys', () => {
    for (const pattern of ['story:*', 'game:announcements', 'game:announcements-seq', 'hall:nx:*', 'village:kage:*']) {
        strict_1.default.ok(server_reset_js_1.WIPE_PATTERNS.includes(pattern), `WIPE_PATTERNS must include ${pattern}`);
    }
});
(0, node_test_1.test)('protected accounts keep save, auth, AND story record together', () => {
    strict_1.default.equal((0, server_reset_js_1.isProtectedKey)('save:rill'), true);
    strict_1.default.equal((0, server_reset_js_1.isProtectedKey)('auth:rill'), true);
    strict_1.default.equal((0, server_reset_js_1.isProtectedKey)('story:rill'), true);
    // Ordinary players are wiped clean on all three.
    strict_1.default.equal((0, server_reset_js_1.isProtectedKey)('save:someplayer'), false);
    strict_1.default.equal((0, server_reset_js_1.isProtectedKey)('story:someplayer'), false);
});
