"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _legacy_js_1 = require("./_legacy.js");
(0, node_test_1.describe)('legacy stat training migration', () => {
    (0, node_test_1.it)('seals a bounded, tokenless stored session', () => {
        const endsAt = 2_000_000_000_000;
        const out = (0, _legacy_js_1.parseLegacyTraining)({ stat: 'strength', endsAt, durationMs: 60 * 60 * 1000, statGain: 22, xp: 70 });
        node_assert_1.strict.equal(out?.stat, 'strength');
        node_assert_1.strict.equal(out?.startedAt, endsAt - 60 * 60 * 1000);
        node_assert_1.strict.match(out?.token ?? '', /^legacy[A-Za-z0-9]+$/);
    });
    (0, node_test_1.it)('rejects token sessions, unknown durations, stats, and excessive grants', () => {
        const base = { stat: 'strength', endsAt: 2_000_000_000_000, durationMs: 60 * 60 * 1000, statGain: 22, xp: 70 };
        node_assert_1.strict.equal((0, _legacy_js_1.parseLegacyTraining)({ ...base, token: 'sealed' }), null);
        node_assert_1.strict.equal((0, _legacy_js_1.parseLegacyTraining)({ ...base, durationMs: 1234 }), null);
        node_assert_1.strict.equal((0, _legacy_js_1.parseLegacyTraining)({ ...base, stat: 'adminPower' }), null);
        node_assert_1.strict.equal((0, _legacy_js_1.parseLegacyTraining)({ ...base, statGain: 301 }), null);
        node_assert_1.strict.equal((0, _legacy_js_1.parseLegacyTraining)({ ...base, xp: 751 }), null);
    });
});
