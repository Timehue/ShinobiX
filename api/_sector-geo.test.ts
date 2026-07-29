import test from 'node:test';
import assert from 'node:assert/strict';
import {
    SECTOR_PLACES, OLD_TO_NEW_SECTOR, NEW_TO_OLD_SECTOR, remapLegacySector,
    sectorArtKey, sectorBiomeOf, sectorName, FESTIVAL_SECTOR, VILLAGE_OUTSKIRTS,
    OUTSKIRTS_SECTORS, CASTLE_SECTORS,
} from '../shared/sector-geo.js';
import { SECTOR_POINTS, SECTOR_ROAD_PAIRS, SECTOR_EXITS, sectorExits } from '../shared/sector-links.js';
import { SHRINE_DEFS } from '../shared/shrines.js';
import { HOME_SECTORS, CENTRAL_SECTORS, NON_WAR_SPECIAL_SECTORS } from './_war-map-sectors.js';

/*
 * The 2026-07 renumbering: every PLACE from the pre-reorg world must survive
 * with its art, shrine, war membership, and roads intact — only numbers moved.
 * These tests pin the migration against a frozen snapshot of the OLD world.
 */

// ── Frozen OLD-world snapshot (pre-renumbering; do not edit) ─────────────────
const OLD_ROAD_PAIRS: ReadonlyArray<readonly [number, number]> = [
    [1, 9], [1, 10], [1, 57], [1, 59], [2, 3], [2, 7], [3, 47], [3, 51], [3, 55], [4, 5], [4, 15],
    [5, 6], [5, 8], [6, 8], [7, 45], [7, 52], [8, 11], [9, 12], [9, 19], [9, 59], [10, 55], [11, 16],
    [11, 17], [12, 18], [12, 60], [13, 14], [13, 18], [13, 35], [14, 17], [14, 18], [15, 19], [16, 17],
    [16, 19], [17, 18], [20, 30], [20, 33], [20, 35], [21, 22], [21, 27], [22, 34], [23, 25], [23, 28],
    [23, 56], [24, 32], [24, 33], [25, 43], [25, 44], [26, 27], [26, 31], [27, 31], [27, 32], [28, 29],
    [28, 34], [29, 30], [30, 60], [36, 37], [36, 38], [37, 39], [37, 42], [38, 42], [39, 40], [40, 41],
    [41, 42], [41, 43], [41, 44], [44, 45], [46, 53], [46, 54], [47, 51], [47, 53], [48, 49], [48, 50],
    [49, 50], [49, 54], [50, 54], [51, 52], [56, 57], [56, 58], [57, 58], [58, 59], [58, 60], [59, 60],
];
// The one deliberately NEW road (old numbering: Upper Terraces 22 ↔ Canal Heart 27).
const ADDED_ROADS_OLD: ReadonlyArray<readonly [number, number]> = [[22, 27]];

const OLD_HOME_SECTORS: Record<string, readonly number[]> = {
    'Moonshadow Village': [11, 19, 15, 4, 5, 6, 16, 8],
    'Stormveil Village': [31, 21, 22, 34, 24, 32, 26, 27],
    'Ashen Leaf Village': [38, 36, 37, 39, 40, 41, 42, 43],
    'Frostfang Village': [47, 46, 48, 49, 50, 51, 53, 54],
};
const OLD_CENTRAL = [56, 57, 58, 59, 60];
const OLD_NON_WAR_SPECIAL = [1, 35, 52, 57, 99];
const OLD_SHRINE_SECTORS: Record<string, number> = {
    heartwood: 42, tide: 34, frostveil: 53, moonwell: 16, hollowgate: 13, ancients: 10,
};
const OLD_OUTSKIRTS: Record<string, number> = {
    'Stormveil Village': 31, 'Ashen Leaf Village': 38, 'Frostfang Village': 47, 'Moonshadow Village': 11,
};
const OLD_FESTIVAL_SECTOR = 35;

const WILD_IDS = Array.from({ length: 60 }, (_, i) => i + 1);
const norm = (a: number, b: number): string => `${Math.min(a, b)}-${Math.max(a, b)}`;

test('registry covers exactly sectors 1-60 + 99 with unique names and a bijective art mapping', () => {
    const ids = SECTOR_PLACES.map((p) => p.id).sort((a, b) => a - b);
    assert.deepEqual(ids, [...WILD_IDS, 99]);
    const artKeys = SECTOR_PLACES.map((p) => p.artKey).sort((a, b) => a - b);
    assert.deepEqual(artKeys, [...WILD_IDS, 99], 'artKeys are a permutation of the old ids');
    const names = new Set(SECTOR_PLACES.map((p) => p.name));
    assert.equal(names.size, SECTOR_PLACES.length, 'sector names are unique');
    for (const id of WILD_IDS) {
        assert.equal(OLD_TO_NEW_SECTOR[NEW_TO_OLD_SECTOR[id]], id, `mapping bijective at ${id}`);
    }
});

test('remapLegacySector: identity for 0/99, total and bijective over 1-60, safe fallback', () => {
    assert.equal(remapLegacySector(0), 0);
    assert.equal(remapLegacySector(99), 99);
    const image = new Set(WILD_IDS.map((s) => remapLegacySector(s)));
    assert.equal(image.size, 60);
    for (const s of image) assert.ok(s >= 1 && s <= 60);
    assert.equal(remapLegacySector(400), 0, 'unknown sectors fall back to the village');
});

test('points and roads: one point per sector, connected graph, degree 2-5, exits reciprocal', () => {
    const pointIds = SECTOR_POINTS.map((p) => p.id).sort((a, b) => a - b);
    assert.deepEqual(pointIds, [...WILD_IDS, 99]);

    const adj = new Map<number, number[]>(WILD_IDS.map((id) => [id, []]));
    for (const [a, b] of SECTOR_ROAD_PAIRS) {
        assert.notEqual(a, b);
        assert.ok(a !== 99 && b !== 99, 'sector 99 stays map-travel-only');
        adj.get(a)!.push(b);
        adj.get(b)!.push(a);
    }
    for (const [id, links] of adj) {
        assert.ok(links.length >= 2 && links.length <= 5, `sector ${id} has ${links.length} roads (want 2-5)`);
        assert.equal(new Set(links).size, links.length, `sector ${id} has duplicate roads`);
    }
    const seen = new Set<number>([1]);
    const queue = [1];
    while (queue.length) {
        const cur = queue.shift()!;
        for (const nx of adj.get(cur) ?? []) if (!seen.has(nx)) { seen.add(nx); queue.push(nx); }
    }
    assert.equal(seen.size, 60, 'road graph is connected across all 60 sectors');

    for (const exit of SECTOR_EXITS) {
        const reverse = sectorExits(exit.destinationSector).find((e) => e.destinationSector === exit.sector);
        assert.ok(reverse, `exit ${exit.id} has a reciprocal`);
        assert.equal(exit.destinationExitId, reverse!.id);
    }
});

test('renumbering preserved every road (and added only the approved Stormveil link)', () => {
    const expected = new Set<string>();
    for (const [a, b] of [...OLD_ROAD_PAIRS, ...ADDED_ROADS_OLD]) {
        expected.add(norm(OLD_TO_NEW_SECTOR[a]!, OLD_TO_NEW_SECTOR[b]!));
    }
    const actual = new Set(SECTOR_ROAD_PAIRS.map(([a, b]) => norm(a, b)));
    assert.deepEqual([...actual].sort(), [...expected].sort());
});

test('war-map home sectors are the same PLACES as before the renumbering', () => {
    for (const [village, oldSet] of Object.entries(OLD_HOME_SECTORS)) {
        const mapped = oldSet.map((s) => OLD_TO_NEW_SECTOR[s]!).sort((a, b) => a - b);
        const current = [...(HOME_SECTORS as Record<string, readonly number[]>)[village]].sort((a, b) => a - b);
        assert.deepEqual(current, mapped, `${village} home sectors`);
    }
    assert.deepEqual(
        [...CENTRAL_SECTORS].sort((a, b) => a - b),
        OLD_CENTRAL.map((s) => OLD_TO_NEW_SECTOR[s]!).sort((a, b) => a - b),
    );
    assert.deepEqual(
        [...NON_WAR_SPECIAL_SECTORS].sort((a, b) => a - b),
        OLD_NON_WAR_SPECIAL.map((s) => (s === 99 ? 99 : OLD_TO_NEW_SECTOR[s]!)).sort((a, b) => a - b),
    );
});

test('shrines stand in the same places (same art floor, same KV ids)', () => {
    assert.equal(SHRINE_DEFS.length, 6);
    for (const def of SHRINE_DEFS) {
        const oldSector = OLD_SHRINE_SECTORS[def.id];
        assert.ok(oldSector, `shrine ${def.id} existed before the renumbering`);
        assert.equal(def.sector, OLD_TO_NEW_SECTOR[oldSector], `shrine ${def.id} sector remapped`);
        assert.equal(sectorArtKey(def.sector), oldSector, `shrine ${def.id} keeps its tuned floor art`);
    }
});

test('outskirts, festival, and castle anchors remapped in lockstep', () => {
    for (const [village, oldSector] of Object.entries(OLD_OUTSKIRTS)) {
        assert.equal(VILLAGE_OUTSKIRTS[village], OLD_TO_NEW_SECTOR[oldSector]);
    }
    assert.deepEqual([...OUTSKIRTS_SECTORS].sort((a, b) => a - b), Object.values(VILLAGE_OUTSKIRTS).sort((a, b) => a - b));
    assert.equal(FESTIVAL_SECTOR, OLD_TO_NEW_SECTOR[OLD_FESTIVAL_SECTOR]);
    assert.deepEqual(
        [...CASTLE_SECTORS].sort((a, b) => a - b),
        [1, 56, 57, 58, 59, 60].map((s) => OLD_TO_NEW_SECTOR[s]!).sort((a, b) => a - b),
    );
});

test('region blocks are contiguous and biomes stay in the 5-biome vocabulary', () => {
    const blocks: Record<string, [number, number]> = {
        stormveil: [1, 8], ashenleaf: [9, 16], moonshadow: [17, 25], frostfang: [26, 33],
        frostborder: [34, 35], midlands: [36, 45], castle: [46, 51], festival: [52, 54],
        hollowroad: [55, 57], lavafront: [58, 60],
    };
    for (const p of SECTOR_PLACES) {
        if (p.id === 99) { assert.equal(p.region, 'deathsgate'); continue; }
        const [lo, hi] = blocks[p.region]!;
        assert.ok(p.id >= lo && p.id <= hi, `${p.name} (${p.id}) inside its ${p.region} block`);
        assert.ok(['shadow', 'forest', 'volcano', 'snow', 'central'].includes(p.biome));
    }
    assert.equal(sectorBiomeOf(99), 'volcano');
    assert.equal(sectorBiomeOf(0), 'central');
    assert.equal(sectorName(8), 'Canal Heart');
    assert.equal(sectorName(15), 'Heartwood Shrine');
});
