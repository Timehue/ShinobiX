"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _save_version_js_1 = require("./_save-version.js");
(0, node_test_1.describe)('parseBaseSaveVersion', () => {
    (0, node_test_1.it)('returns the number for a valid finite version (including 0)', () => {
        node_assert_1.strict.equal((0, _save_version_js_1.parseBaseSaveVersion)(0), 0);
        node_assert_1.strict.equal((0, _save_version_js_1.parseBaseSaveVersion)(7), 7);
        node_assert_1.strict.equal((0, _save_version_js_1.parseBaseSaveVersion)(123456), 123456);
    });
    (0, node_test_1.it)('returns null for absent / non-finite / wrong-type values (old client)', () => {
        node_assert_1.strict.equal((0, _save_version_js_1.parseBaseSaveVersion)(undefined), null);
        node_assert_1.strict.equal((0, _save_version_js_1.parseBaseSaveVersion)(null), null);
        node_assert_1.strict.equal((0, _save_version_js_1.parseBaseSaveVersion)('5'), null); // string, not number
        node_assert_1.strict.equal((0, _save_version_js_1.parseBaseSaveVersion)(NaN), null);
        node_assert_1.strict.equal((0, _save_version_js_1.parseBaseSaveVersion)(Infinity), null);
        node_assert_1.strict.equal((0, _save_version_js_1.parseBaseSaveVersion)(-Infinity), null);
        node_assert_1.strict.equal((0, _save_version_js_1.parseBaseSaveVersion)({}), null);
    });
    (0, node_test_1.it)('does not reinterpret a present version as missing (guard invariant)', () => {
        // The 409 guard fires only when parse !== null AND version < stored.
        // A present version of 0 must stay 0 (not be treated as "missing").
        node_assert_1.strict.notEqual((0, _save_version_js_1.parseBaseSaveVersion)(0), null);
    });
});
(0, node_test_1.describe)('saveVersionTelemetryKey', () => {
    (0, node_test_1.it)('keys by UTC date only (strips the time component)', () => {
        node_assert_1.strict.equal((0, _save_version_js_1.saveVersionTelemetryKey)('2026-06-01T13:45:09.123Z'), 'telemetry:save-noversion:2026-06-01');
    });
    (0, node_test_1.it)('is stable across times on the same day', () => {
        const a = (0, _save_version_js_1.saveVersionTelemetryKey)('2026-06-01T00:00:00.000Z');
        const b = (0, _save_version_js_1.saveVersionTelemetryKey)('2026-06-01T23:59:59.999Z');
        node_assert_1.strict.equal(a, b);
    });
});
