import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseBaseSaveVersion, saveVersionTelemetryKey } from './_save-version.js';

describe('parseBaseSaveVersion', () => {
    it('returns the number for a valid finite version (including 0)', () => {
        assert.equal(parseBaseSaveVersion(0), 0);
        assert.equal(parseBaseSaveVersion(7), 7);
        assert.equal(parseBaseSaveVersion(123456), 123456);
    });

    it('returns null for absent / non-finite / wrong-type values (old client)', () => {
        assert.equal(parseBaseSaveVersion(undefined), null);
        assert.equal(parseBaseSaveVersion(null), null);
        assert.equal(parseBaseSaveVersion('5'), null);       // string, not number
        assert.equal(parseBaseSaveVersion(NaN), null);
        assert.equal(parseBaseSaveVersion(Infinity), null);
        assert.equal(parseBaseSaveVersion(-Infinity), null);
        assert.equal(parseBaseSaveVersion({}), null);
    });

    it('does not reinterpret a present version as missing (guard invariant)', () => {
        // The 409 guard fires only when parse !== null AND version < stored.
        // A present version of 0 must stay 0 (not be treated as "missing").
        assert.notEqual(parseBaseSaveVersion(0), null);
    });
});

describe('saveVersionTelemetryKey', () => {
    it('keys by UTC date only (strips the time component)', () => {
        assert.equal(
            saveVersionTelemetryKey('2026-06-01T13:45:09.123Z'),
            'telemetry:save-noversion:2026-06-01',
        );
    });

    it('is stable across times on the same day', () => {
        const a = saveVersionTelemetryKey('2026-06-01T00:00:00.000Z');
        const b = saveVersionTelemetryKey('2026-06-01T23:59:59.999Z');
        assert.equal(a, b);
    });
});
