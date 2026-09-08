import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { _makeMemoryKv } from '../_storage.js';
import {
    WALKED_TILE_MIN_INTERVAL_MS,
    WALKED_TILE_TTL_SECONDS,
    noteWalkedTile,
    readWalkedTile,
    recordArrivalTile,
    resetWalkedTileThrottleForTests,
    resumeTileFor,
    walkedTileKey,
} from './walked-tile.js';

/*
 * F03 — the tile a player last stood on is durable, cheaply: written by the
 * heartbeat when it changes, throttled per player, carried across the
 * throttle window, superseded by a settled arrival.
 */

const NOW = 1_800_000_000_000;

describe('walked tile — the spot the player last stood on', () => {
    let kv: ReturnType<typeof _makeMemoryKv>;
    let sets: Array<{ key: string; ex?: number }>;
    let store: Parameters<typeof noteWalkedTile>[0];

    beforeEach(() => {
        kv = _makeMemoryKv();
        sets = [];
        resetWalkedTileThrottleForTests();
        store = {
            get: <T,>(key: string) => kv.get<T>(key),
            set: (key: string, value: unknown, opts?: { ex?: number; nx?: boolean }) => { sets.push({ key, ex: opts?.ex }); return kv.set(key, value, opts); },
            del: (...keys: string[]) => kv.del(...keys),
        };
    });

    it('writes the first tile seen, then only changes, never faster than the throttle', async () => {
        assert.equal(await noteWalkedTile(store, 'Rill', 12, 40, NOW), true);
        assert.deepEqual(await readWalkedTile(kv, 'rill'), { sector: 12, tile: 40, at: NOW });
        assert.equal(sets[0].ex, WALKED_TILE_TTL_SECONDS);

        assert.equal(await noteWalkedTile(store, 'Rill', 12, 40, NOW + 1_000), false, 'an unchanged tile writes nothing');
        assert.equal(await noteWalkedTile(store, 'Rill', 12, 41, NOW + 2_000), false, 'a change inside the window is held');
        assert.equal(await noteWalkedTile(store, 'Rill', 12, 42, NOW + 3_000), false);
        assert.deepEqual(await readWalkedTile(kv, 'rill'), { sector: 12, tile: 40, at: NOW }, 'storage still holds the last write');

        assert.equal(await noteWalkedTile(store, 'Rill', 12, 42, NOW + WALKED_TILE_MIN_INTERVAL_MS), true, 'the held change lands once the window passes, even with no new change');
        assert.deepEqual(await readWalkedTile(kv, 'rill'), { sector: 12, tile: 42, at: NOW + WALKED_TILE_MIN_INTERVAL_MS });
        assert.equal(sets.length, 2, 'three steps cost two writes');
    });

    it('never writes for a town beat or a beat with no tile', async () => {
        assert.equal(await noteWalkedTile(store, 'Rill', 0, 40, NOW), false);
        assert.equal(await noteWalkedTile(store, 'Rill', 12, undefined, NOW), false);
        assert.equal(await kv.get(walkedTileKey('rill')), null);
    });

    it('a failed write is retried by the next beat', async () => {
        const flaky = { ...store, set: async () => { throw new Error('kv-down'); } };
        assert.equal(await noteWalkedTile(flaky, 'Rill', 12, 40, NOW), false);
        assert.equal(await noteWalkedTile(store, 'Rill', 12, 40, NOW + WALKED_TILE_MIN_INTERVAL_MS), true, 'same tile, but dirty: written');
        assert.deepEqual(await readWalkedTile(kv, 'rill'), { sector: 12, tile: 40, at: NOW + WALKED_TILE_MIN_INTERVAL_MS });
    });

    it('a settled arrival supersedes any walk, unthrottled, and an arrival without a tile clears it', async () => {
        await noteWalkedTile(store, 'Rill', 12, 90, NOW);
        await recordArrivalTile(store, 'Rill', 13, 7, NOW + 100);
        assert.deepEqual(await readWalkedTile(kv, 'rill'), { sector: 13, tile: 7, at: NOW + 100 });
        assert.equal(await noteWalkedTile(store, 'Rill', 13, 7, NOW + 200), false, 'the arrival primed the throttle: no duplicate write');
        await recordArrivalTile(store, 'Rill', 14, undefined, NOW + 300);
        assert.equal(await kv.get(walkedTileKey('rill')), null);
    });

    it('resumes on the walked tile only for the same sector, else on the arrival tile', () => {
        assert.equal(resumeTileFor({ sector: 12, tile: 42, at: NOW }, 12, 5), 42);
        assert.equal(resumeTileFor({ sector: 12, tile: 42, at: NOW }, 13, 5), 5, 'a walk in another sector never wins');
        assert.equal(resumeTileFor(null, 12, 5), 5);
        assert.equal(resumeTileFor(null, 12, undefined), undefined);
        assert.equal(resumeTileFor(null, 12, 999), undefined, 'an out-of-range arrival is ignored');
    });
});
