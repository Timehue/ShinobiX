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

test('edge travel requires the authoritative sector, exit, destination, and requested tile', () => {
    const exit = sectorExits(1)[0]!;
    const player = { sector: 1, tile: exit.tile };
    const input = {
        originSector: 1,
        originTile: exit.tile,
        destinationSector: exit.destinationSector,
        exitId: exit.id,
    };
    assert.equal(edgeTravelExit(player, input)?.id, exit.id);
    assert.equal(edgeTravelExit({ ...player, sector: 2 }, input), null);
    assert.equal(edgeTravelExit(player, { ...input, originTile: exit.tile + 1 }), null);
    assert.equal(edgeTravelExit(player, { ...input, destinationSector: 60 }), null);
    assert.equal(edgeTravelExit(player, { ...input, exitId: 'forged' }), null);
});

test('edge travel tolerates the live tile update arriving after the crossing request', () => {
    const exit = sectorExits(55)[0]!;
    const staleTile = exit.direction === 'north' ? exit.tile + 12
        : exit.direction === 'south' ? exit.tile - 12
            : exit.direction === 'west' ? exit.tile + 1
                : exit.tile - 1;
    const stalePresence = { sector: 55, tile: staleTile };
    const input = {
        originSector: 55,
        originTile: exit.tile,
        destinationSector: exit.destinationSector,
        exitId: exit.id,
    };

    assert.notEqual(stalePresence.tile, exit.tile);
    assert.equal(edgeTravelExit(stalePresence, input)?.id, exit.id);
});
