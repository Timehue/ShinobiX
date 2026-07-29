import test from 'node:test';
import assert from 'node:assert/strict';
import {
    SECTOR_PLACES, OLD_TO_NEW_SECTOR, NEW_TO_OLD_SECTOR, remapLegacySector,
    sectorArtKey, sectorBiomeOf, sectorName, FESTIVAL_SECTOR, VILLAGE_OUTSKIRTS,
    OUTSKIRTS_SECTORS, CASTLE_SECTORS, WILD_SECTOR_IDS,
} from '../shared/sector-geo.js';
import { SECTOR_POINTS, SECTOR_ROAD_PAIRS, SECTOR_EXITS, NON_WALKABLE_SECTORS, sectorExits } from '../shared/sector-links.js';
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
// Roads added by the 2026-07-29 expansion, in CURRENT numbering (they touch ids
// that never existed in the old world, so they cannot be expressed in old ids).
// Every one must join a NEW sector to the existing network.
const EXPANSION_ROADS_NEW: ReadonlyArray<readonly [number, number]> = [
    [16, 61], [40, 61], [61, 62], [2, 62], [52, 63], [25, 63],
    [56, 64], [23, 64], [27, 65], [31, 65], [60, 66], [33, 66],
];
// Nothing has been removed from the old road set. (A 2026-07-29 change briefly
// took the Hollow Temple off the graph on the theory that it was the Hollow Gate
// POI; it isn't — the Hollow Gate is a landmark crest that opens the rift menu —
// so those four roads were restored.)
const REMOVED_ROADS_OLD: ReadonlyArray<readonly [number, number]> = [];

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

// The 60 sectors that existed before the 2026-07-29 expansion. The old↔new
// mapping and the frozen road/shrine/war snapshots are all about THESE.
const LEGACY_IDS = Array.from({ length: 60 }, (_, i) => i + 1);
// Every sector on the map today (1..MAX_WILD_SECTOR).
const WILD_IDS = [...WILD_SECTOR_IDS];
const NEW_IDS = WILD_IDS.filter((id) => !LEGACY_IDS.includes(id));
const norm = (a: number, b: number): string => `${Math.min(a, b)}-${Math.max(a, b)}`;

test('registry covers every sector + 99, with unique names and art the originals still own', () => {
    const ids = SECTOR_PLACES.map((p) => p.id).sort((a, b) => a - b);
    assert.deepEqual(ids, [...WILD_IDS, 99]);
    // The 61 ORIGINAL sectors must still hold a bijection onto the art files —
    // no original sector may lose or share away its tuned floor.
    const legacyArt = SECTOR_PLACES
        .filter((p) => p.id === 99 || LEGACY_IDS.includes(p.id))
        .map((p) => p.artKey)
        .sort((a, b) => a - b);
    assert.deepEqual(legacyArt, [...LEGACY_IDS, 99], 'the original sectors keep a 1:1 art mapping');
    // Every artKey must name a real art file: either an original sector's
    // historical number, 99, or — for a sector added later, which has its own
    // generated s<id> art — the sector's own id.
    for (const p of SECTOR_PLACES) {
        assert.ok(
            p.artKey === 99 || LEGACY_IDS.includes(p.artKey) || p.artKey === p.id,
            `sector ${p.id} artKey ${p.artKey} names a real art file`,
        );
    }
    const names = new Set(SECTOR_PLACES.map((p) => p.name));
    assert.equal(names.size, SECTOR_PLACES.length, 'sector names are unique');
    // Only the pre-expansion sectors take part in the old↔new mapping; ids added
    // later never existed in the old world and so have no legacy counterpart.
    for (const id of LEGACY_IDS) {
        assert.equal(OLD_TO_NEW_SECTOR[NEW_TO_OLD_SECTOR[id]], id, `mapping bijective at ${id}`);
    }
    for (const id of NEW_IDS) {
        assert.equal(NEW_TO_OLD_SECTOR[id], undefined, `new sector ${id} has no legacy id`);
    }
});

test('later-added sectors can never corrupt the legacy save mapping', () => {
    /*
     * Regression guard for a real bug. `artKey` doubles as a place's
     * pre-renumbering id, which is how OLD_TO_NEW/NEW_TO_OLD are derived. When
     * the 2026-07-29 expansion briefly let new sectors reuse a sibling's artKey
     * for art AND fed them into these maps, OLD_TO_NEW[46] flipped from 27 to 65
     * — which would have migrated every save parked in old sector 46 to the wrong
     * sector. The maps must only ever admit places with a real legacy identity.
     */
    assert.equal(Object.keys(OLD_TO_NEW_SECTOR).length, LEGACY_IDS.length + 1, 'one entry per old sector + 99');
    for (const id of LEGACY_IDS) {
        assert.ok(OLD_TO_NEW_SECTOR[id] !== undefined, `old sector ${id} still maps somewhere`);
        assert.ok(
            !NEW_IDS.includes(OLD_TO_NEW_SECTOR[id]!),
            `old sector ${id} maps to an ORIGINAL sector, not an expansion one`,
        );
    }
    // Holds however a later sector keys its art — including if one is ever
    // pointed back at a legacy floor, which is what caused the original bug.
    for (const p of SECTOR_PLACES.filter((s) => NEW_IDS.includes(s.id))) {
        assert.notEqual(
            OLD_TO_NEW_SECTOR[p.artKey], p.id,
            `sector ${p.id} (artKey ${p.artKey}) must not own a legacy mapping`,
        );
    }
});

test('remapLegacySector: identity for 0/99, total and bijective over 1-60, safe fallback', () => {
    assert.equal(remapLegacySector(0), 0);
    assert.equal(remapLegacySector(99), 99);
    const image = new Set(LEGACY_IDS.map((s) => remapLegacySector(s)));
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
        for (const special of NON_WALKABLE_SECTORS) {
            assert.ok(a !== special && b !== special, `sector ${special} stays map-travel-only`);
        }
        adj.get(a)!.push(b);
        adj.get(b)!.push(a);
    }
    for (const [id, links] of adj) {
        if (NON_WALKABLE_SECTORS.includes(id)) {
            assert.equal(links.length, 0, `map-travel-only sector ${id} carries no roads`);
            continue;
        }
        assert.ok(links.length >= 2 && links.length <= 5, `sector ${id} has ${links.length} roads (want 2-5)`);
        assert.equal(new Set(links).size, links.length, `sector ${id} has duplicate roads`);
    }
    const seen = new Set<number>([1]);
    const queue = [1];
    while (queue.length) {
        const cur = queue.shift()!;
        for (const nx of adj.get(cur) ?? []) if (!seen.has(nx)) { seen.add(nx); queue.push(nx); }
    }
    assert.equal(seen.size, WILD_IDS.length, 'road graph is connected across every walkable sector');

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
    for (const [a, b] of REMOVED_ROADS_OLD) {
        const key = norm(OLD_TO_NEW_SECTOR[a]!, OLD_TO_NEW_SECTOR[b]!);
        assert.ok(expected.delete(key), `removed road ${a}-${b} existed in the old world`);
    }
    for (const [a, b] of EXPANSION_ROADS_NEW) {
        // An expansion road must attach a NEW sector — it may never quietly
        // rewire two of the original sectors to each other.
        assert.ok(
            NEW_IDS.includes(a) || NEW_IDS.includes(b),
            `expansion road ${a}-${b} touches a new sector`,
        );
        expected.add(norm(a, b));
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

test('every sector sits in one of its region blocks, biomes stay in the 5-biome vocabulary', () => {
    // Each region owns one or more id ranges. The original 1-60 blocks are
    // contiguous; the 2026-07-29 expansion appended 61-66 (ids 1-60 were all
    // taken and renumbering again would mean another save migration), so the
    // regions that gained a sector own a second range.
    const blocks: Record<string, ReadonlyArray<readonly [number, number]>> = {
        stormveil: [[1, 8]], ashenleaf: [[9, 16]], moonshadow: [[17, 25]], frostfang: [[26, 33], [65, 65]],
        frostborder: [[34, 35]], midlands: [[36, 45], [61, 62]], castle: [[46, 51]], festival: [[52, 54], [63, 63]],
        hollowroad: [[55, 57], [64, 64]], lavafront: [[58, 60], [66, 66]],
    };
    for (const p of SECTOR_PLACES) {
        if (p.id === 99) { assert.equal(p.region, 'deathsgate'); continue; }
        const ranges = blocks[p.region]!;
        assert.ok(
            ranges.some(([lo, hi]) => p.id >= lo && p.id <= hi),
            `${p.name} (${p.id}) inside a ${p.region} block`,
        );
        assert.ok(['shadow', 'forest', 'volcano', 'snow', 'central'].includes(p.biome));
    }
    // The block table must account for every sector exactly once.
    const claimed = Object.values(blocks).flat().flatMap(([lo, hi]) =>
        Array.from({ length: hi - lo + 1 }, (_, i) => lo + i));
    assert.deepEqual([...claimed].sort((a, b) => a - b), [...WILD_IDS]);
    assert.equal(sectorBiomeOf(99), 'volcano');
    assert.equal(sectorBiomeOf(0), 'central');
    assert.equal(sectorName(8), 'Canal Heart');
    assert.equal(sectorName(15), 'Heartwood Shrine');
});
