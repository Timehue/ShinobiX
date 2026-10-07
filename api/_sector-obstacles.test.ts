import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLOOR_WALK_MASKS } from '../shared/sector-floor-layouts.js';
import { serverWalkableTile, serverWalkTile } from './_sector-obstacles.js';
import { MemoryOnlineStateStore } from './_realtime/online-store.js';
import { sectorExits, travelArrivalTile } from '../shared/sector-links.js';
import { buildStrongholdTiles, strongholdRooms, strongholdPvpRewardMultiplier } from '../shared/sector-stronghold.js';

test('blocked movement preserves presence and sequence; restore and travel use safe tiles; kill switch restores legacy movement', () => {
    // An explicit fixture exercises the same server boundary before art admission.
    const masks = FLOOR_WALK_MASKS as Record<number, readonly string[]>;
    const previousMask = masks[53], previousFlag = process.env.DISABLE_SECTOR_OBSTACLES;
    const mask = Array.from({ length: 12 }, () => '............');
    mask[6] = '......~.....';
    masks[53] = mask;
    delete process.env.DISABLE_SECTOR_OBSTACLES;
    try {
        assert.equal(serverWalkableTile(31, 78), false);
        assert.equal(serverWalkTile(31, 78), 66, 'Manhattan tie uses lowest tile ID');
        assert.equal(serverWalkTile(31, undefined), undefined);
        let now = 1000;
        const store = new MemoryOnlineStateStore({ now: () => now });
        const player = store.upsert({ name: 'Walker', sector: 31, tile: 78, character: null });
        assert.equal(player.tile, 66, 'a blocked saved position is restored safely');
        const sequence = player.movementSeq, seenAt = player.lastSeenAt;
        const events: unknown[] = [];
        store.setObserver(event => events.push(event));
        now += 100;
        assert.equal(store.moveToTile('Walker', 78), null);
        assert.equal(player.tile, 66);
        assert.equal(player.movementSeq, sequence);
        assert.equal(player.lastSeenAt, seenAt);
        assert.deepEqual(events, [], 'a rejected move publishes no presence event');
        assert.equal(store.moveToTile('Walker', 67)?.tile, 67);
        assert.equal(player.movementSeq, (sequence ?? 0) + 1);
        store.upsert({ name: 'Traveler', sector: 0, character: null });
        assert.ok(store.startTravel('Traveler', 31, now + 100, 0, 78));
        now += 101;
        assert.equal(store.get('Traveler')?.tile, 66, 'sealed arrival is grounded');
        process.env.DISABLE_SECTOR_OBSTACLES = '1';
        assert.equal(serverWalkableTile(31, 78), true);
        assert.equal(serverWalkTile(31, 78), 78);
        assert.equal(store.moveToTile('Walker', 78)?.tile, 78);
    } finally {
        if (previousMask) masks[53] = previousMask; else delete masks[53];
        if (previousFlag === undefined) delete process.env.DISABLE_SECTOR_OBSTACLES;
        else process.env.DISABLE_SECTOR_OBSTACLES = previousFlag;
    }
});

test('admitted Death’s Gate blocks lava and roofs while grounding arena arrivals and keeping interior rewards', () => {
    const previous = process.env.DISABLE_SECTOR_OBSTACLES;
    delete process.env.DISABLE_SECTOR_OBSTACLES;
    try {
        assert.equal(FLOOR_WALK_MASKS[99]?.length, 12);
        assert.equal(serverWalkableTile(99, 96), false, 'painted lava is blocked');
        assert.equal(serverWalkableTile(99, 29), false, 'stronghold roof is blocked');
        assert.equal(serverWalkableTile(99, 53), true, 'south gate approach is open');
        const store = new MemoryOnlineStateStore({ now: () => 1000 });
        const player = store.upsert({ name: 'ArenaWalker', sector: 99, tile: 96, character: null });
        assert.notEqual(player.tile, 96); assert(serverWalkableTile(99, player.tile!));
        const sequence = player.movementSeq;
        assert.equal(store.moveToTile('ArenaWalker', 96), null); assert.equal(player.movementSeq, sequence);
        assert(serverWalkableTile(99, travelArrivalTile(1, 99, true)!));
        assert.deepEqual(sectorExits(99), []);
        assert.equal(strongholdRooms(99).length, 12); assert.equal(buildStrongholdTiles(99).length, 37 * 23);
        assert.equal(strongholdPvpRewardMultiplier(99), 2); assert.equal(strongholdPvpRewardMultiplier(99, 'deathsgate'), 4);
        process.env.DISABLE_SECTOR_OBSTACLES = '1';
        assert.equal(serverWalkableTile(99, 96), true);
    } finally {
        if (previous === undefined) delete process.env.DISABLE_SECTOR_OBSTACLES; else process.env.DISABLE_SECTOR_OBSTACLES = previous;
    }
});
