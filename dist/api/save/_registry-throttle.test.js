"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _registry_throttle_js_1 = require("./_registry-throttle.js");
const REFRESH = 60_000;
const ID = { name: 'Akira', level: 5, village: 'Stormveil', specialty: 'Ninjutsu' };
const base = {
    isClanSave: false,
    existingChar: { name: 'Akira', level: 5, village: 'Stormveil', specialty: 'Ninjutsu' },
    next: ID,
    prevRegistryAt: 1_000_000,
    now: 1_000_000 + 1_000, // 1s later — within the refresh window
    refreshMs: REFRESH,
};
(0, node_test_1.describe)('shouldWriteRegistry', () => {
    (0, node_test_1.it)('always writes for a brand-new save (no existing character)', () => {
        node_assert_1.strict.equal((0, _registry_throttle_js_1.shouldWriteRegistry)({ ...base, existingChar: null }), true);
    });
    (0, node_test_1.it)('always writes for clan saves', () => {
        node_assert_1.strict.equal((0, _registry_throttle_js_1.shouldWriteRegistry)({ ...base, isClanSave: true }), true);
    });
    (0, node_test_1.it)('skips a rapid re-save when nothing roster-visible changed', () => {
        node_assert_1.strict.equal((0, _registry_throttle_js_1.shouldWriteRegistry)(base), false);
    });
    (0, node_test_1.it)('writes when level changed (level-up must reach the roster)', () => {
        node_assert_1.strict.equal((0, _registry_throttle_js_1.shouldWriteRegistry)({ ...base, next: { ...ID, level: 6 } }), true);
    });
    (0, node_test_1.it)('writes when village changed', () => {
        node_assert_1.strict.equal((0, _registry_throttle_js_1.shouldWriteRegistry)({ ...base, next: { ...ID, village: 'Emberfall' } }), true);
    });
    (0, node_test_1.it)('writes when specialty changed', () => {
        node_assert_1.strict.equal((0, _registry_throttle_js_1.shouldWriteRegistry)({ ...base, next: { ...ID, specialty: 'Taijutsu' } }), true);
    });
    (0, node_test_1.it)('writes when display name changed', () => {
        node_assert_1.strict.equal((0, _registry_throttle_js_1.shouldWriteRegistry)({ ...base, next: { ...ID, name: 'Akira II' } }), true);
    });
    (0, node_test_1.it)('refreshes lastSeen once the cached stamp drifts past refreshMs', () => {
        // 61s after the last registry write, with no identity change → refresh.
        node_assert_1.strict.equal((0, _registry_throttle_js_1.shouldWriteRegistry)({ ...base, now: base.prevRegistryAt + REFRESH + 1 }), true);
    });
    (0, node_test_1.it)('does not refresh exactly at the boundary (strictly greater than)', () => {
        node_assert_1.strict.equal((0, _registry_throttle_js_1.shouldWriteRegistry)({ ...base, now: base.prevRegistryAt + REFRESH }), false);
    });
    (0, node_test_1.it)('treats a never-stamped entry (prevRegistryAt 0) as stale → writes', () => {
        node_assert_1.strict.equal((0, _registry_throttle_js_1.shouldWriteRegistry)({ ...base, prevRegistryAt: 0 }), true);
    });
    (0, node_test_1.it)('tolerates missing/absent fields on the existing character', () => {
        // A legacy save missing village/specialty should be seen as "changed"
        // against a populated incoming identity, so the registry gets corrected.
        node_assert_1.strict.equal((0, _registry_throttle_js_1.shouldWriteRegistry)({ ...base, existingChar: { name: 'Akira', level: 5 } }), true);
    });
});
