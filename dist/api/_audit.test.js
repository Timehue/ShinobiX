"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _audit_js_1 = require("./_audit.js");
(0, node_test_1.describe)('auditKey', () => {
    (0, node_test_1.it)('namespaces by domain', () => {
        node_assert_1.strict.equal((0, _audit_js_1.auditKey)('content'), 'audit:content');
        node_assert_1.strict.equal((0, _audit_js_1.auditKey)('reward'), 'audit:reward');
        node_assert_1.strict.equal((0, _audit_js_1.auditKey)('sector'), 'audit:sector');
        node_assert_1.strict.equal((0, _audit_js_1.auditKey)('combat'), 'audit:combat');
    });
});
(0, node_test_1.describe)('clampAuditValue (pure)', () => {
    (0, node_test_1.it)('passes through null/undefined', () => {
        node_assert_1.strict.equal((0, _audit_js_1.clampAuditValue)(undefined), undefined);
        node_assert_1.strict.equal((0, _audit_js_1.clampAuditValue)(null), null);
    });
    (0, node_test_1.it)('leaves short strings and small objects untouched', () => {
        node_assert_1.strict.equal((0, _audit_js_1.clampAuditValue)('hello'), 'hello');
        const obj = { name: 'Fireball', ap: 60 };
        node_assert_1.strict.deepEqual((0, _audit_js_1.clampAuditValue)(obj), obj);
    });
    (0, node_test_1.it)('truncates an oversized string', () => {
        const big = 'x'.repeat(_audit_js_1.MAX_SUMMARY_LEN + 500);
        const out = (0, _audit_js_1.clampAuditValue)(big);
        node_assert_1.strict.ok(out.length < big.length);
        node_assert_1.strict.ok(out.endsWith('…[truncated]'));
    });
    (0, node_test_1.it)('truncates an oversized object to a string marker', () => {
        const big = { blob: 'y'.repeat(_audit_js_1.MAX_SUMMARY_LEN + 500) };
        const out = (0, _audit_js_1.clampAuditValue)(big);
        node_assert_1.strict.equal(typeof out, 'string');
        node_assert_1.strict.ok(out.endsWith('…[truncated]'));
    });
    (0, node_test_1.it)('handles unserializable (circular) input without throwing', () => {
        const circular = {};
        circular.self = circular;
        node_assert_1.strict.equal((0, _audit_js_1.clampAuditValue)(circular), '[unserializable]');
    });
});
(0, node_test_1.describe)('appendCapped (pure)', () => {
    const entry = (ts) => ({ ts, actor: 'admin', domain: 'content', action: 'edit' });
    (0, node_test_1.it)('prepends the newest entry (newest-first ordering)', () => {
        const out = (0, _audit_js_1.appendCapped)([entry(1), entry(2)], entry(3));
        node_assert_1.strict.deepEqual(out.map((e) => e.ts), [3, 1, 2]);
    });
    (0, node_test_1.it)('caps the list to max, dropping the oldest', () => {
        const existing = Array.from({ length: 5 }, (_, i) => entry(i));
        const out = (0, _audit_js_1.appendCapped)(existing, entry(99), 3);
        node_assert_1.strict.equal(out.length, 3);
        node_assert_1.strict.deepEqual(out.map((e) => e.ts), [99, 0, 1]);
    });
    (0, node_test_1.it)('tolerates a non-array existing value', () => {
        const out = (0, _audit_js_1.appendCapped)(undefined, entry(1));
        node_assert_1.strict.deepEqual(out.map((e) => e.ts), [1]);
    });
});
