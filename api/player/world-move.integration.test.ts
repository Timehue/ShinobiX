import { before, after, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CONTINUOUS_WORLD_SPACE, WORLD_LAYOUT_VERSION, worldPositionModel } from '../../shared/continuous-world-layout.js';
import { buildWorldNavigation } from '../../shared/continuous-world-navigation.js';
import type { WorldPosition } from '../../shared/world-position.js';

let clock = Date.now(), serial = 0;
let kv: typeof import('../_storage.js').kv;
let store: typeof import('../_realtime/online-store.js').onlineStore;
let service: typeof import('../_realtime/world-movement-service.js');
let travel: typeof import('../_realtime/travel-lease.js');
let handler: typeof import('./world-move.js').default;
let tokenFor: typeof import('../_auth.js').issuePlayerToken;
const model = worldPositionModel(), nodes = buildWorldNavigation(CONTINUOUS_WORLD_SPACE).nodes;
const byId = new Map(nodes.map(n => [n.id, n]));
const a = nodes.find(n => n.neighbors.some(id => byId.get(id)!.sector !== n.sector))!;
const b = byId.get(a.neighbors.find(id => byId.get(id)!.sector !== a.sector)!)!;
const origin: WorldPosition = { layoutVersion: WORLD_LAYOUT_VERSION, from: a.id, to: b.id, progress: .49 };
const destination = { ...origin, progress: .6 };

before(async () => {
    process.env.NODE_ENV = 'test'; process.env.SHINOBIX_QA_MEMORY_KV = '1';
    process.env.SESSION_SECRET = 'continuous-world-integration-test-secret-only';
    mock.method(Date, 'now', () => clock);
    ({ kv } = await import('../_storage.js'));
    ({ onlineStore: store } = await import('../_realtime/online-store.js'));
    service = await import('../_realtime/world-movement-service.js');
    travel = await import('../_realtime/travel-lease.js');
    handler = (await import('./world-move.js')).default as unknown as typeof handler;
    ({ issuePlayerToken: tokenFor } = await import('../_auth.js'));
});
after(() => mock.restoreAll());

test('nearby presentation is bounded by distance and count without changing sector membership', async () => {
    const names: string[] = [];
    for (let i = 0; i < 1000; i++) {
        const name = `nearbyqa${i}`; names.push(name);
        store.upsert({ name, sector: i < 30 ? a.sector : 65, tile: 78, character: null,
            ...(i < 30 ? { restoredWorldPosition: origin } : {}) });
    }
    const viewer = store.get(names[0]!)!, start = performance.now();
    const peers = service.nearbyWorldPlayers(viewer), elapsed = performance.now() - start;
    assert.equal(peers.length, 24); assert(peers.every(p => p.name !== viewer.name));
    assert(peers.every(p => model.distanceWithin(origin, p.worldPosition, 10) !== null));
    assert.equal(store.get(viewer.name)?.sector, a.sector);
    assert(elapsed < 100, `1000-player bounded visibility took ${elapsed.toFixed(1)} ms`);
    console.log(`[continuous-world] nearby 1000 players: ${elapsed.toFixed(2)} ms, ${Buffer.byteLength(JSON.stringify(peers))} B for ${peers.length} peers`);
    for (const name of names) store.remove(name);
});

async function actor() {
    const name = `worldwalker${++serial}`, location = model.location(origin);
    await kv.set(`save:${name}`, { _saveVersion: 4, worldGeoV: 2, currentSector: a.sector, currentTile: location.tile,
        character: { name, level: 20, hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100 } });
    store.upsert({ name, ...location, character: null, restoredWorldPosition: origin });
    const initial = await service.applyWorldMovement(name, { worldPosition: origin, expectedSequence: 0 });
    assert(initial.ok); assert.equal(initial.sequence, 0, 'stationary startup acknowledges without moving'); clock += 30;
    return { name, sequence: initial.sequence };
}

async function request(name: string, method: string, body: unknown = {}, authenticated = true) {
    const result: { status: number; body?: Record<string, unknown> } = { status: 200 };
    const response = { setHeader() {}, status(code: number) { result.status = code; return response; },
        json(value: Record<string, unknown>) { result.body = value; return response; }, end() { return response; } };
    await handler({ method, body, headers: authenticated ? { 'x-player-name': name, 'x-player-token': tokenFor(name), 'x-forwarded-for': '10.80.0.1' } : {},
        socket: { remoteAddress: '10.80.0.1' } } as never, response as never);
    return result;
}

test('HTTP movement requires authentication and returns the same admitted cursor', async () => {
    const { name, sequence } = await actor();
    assert.equal((await request(name, 'GET', {}, false)).status, 401);
    const snapshot = await request(name, 'GET'); assert.equal(snapshot.status, 200);
    assert.deepEqual(snapshot.body?.worldPosition, origin);
    assert.equal(snapshot.body?.sequence, sequence);
    const moved = await request(name, 'POST', { worldPosition: destination, expectedSequence: sequence });
    assert.equal(moved.status, 200); assert.equal(moved.body?.sector, b.sector);
    assert.equal(moved.body?.sequence, sequence + 1);
    assert.deepEqual(store.get(name)!.worldPosition, destination);
    assert.deepEqual((await travel.getTravelLease(name))?.worldPosition, destination);
    assert(await travel.settleTravelLease(name, undefined, clock));
    assert.deepEqual((await kv.get<Record<string, unknown>>(`save:${name}`))?.worldPosition, destination);
});

test('failed durable admission moves neither the sector nor cursor', async t => {
    const { name, sequence } = await actor(), original = kv.set.bind(kv);
    t.mock.method(kv, 'set', async (key: string, value: unknown, options?: never) => {
        if (key === travel.travelLeaseKey(name)) throw new Error('injected durable failure');
        return original(key, value, options);
    });
    const result = await service.applyWorldMovement(name, { worldPosition: destination, expectedSequence: sequence });
    assert.equal(result.ok, false); assert.equal(store.get(name)!.sector, a.sector);
    assert.equal(result.reason, 'unavailable', 'the durable write failure must be reached');
    assert.deepEqual(store.get(name)!.worldPosition, origin);
});

test('a battle acquired during admission prevents publication and clears only that lease', async t => {
    const { name, sequence } = await actor(), original = kv.set.bind(kv);
    t.mock.method(kv, 'set', async (key: string, value: unknown, options?: never) => {
        const result = await original(key, value, options);
        if (key === travel.travelLeaseKey(name)) store.setInBattle(name, true);
        return result;
    });
    const result = await service.applyWorldMovement(name, { worldPosition: destination, expectedSequence: sequence });
    assert.equal(result.ok, false); assert.equal(store.get(name)!.sector, a.sector);
    assert.equal(result.reason, 'superseded', 'the battle acquired during durable admission must be reached');
    assert.equal(await travel.getTravelLease(name), null);
});

test('HTTP and an actual authenticated socket share sequence and zone authority', { timeout: 15000 }, async t => {
    const { name, sequence } = await actor(), server = createServer();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const sockets = await import('../_realtime/socket.js');
    t.after(async () => { await sockets.closeSocketServer(); if (server.listening) await new Promise<void>(resolve => server.close(() => resolve())); });
    sockets.attachSocketServer(server);
    for (let attempt = 0; !sockets.getIo() && attempt < 200; attempt++) await delay(5);
    assert(sockets.getIo());
    const address = server.address(); assert(address && typeof address !== 'string');
    const require = createRequire(resolve(process.cwd(), 'shinobij.client/package.json'));
    const client = require('socket.io-client').io(`http://127.0.0.1:${address.port}`, {
        transports: ['websocket'], reconnection: false, autoConnect: false,
        auth: { 'x-player-name': name, 'x-player-token': tokenFor(name) },
    });
    t.after(async () => {
        if (!client.connected) { client.close(); return; }
        await new Promise<void>(resolve => { client.once('disconnect', () => resolve()); client.close(); });
    });
    await new Promise<void>((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); client.connect(); });
    const result = await new Promise<Record<string, unknown>>(resolve => client.emit('world:move', { worldPosition: destination, expectedSequence: sequence }, resolve));
    assert.equal(result.ok, true); assert.equal(result.sector, b.sector); assert.equal(result.sequence, sequence + 1);
    const stale = await request(name, 'POST', { worldPosition: origin, expectedSequence: sequence });
    assert.equal(stale.status, 409); assert.equal(stale.body?.reason, 'sequence');
    assert.deepEqual(stale.body?.worldPosition, destination);
});
