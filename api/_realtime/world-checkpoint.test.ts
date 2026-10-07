import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _makeMemoryKv } from '../_storage.js';
import { noteWalkedTile, readWalkedTile, recordArrivalTile, resetWalkedTileThrottleForTests, resumeWorldPositionFor } from './walked-tile.js';
import { worldPositionModel, WORLD_LAYOUT_VERSION, CONTINUOUS_WORLD_SPACE } from '../../shared/continuous-world-layout.js';
import { buildWorldNavigation } from '../../shared/continuous-world-navigation.js';
import { MemoryOnlineStateStore } from './online-store.js';
const model = worldPositionModel(), node = buildWorldNavigation(CONTINUOUS_WORLD_SPACE).nodes.find(n => n.road && n.neighbors.length === 2)!;
const position = { layoutVersion: WORLD_LAYOUT_VERSION, from: node.id, to: node.neighbors[0]!, progress: .2 };

test('delayed continuous arrival settlement preserves a newer walk checkpoint, including after process hydration', async () => {
    for (const cold of [false, true]) {
        resetWalkedTileThrottleForTests(); const store = _makeMemoryKv(), location = model.location(position);
        const next = { ...position, progress: .4 };
        assert(await noteWalkedTile(store, 'delayed-arrival', location.sector, location.tile, 6000, next));
        if (cold) resetWalkedTileThrottleForTests();
        await recordArrivalTile(store, 'delayed-arrival', location.sector, location.tile, 1000, position);
        assert.deepEqual((await readWalkedTile(store, 'delayed-arrival'))?.worldPosition, next);
    }
});

test('intermediate corridor positions share the existing throttled durable checkpoint', async () => {
    resetWalkedTileThrottleForTests(); const store = _makeMemoryKv();
    const location = model.location(position);
    assert(await noteWalkedTile(store, 'checkpoint', location.sector, location.tile, 1000, position));
    assert.deepEqual((await readWalkedTile(store, 'checkpoint'))?.worldPosition, position);
    const next = { ...position, progress: .4 };
    assert.equal(await noteWalkedTile(store, 'checkpoint', location.sector, location.tile, 2000, next), false);
    assert(await noteWalkedTile(store, 'checkpoint', location.sector, location.tile, 6000, next));
    const checkpoint = await readWalkedTile(store, 'checkpoint');
    assert.deepEqual(resumeWorldPositionFor(checkpoint, location.sector, position), next);
    await recordArrivalTile(store, 'checkpoint', 27, 78, 7000);
    assert.equal(resumeWorldPositionFor(await readWalkedTile(store, 'checkpoint'), 27, position), undefined);
});

test('server hydration restores the cursor; stale legacy movement cannot overwrite it', () => {
    const location = model.location(position), store = new MemoryOnlineStateStore({ now: () => 1000 });
    store.upsert({ name: 'rill', ...location, character: null, restoredWorldPosition: position });
    const before = store.get('rill')!;
    store.upsert({ name: 'rill', sector: location.sector, tile: 78, character: null });
    assert.deepEqual(store.get('rill')!.worldPosition, position);
    assert.equal(store.get('rill')!.tile, before.tile);
    assert.equal(store.moveToTile('rill', 78), null);
});

test('continuous boundary arrival publishes position and sequence together', () => {
    const nodes = buildWorldNavigation(CONTINUOUS_WORLD_SPACE).nodes, byId = new Map(nodes.map(n => [n.id, n]));
    const a = nodes.find(n => n.neighbors.some(id => byId.get(id)!.sector !== n.sector))!;
    const b = byId.get(a.neighbors.find(id => byId.get(id)!.sector !== a.sector)!)!;
    const cursor = { layoutVersion: WORLD_LAYOUT_VERSION, from: a.id, to: b.id, progress: .6 };
    const store = new MemoryOnlineStateStore({ now: () => 1000 });
    store.upsert({ name: 'rill', sector: a.sector, character: null });
    let seen = false;
    store.setObserver(event => {
        if (event.type !== 'moved') return;
        const player = store.get('rill')!;
        assert.equal(player.movementSeq, 1); assert.deepEqual(player.worldPosition, cursor); seen = true;
    });
    store.startTravel('rill', b.sector, 1000, a.sector, model.location(cursor).tile, cursor);
    assert(seen); assert.equal(store.get('rill')!.sector, b.sector);
});

test('an older in-flight walk checkpoint cannot overwrite a later arrival', async () => {
    resetWalkedTileThrottleForTests(); const memory = _makeMemoryKv();
    let release!: () => void, started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;
    const store = { get: memory.get.bind(memory), del: memory.del.bind(memory), set: async (...args: Parameters<typeof memory.set>) => {
        if (++calls === 1) { started(); await wait; }
        return memory.set(...args);
    } };
    const location = model.location(position);
    const old = noteWalkedTile(store, 'write-race', location.sector, location.tile, 1000, position);
    await entered;
    const arrival = recordArrivalTile(store, 'write-race', 27, 78, 2000);
    await Promise.resolve(); assert.equal(calls, 1);
    release(); await Promise.all([old, arrival]);
    assert.equal((await readWalkedTile(store, 'write-race'))?.sector, 27);
    assert.equal((await readWalkedTile(store, 'write-race'))?.worldPosition, undefined);
});
