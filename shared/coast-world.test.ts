import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
    COAST_CONTESTABLE_SECTORS,
    COAST_DOCK,
    COAST_WORLD,
    OPEN_COAST_SECTOR_IDS,
    coastExitById,
    coastExitWalkable,
    coastExits,
    coastLayout,
    coastSite,
    coastSitesInSector,
    isCoastSectorOpen,
} from './coast-world.js';
import { coastTileWalkable, coastWorldProblems, type CoastWorldData } from './coast-world-rules.js';
import {
    COAST_SECTOR_IDS,
    coastRegionOf,
    isCoastSector,
    sameWorldMap,
    sectorMapOf,
} from './world-maps.js';
import { MAX_WILD_SECTOR, PLAYABLE_WILD_SECTOR_IDS, SECTOR_PLACES, WILD_SECTOR_IDS, isWildSector } from './sector-geo.js';

// ── Which world a number is on ───────────────────────────────────────────────

test('sector numbers sort onto the right map', () => {
    for (const sector of [0, 1, 40, 74, 99]) assert.equal(sectorMapOf(sector), 'home', String(sector));
    for (const sector of [101, 125, 150]) assert.equal(sectorMapOf(sector), 'coast', String(sector));
    for (const sector of [-1, 75, 98, 100, 151, 1.5, Number.NaN]) assert.equal(sectorMapOf(sector), null, String(sector));
    assert.equal(COAST_SECTOR_IDS.length, 50);
    assert.deepEqual([coastRegionOf(101), coastRegionOf(110), coastRegionOf(111), coastRegionOf(150), coastRegionOf(74)], [1, 1, 2, 5, 0]);
    assert.equal(sameWorldMap(1, 99), true);
    assert.equal(sameWorldMap(101, 150), true);
    assert.equal(sameWorldMap(7, 101), false, 'the two maps are joined only by the boat');
    assert.equal(sameWorldMap(100, 100), false, 'a number on neither map matches nothing');
});

test('the home map is untouched: its tables do not know the coast', () => {
    assert.equal(MAX_WILD_SECTOR, 74);
    assert.equal(WILD_SECTOR_IDS.length, 74);
    assert.equal(isWildSector(101), false);
    assert.equal(PLAYABLE_WILD_SECTOR_IDS.some(isCoastSector), false);
    assert.equal(SECTOR_PLACES.some(place => isCoastSector(place.id)), false);
});

// ── The committed geography ──────────────────────────────────────────────────

test('the committed coast passes every admission rule', () => {
    assert.deepEqual(coastWorldProblems(COAST_WORLD), []);
});

test('the admission rules catch a broken delivery', () => {
    const broken = structuredClone(COAST_WORLD) as CoastWorldData;
    const exit = broken.exits['101'][0];
    exit.lane += 1;                                  // the two ends of a trail disagree
    broken.layouts['105'].mask[0] = '############';   // a wall across a painted floor
    broken.roads.pop();                               // a road dropped
    const problems = coastWorldProblems(broken).join('\n');
    assert.match(problems, /the two ends use different lanes/);
    assert.match(problems, /sector 105:/);
    assert.match(problems, /no road joins those sectors/);
});

test('every exit is frozen: this hash changes only when a trail really moves', () => {
    // Exits are stored on saves as walk cursors and travel receipts. A later
    // region's art must slot into the boundary exits, never shift an old one.
    const exits = Object.keys(COAST_WORLD.exits).sort().flatMap(sector => COAST_WORLD.exits[sector]
        .map(exit => `${exit.id}>${exit.tile}>${exit.destinationExitId}>${exit.destinationTile}>${exit.lane}`));
    assert.equal(exits.length, 138, '69 roads, one exit each way');
    assert.equal(createHash('sha256').update(exits.join('|')).digest('hex').slice(0, 16), EXIT_FINGERPRINT);
});

test('all five painted regions connect through the boundary trails', () => {
    assert.equal(OPEN_COAST_SECTOR_IDS.length, 50);
    assert.deepEqual([OPEN_COAST_SECTOR_IDS[0], OPEN_COAST_SECTOR_IDS[49]], [101, 150]);
    assert.equal(isCoastSectorOpen(141), true);
    assert.equal(coastLayout(74), null, 'a home sector has no coast layout');
    // The two trails into the last region are open on both sides.
    for (const [from, to] of [[138, 141], [123, 147]]) {
        const boundary = coastExits(from).find(exit => exit.destinationSector === to);
        assert.ok(boundary, `a trail from ${from} to ${to} is boundary`);
        assert.equal(coastExitWalkable(boundary), true);
        assert.equal(coastExitById(boundary.id), boundary);
    }
    const open = coastExits(101).find(exit => exit.destinationSector === 102)!;
    assert.equal(coastExitWalkable(open), true);
});

test('the boat lands on the slip, on ground that can be stood on', () => {
    assert.deepEqual([COAST_DOCK.sector, COAST_DOCK.siteId], [101, 'saltstair-dock-101']);
    assert.equal(coastTileWalkable(coastLayout(101)!.mask, COAST_DOCK.tile), true);
});

test('sites are found by id with their sector, and clan plots are where the art put them', () => {
    const recordHouse = coastSite('saltstair-counter-105');
    assert.deepEqual([recordHouse?.sector, recordHouse?.name, recordHouse?.floors.length], [105, 'Record House', 1]);
    assert.equal(coastSite('whitecrown-fort-138')?.floors.length, 3, 'the Rime Gatehouse has three floors');
    assert.equal(coastSite('no-such-site'), undefined);
    assert.ok(coastSitesInSector(105).some(site => site.id === 'saltstair-counter-105'));
    assert.deepEqual(COAST_CONTESTABLE_SECTORS, [102, 103, 106, 108, 109, 146]);
});

/** Update only with the owner's go-ahead: it means a shipped trail moved. */
const EXIT_FINGERPRINT = 'c3c9c80d87252da5';
