import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTOR_EXITS, SECTOR_ROAD_PAIRS, NON_WALKABLE_SECTORS, sectorExitById, sectorExits } from '../shared/sector-links.js';
import { WILD_SECTOR_IDS } from '../shared/sector-geo.js';

test('sector roads cover the whole standard world with reciprocal bounded exits', () => {
    // 82 pre-reorg roads remapped + the approved Upper Terraces ↔ Canal Heart
    // link + the 12 roads that attached the 2026-07-29 expansion (61-66).
    assert.equal(SECTOR_ROAD_PAIRS.length, 95);
    assert.equal(SECTOR_EXITS.length, SECTOR_ROAD_PAIRS.length * 2);

    for (const sector of WILD_SECTOR_IDS) {
        const exits = sectorExits(sector);
        if (NON_WALKABLE_SECTORS.includes(sector)) {
            assert.equal(exits.length, 0, `map-travel-only sector ${sector} has no roads`);
            continue;
        }
        assert.ok(exits.length >= 2 && exits.length <= 5, `sector ${sector} has ${exits.length} exits`);
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

    // Crossing a seam must not slide the player sideways. A lane is the
    // cross-axis coordinate of a boundary tile — the COLUMN on a north/south
    // exit, the ROW on an east/west one — and both ends of a road are assigned
    // the same lane, so the lane you leave on is the lane you arrive on. This
    // regressed once: lanes were handed out per (sector, edge), so a south
    // crossing left column 5 and arrived at column 4.
    for (const exit of SECTOR_EXITS) {
        const vertical = exit.direction === 'north' || exit.direction === 'south';
        const leaveLane = vertical ? exit.tile % 12 : Math.floor(exit.tile / 12);
        const arriveLane = vertical ? exit.destinationTile % 12 : Math.floor(exit.destinationTile / 12);
        assert.equal(arriveLane, leaveLane, `${exit.id} drifts lane ${leaveLane} -> ${arriveLane}`);
    }

    // Corner lanes would alias two directions onto one tile (north lane 0 and
    // west lane 0 are both tile 0), which is why LANE_PREFERENCE omits 0 and 11.
    for (const exit of SECTOR_EXITS) {
        const lane = exit.direction === 'north' || exit.direction === 'south'
            ? exit.tile % 12
            : Math.floor(exit.tile / 12);
        assert.ok(lane >= 1 && lane <= 10, `${exit.id} sits on corner lane ${lane}`);
    }

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
    assert.equal(reached.size, WILD_SECTOR_IDS.length, 'every walkable sector is connected by roads');
});
