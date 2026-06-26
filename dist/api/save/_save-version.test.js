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
(0, node_test_1.describe)('isVersionlessPlayerSave (#14 step 2 reject condition)', () => {
    (0, node_test_1.it)('rejects a non-clan player save with no version stamp (old client)', () => {
        node_assert_1.strict.equal((0, _save_version_js_1.isVersionlessPlayerSave)(false, 'akira', null), true);
    });
    (0, node_test_1.it)('allows a player save that carries a numeric version (incl. 0)', () => {
        node_assert_1.strict.equal((0, _save_version_js_1.isVersionlessPlayerSave)(false, 'akira', 0), false);
        node_assert_1.strict.equal((0, _save_version_js_1.isVersionlessPlayerSave)(false, 'akira', 7), false);
    });
    (0, node_test_1.it)('exempts admin saves (identityName === null), incl. cross-player grants', () => {
        node_assert_1.strict.equal((0, _save_version_js_1.isVersionlessPlayerSave)(false, null, null), false);
    });
    (0, node_test_1.it)('exempts clan saves regardless of version', () => {
        node_assert_1.strict.equal((0, _save_version_js_1.isVersionlessPlayerSave)(true, 'akira', null), false);
        node_assert_1.strict.equal((0, _save_version_js_1.isVersionlessPlayerSave)(true, null, null), false);
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
(0, node_test_1.describe)('bumpSaveVersion (server-credit optimistic-concurrency bump)', () => {
    (0, node_test_1.it)('increments _saveVersion by 1 from the stored value', () => {
        const rec = { _saveVersion: 4, character: { ryo: 100 } };
        (0, _save_version_js_1.bumpSaveVersion)(rec);
        node_assert_1.strict.equal(rec._saveVersion, 5);
    });
    (0, node_test_1.it)('treats an absent _saveVersion as 0 → first bump is 1', () => {
        const rec = { character: { ryo: 0 } };
        (0, _save_version_js_1.bumpSaveVersion)(rec);
        node_assert_1.strict.equal(rec._saveVersion, 1);
    });
    (0, node_test_1.it)('stamps a numeric _saveAt and returns the same object reference', () => {
        const rec = { _saveVersion: 0 };
        const out = (0, _save_version_js_1.bumpSaveVersion)(rec);
        node_assert_1.strict.equal(out, rec);
        node_assert_1.strict.equal(typeof rec._saveAt, 'number');
    });
    (0, node_test_1.it)('forces a stale-tab 409: post-bump version exceeds the tab\'s base version', () => {
        // A client tab loaded at version 3; a server credit then bumps the stored
        // record. The next autosave echoes _baseSaveVersion:3, which must now be
        // BELOW stored → the save handler 409s and the client refetches the credit.
        const stored = { _saveVersion: 3, character: {} };
        (0, _save_version_js_1.bumpSaveVersion)(stored);
        const tabBaseVersion = 3;
        node_assert_1.strict.ok(tabBaseVersion < Number(stored._saveVersion), 'stale tab must 409 after a credit');
    });
});
