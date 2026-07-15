import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTOR_EXITS, SECTOR_ROAD_PAIRS, sectorExitById, sectorExits } from '../shared/sector-links.js';

test('sector roads cover the whole standard world with reciprocal bounded exits', () => {
    assert.equal(SECTOR_ROAD_PAIRS.length, 82);
    assert.equal(SECTOR_EXITS.length, SECTOR_ROAD_PAIRS.length * 2);

    for (let sector = 1; sector <= 60; sector += 1) {
        const exits = sectorExits(sector);
        assert.ok(exits.length >= 2 && exits.length <= 4, `sector ${sector} has ${exits.length} exits`);
        assert.equal(new Set(exits.map((exit) => exit.tile)).size, exits.length, `sector ${sector} exit tiles are unique`);
        for (const exit of exits) {
            assert.ok(exit.tile >= 0 && exit.tile < 144);
            assert.ok(exit.destinationTile >= 0 && exit.destinationTile < 144);
            const reverse = sectorExitById(exit.destinationSector, exit.destinationExitId);
            assert.ok(reverse, `missing reverse for ${exit.id}`);
            assert.equal(reverse!.destinationSector, sector);
            assert.equal(reverse!.destinationExitId, exit.id);
        }
    }

    assert.equal(sectorExits(99).length, 0);

    const reached = new Set<number>([1]);
    const queue = [1];
    while (queue.length) {
        const sector = queue.shift()!;
        for (const exit of sectorExits(sector)) {
            if (reached.has(exit.destinationSector)) continue;
            reached.add(exit.destinationSector);
            queue.push(exit.destinationSector);
        }
    }
    assert.equal(reached.size, 60, 'all standard sectors are connected by roads');
});
