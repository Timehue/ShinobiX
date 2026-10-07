import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTOR_FLOOR_LAYOUTS } from '../shared/sector-floor-layouts.js';
import { validateSectorLayouts, validateSpecialSectorLayout } from './validate-sector-layouts.mjs';

test('admitted world geometry has connected gates, clear approaches and coherent water', () => {
    // A completely empty registry is the safe legacy rollout state.
    if (Object.keys(SECTOR_FLOOR_LAYOUTS).length) validateSectorLayouts(SECTOR_FLOOR_LAYOUTS);
});

test('the separate arena rejects disconnected lava and a blocked stronghold entrance', () => {
    const arena = SECTOR_FLOOR_LAYOUTS[99]!;
    assert.equal(validateSpecialSectorLayout(arena), 1);
    const disconnected = structuredClone(arena);
    disconnected.mask = [...disconnected.mask];
    (disconnected.mask as string[])[8] = '.' + disconnected.mask[8]!.slice(1);
    assert.throws(() => validateSpecialSectorLayout(disconnected), /continuous channel/);
    const entrance = structuredClone(arena);
    entrance.sites.stronghold!.approach = 29;
    assert.throws(() => validateSpecialSectorLayout(entrance));
});
