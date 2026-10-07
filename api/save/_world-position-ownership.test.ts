import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preserveServerTopLevelFields } from './_sanitize-ledger.js';
import { COMBAT_STRIP_TOPLEVEL_FIELDS, SERVER_LEDGER_TOPLEVEL_FIELDS } from './_state-ownership.js';

test('autosave cannot inject or overwrite the approved server-owned world cursor', () => {
    const stored = { layoutVersion: 'test-layout', from: '9:78', to: '9:79', progress: .5 };
    const forged: Record<string, unknown> = { currentSector: 27, worldPosition: { from: '27:78', to: '27:78', progress: 0 } };
    preserveServerTopLevelFields(forged, { currentSector: 9, worldPosition: stored });
    assert.equal(forged.currentSector, 9); assert.deepEqual(forged.worldPosition, stored);
    const firstSave: Record<string, unknown> = { worldPosition: stored };
    preserveServerTopLevelFields(firstSave, null);
    assert.equal(Object.hasOwn(firstSave, 'worldPosition'), false);
    assert(SERVER_LEDGER_TOPLEVEL_FIELDS.includes('worldPosition'));
    assert(COMBAT_STRIP_TOPLEVEL_FIELDS.includes('worldPosition'));
});
