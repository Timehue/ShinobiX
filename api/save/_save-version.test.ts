import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseBaseSaveVersion, saveVersionTelemetryKey, isVersionlessPlayerSave, bumpSaveVersion } from './_save-version.js';

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

describe('isVersionlessPlayerSave (#14 step 2 reject condition)', () => {
    it('rejects a non-clan player save with no version stamp (old client)', () => {
        assert.equal(isVersionlessPlayerSave(false, 'akira', null), true);
    });

    it('allows a player save that carries a numeric version (incl. 0)', () => {
        assert.equal(isVersionlessPlayerSave(false, 'akira', 0), false);
        assert.equal(isVersionlessPlayerSave(false, 'akira', 7), false);
    });

    it('exempts admin saves (identityName === null), incl. cross-player grants', () => {
        assert.equal(isVersionlessPlayerSave(false, null, null), false);
    });

    it('exempts clan saves regardless of version', () => {
        assert.equal(isVersionlessPlayerSave(true, 'akira', null), false);
        assert.equal(isVersionlessPlayerSave(true, null, null), false);
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

describe('bumpSaveVersion (server-credit optimistic-concurrency bump)', () => {
    it('increments _saveVersion by 1 from the stored value', () => {
        const rec = { _saveVersion: 4, character: { ryo: 100 } };
        bumpSaveVersion(rec);
        assert.equal(rec._saveVersion, 5);
    });

    it('treats an absent _saveVersion as 0 → first bump is 1', () => {
        const rec: Record<string, unknown> = { character: { ryo: 0 } };
        bumpSaveVersion(rec);
        assert.equal(rec._saveVersion, 1);
    });

    it('stamps a numeric _saveAt and returns the same object reference', () => {
        const rec = { _saveVersion: 0 } as Record<string, unknown>;
        const out = bumpSaveVersion(rec);
        assert.equal(out, rec);
        assert.equal(typeof rec._saveAt, 'number');
    });

    it('forces a stale-tab 409: post-bump version exceeds the tab\'s base version', () => {
        // A client tab loaded at version 3; a server credit then bumps the stored
        // record. The next autosave echoes _baseSaveVersion:3, which must now be
        // BELOW stored → the save handler 409s and the client refetches the credit.
        const stored = { _saveVersion: 3, character: {} };
        bumpSaveVersion(stored);
        const tabBaseVersion = 3;
        assert.ok(tabBaseVersion < Number(stored._saveVersion), 'stale tab must 409 after a credit');
    });
});
