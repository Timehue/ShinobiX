import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeTravelExit, isPlayableWorldSector, WORLD_TRAVEL_MS, WORLD_TRAVEL_EDGE_MS } from './travel.js';
import { sectorExits } from '../../shared/sector-links.js';
import { MAX_WILD_SECTOR } from '../../shared/sector-geo.js';

test('world travel keeps the intentional three-second duration for map fast-travel', () => {
    assert.equal(WORLD_TRAVEL_MS, 3_000);
});

test('edge crossings are instant by default (walking is free movement)', () => {
    // WORLD_TRAVEL_EDGE_MS is a server env dial; unset (the default and the
    // test environment) it must be 0 — no mask, no wait — and it can never
    // exceed the map-travel duration.
    assert.equal(WORLD_TRAVEL_EDGE_MS, 0);
    assert.ok(WORLD_TRAVEL_EDGE_MS <= WORLD_TRAVEL_MS);
});

test('world travel only accepts real playable sectors', () => {
    // MAX_WILD_SECTOR grew from 60 to 66 with the 2026-07-29 expansion; the
    // bound is asserted against the shared constant so it can't drift again.
    for (const sector of [0, 1, 35, 60, MAX_WILD_SECTOR, 99]) assert.equal(isPlayableWorldSector(sector), true);
    for (const sector of [-1, MAX_WILD_SECTOR + 1, 98, 100, 4.5, '12']) assert.equal(isPlayableWorldSector(sector), false);
});

test('edge travel requires the authoritative sector, exit, destination, and requested tile', () => {
    const exit = sectorExits(1)[0]!;
    const input = {
        originSector: 1,
        originTile: exit.tile,
        destinationSector: exit.destinationSector,
        exitId: exit.id,
    };
    assert.equal(edgeTravelExit(input)?.id, exit.id);
    assert.equal(edgeTravelExit({ ...input, originSector: 2 }), null);
    assert.equal(edgeTravelExit({ ...input, originTile: exit.tile + 1 }), null);
    assert.equal(edgeTravelExit({ ...input, destinationSector: 60 }), null);
    assert.equal(edgeTravelExit({ ...input, exitId: 'forged' }), null);
});

test('edge travel is validated independently of lagging live presence', () => {
    const exit = sectorExits(55)[0]!;
    const input = {
        originSector: 55,
        originTile: exit.tile,
        destinationSector: exit.destinationSector,
        exitId: exit.id,
    };

    assert.equal(edgeTravelExit(input)?.id, exit.id);
});
