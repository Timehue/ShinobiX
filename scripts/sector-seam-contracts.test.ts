import assert from 'node:assert/strict';
import test from 'node:test';
import { SECTOR_EXITS } from '../shared/sector-links.js';
import { sectorSeamContracts } from './sector-seam-contracts.mjs';

test('every connecting road has reciprocal width, material and biome transition instructions', () => {
    for (const exit of SECTOR_EXITS) {
        const a = sectorSeamContracts(exit.sector).find(s => s.destination === exit.destinationSector)!;
        const b = sectorSeamContracts(exit.destinationSector).find(s => s.destination === exit.sector)!;
        assert.equal(a.road, b.road);
        assert.equal(a.lane, b.lane);
        assert.equal(a.width, b.width);
        assert.equal(a.surface, b.surface);
        assert.deepEqual(a.regions, b.regions);
        assert.equal(a.transition, b.transition);
        assert.equal(a.destinationTile, exit.destinationTile);
    }
});
