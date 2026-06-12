import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    clampAuditValue,
    appendCapped,
    auditKey,
    MAX_SUMMARY_LEN,
    type AuditEntry,
} from './_audit.js';

describe('auditKey', () => {
    it('namespaces by domain', () => {
        assert.equal(auditKey('content'), 'audit:content');
        assert.equal(auditKey('reward'), 'audit:reward');
        assert.equal(auditKey('sector'), 'audit:sector');
        assert.equal(auditKey('combat'), 'audit:combat');
    });
});

describe('clampAuditValue (pure)', () => {
    it('passes through null/undefined', () => {
        assert.equal(clampAuditValue(undefined), undefined);
        assert.equal(clampAuditValue(null), null);
    });

    it('leaves short strings and small objects untouched', () => {
        assert.equal(clampAuditValue('hello'), 'hello');
        const obj = { name: 'Fireball', ap: 60 };
        assert.deepEqual(clampAuditValue(obj), obj);
    });

    it('truncates an oversized string', () => {
        const big = 'x'.repeat(MAX_SUMMARY_LEN + 500);
        const out = clampAuditValue(big) as string;
        assert.ok(out.length < big.length);
        assert.ok(out.endsWith('…[truncated]'));
    });

    it('truncates an oversized object to a string marker', () => {
        const big = { blob: 'y'.repeat(MAX_SUMMARY_LEN + 500) };
        const out = clampAuditValue(big);
        assert.equal(typeof out, 'string');
        assert.ok((out as string).endsWith('…[truncated]'));
    });

    it('handles unserializable (circular) input without throwing', () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        assert.equal(clampAuditValue(circular), '[unserializable]');
    });
});

describe('appendCapped (pure)', () => {
    const entry = (ts: number): AuditEntry => ({ ts, actor: 'admin', domain: 'content', action: 'edit' });

    it('prepends the newest entry (newest-first ordering)', () => {
        const out = appendCapped([entry(1), entry(2)], entry(3));
        assert.deepEqual(out.map((e) => e.ts), [3, 1, 2]);
    });

    it('caps the list to max, dropping the oldest', () => {
        const existing = Array.from({ length: 5 }, (_, i) => entry(i));
        const out = appendCapped(existing, entry(99), 3);
        assert.equal(out.length, 3);
        assert.deepEqual(out.map((e) => e.ts), [99, 0, 1]);
    });

    it('tolerates a non-array existing value', () => {
        const out = appendCapped(undefined as unknown as AuditEntry[], entry(1));
        assert.deepEqual(out.map((e) => e.ts), [1]);
    });
});
