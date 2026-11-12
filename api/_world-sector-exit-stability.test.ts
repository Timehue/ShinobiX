import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SECTOR_EXITS } from '../shared/sector-links.js';
import { SECTOR_FLOOR_LAYOUTS } from '../shared/sector-floor-layouts.js';
import { sectorArtKey } from '../shared/sector-geo.js';

/*
 * Every accepted floor painting has its road mouths baked into the pixels, and
 * a persisted exit id embeds its direction. So moving a map pin (Death's Gate
 * and the Lavafront moved down for Cinderhold, 2026-11-08) or adding a road
 * must never change an EXISTING exit's id, boundary tile or arrival tile.
 *
 * The fixture is the full exit list as it stood on 2026-11-07, before the move.
 */
const BEFORE: string[] = JSON.parse(readFileSync('api/_world-sector-exits-2026-11-07.json', 'utf8'));

test('every pre-Cinderhold exit keeps its id, tile and arrival tile', () => {
    const now = new Set(SECTOR_EXITS.map((e) => `${e.id}@${e.tile}>${e.destinationTile}`));
    const missing = BEFORE.filter((row) => !now.has(row));
    assert.deepEqual(missing, [], 'a pin move or new road rewired an existing exit');
});

test('every exit added since only touches a sector whose floor paints that road', () => {
    const before = new Set(BEFORE.map((row) => row.split('@')[0]));
    for (const exit of SECTOR_EXITS) {
        if (before.has(exit.id)) continue;
        const painted = SECTOR_FLOOR_LAYOUTS[sectorArtKey(exit.sector)]?.exits ?? [];
        assert.ok(
            painted.some((p) => p.tile === exit.tile && p.direction === exit.direction && p.destination === exit.destinationSector),
            `new exit ${exit.id} has no painted road mouth at tile ${exit.tile}`,
        );
    }
});
