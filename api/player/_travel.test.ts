import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeTravelExit, isPlayableWorldSector, WORLD_TRAVEL_MS } from './travel.js';
import { sectorExits } from '../../shared/sector-links.js';

test('world travel keeps the intentional three-second duration', () => {
    assert.equal(WORLD_TRAVEL_MS, 3_000);
});

test('world travel only accepts real playable sectors', () => {
    for (const sector of [0, 1, 35, 60, 99]) assert.equal(isPlayableWorldSector(sector), true);
    for (const sector of [-1, 61, 98, 100, 4.5, '12']) assert.equal(isPlayableWorldSector(sector), false);
});

test('edge travel requires the authoritative sector, exit, destination, and tile', () => {
    const exit = sectorExits(1)[0]!;
    const player = { sector: 1, tile: exit.tile };
    const input = { originSector: 1, destinationSector: exit.destinationSector, exitId: exit.id };
    assert.equal(edgeTravelExit(player, input)?.id, exit.id);
    assert.equal(edgeTravelExit({ ...player, sector: 2 }, input), null);
    assert.equal(edgeTravelExit({ ...player, tile: exit.tile + 1 }, input), null);
    assert.equal(edgeTravelExit(player, { ...input, destinationSector: 60 }), null);
    assert.equal(edgeTravelExit(player, { ...input, exitId: 'forged' }), null);
});
