import { before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;
const PLAYER = 'durableposition';
const SAVE = `save:${PLAYER}`;
let kv: typeof import('../_storage.js').kv;
let travel: typeof import('../_realtime/travel-lease.js');
let presence: typeof import('../_realtime/online-store.js');
let saveHandler: Handler;
let heartbeat: Handler;
let sanitize: typeof import('../save/[name].js').sanitizeCharacterSave;
let token: string;
let ip = 0;

before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SHINOBIX_QA_MEMORY_KV = '1';
    process.env.SESSION_SECRET = 'durable-position-integration-secret-with-enough-entropy';
    ({ kv } = await import('../_storage.js'));
    travel = await import('../_realtime/travel-lease.js');
    presence = await import('../_realtime/online-store.js');
    const auth = await import('../_auth.js');
    token = auth.issuePlayerToken(PLAYER)!;
    assert.ok(token);
    const saves = await import('../save/[name].js');
    saveHandler = saves.default as unknown as Handler;
    sanitize = saves.sanitizeCharacterSave;
    heartbeat = (await import('./heartbeat.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    (await import('../_realtime/walked-tile.js')).resetWalkedTileThrottleForTests();
    presence.onlineStore.remove(PLAYER);
    const { PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js');
    await kv.set(SAVE, {
        _saveVersion: 4, _saveAt: Date.now(), worldGeoV: 2,
        currentSector: 12, currentTile: 17,
        character: { name: PLAYER, level: 20, petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION,
            hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100 },
    });
});

async function request(handler: Handler, method: string, body: Json = {}) {
    const out: { status: number; body?: Json } = { status: 200 };
    const res = { setHeader() {}, status(code: number) { out.status = code; return res; },
        json(value: Json) { out.body = value; return res; }, end() { return res; } };
    await handler({ method, body, query: { name: PLAYER },
        headers: { 'x-player-name': PLAYER, 'x-player-token': token, 'x-forwarded-for': `10.90.0.${++ip}` },
        socket: { remoteAddress: '10.90.1.1' } } as never, res as never);
    return out;
}

test('autosaves cannot forge sector, arrival tile, pending journey, or arrival receipt', async () => {
    const stored = (await kv.get<Json>(SAVE))!;
    const out = sanitize({ ...stored, currentSector: 55, currentTile: 140,
        pendingTravel: { destinationSector: 55, arrivalAt: 1 }, worldTravelReceipt: 'forged' }, stored);
    assert.equal(out.currentSector, 12);
    assert.equal(out.currentTile, 17);
    assert.equal(out.pendingTravel, undefined);
    assert.equal(out.worldTravelReceipt, undefined);
    const first = sanitize({ character: stored.character, currentSector: 55, currentTile: 140 }, null);
    assert.equal(first.currentSector, 40, 'new characters use the server spawn');
    assert.equal(first.currentTile, undefined);
});

test('a forged legacy loading mask cannot teleport through an owner GET', async () => {
    const stored = (await kv.get<Json>(SAVE))!;
    await kv.set(SAVE, { ...stored, pendingTravel: { destinationSector: 55, arrivalAt: 1 } });
    const out = await request(saveHandler, 'GET');
    assert.equal(out.status, 200);
    assert.equal(out.body?.currentSector, 12);
    assert.equal((await kv.get<Json>(SAVE))?.currentSector, 12);
    assert.equal(out.body?.pendingTravel, null);
});

test('omitting the character blob cannot bypass top-level position ownership', async () => {
    const out = await request(saveHandler, 'POST', { _baseSaveVersion: 4,
        currentSector: 55, currentTile: 140, worldGeoV: 0, worldTravelReceipt: 'forged',
        pendingTravel: { destinationSector: 55, arrivalAt: 1 } });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    const saved = (await kv.get<Json>(SAVE))!;
    assert.equal(saved.currentSector, 12);
    assert.equal(saved.currentTile, 17);
    assert.equal(saved.worldTravelReceipt, undefined);
    assert.equal(saved.pendingTravel, undefined);
    assert.equal(saved.worldGeoV, 2, 'partial saves cannot trigger a second world renumbering');
    assert.equal((await request(saveHandler, 'GET')).body?.currentSector, 12);
});

test('owner reads settle the durable journey and keep its arrival on later autosaves', async () => {
    await travel.setTravelLease(PLAYER, { originSector: 12, destinationSector: 13,
        arrivalAt: Date.now() - 10, arrivalTile: 44, moveId: 'owner-read-arrival' });
    const out = await request(saveHandler, 'GET');
    assert.equal(out.status, 200);
    assert.equal(out.body?.currentSector, 13);
    assert.equal(out.body?.currentTile, 44);
    assert.equal(await travel.getTravelLease(PLAYER), null);
    const saved = await request(saveHandler, 'POST', { ...out.body,
        _baseSaveVersion: out.body?._saveVersion, currentSector: 12, currentTile: 17 });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal((await kv.get<Json>(SAVE))?.currentSector, 13);
    assert.equal((await kv.get<Json>(SAVE))?.currentTile, 44);
});

test('owner reads recover an in-flight loading mask from the server lease only', async () => {
    const arrivalAt = Date.now() + 60_000;
    await travel.setTravelLease(PLAYER, { originSector: 12, destinationSector: 13,
        arrivalAt, arrivalTile: 44, moveId: 'active-read-arrival' });
    const out = await request(saveHandler, 'GET');
    assert.equal(out.status, 200);
    assert.equal(out.body?.currentSector, 12);
    const pending = out.body?.pendingTravel as Json;
    assert.equal(pending.destinationSector, 13);
    assert.equal(pending.arrivalAt, arrivalAt);
    assert.ok(Number(pending.remainingMs) > 0 && Number(pending.remainingMs) <= 60_000);
    assert.equal((await kv.get<Json>(SAVE))?.currentSector, 12);
});

test('a journey that matures during an owner read returns its arrival, not a maskless town origin', async (t) => {
    let now = Date.now();
    t.mock.method(Date, 'now', () => now);
    const saved = (await kv.get<Json>(SAVE))!;
    await kv.set(SAVE, { ...saved, currentSector: 0 });
    await travel.setTravelLease(PLAYER, { originSector: 0, destinationSector: 13,
        arrivalAt: now + 3000, arrivalTile: 44, moveId: 'read-deadline-test' });
    const original = kv.get.bind(kv);
    let paused = false;
    t.mock.method(kv, 'get', async (key: string) => {
        const value = await original(key);
        if (key === SAVE && !paused) { paused = true; now += 4000; }
        return value;
    });
    const out = await request(saveHandler, 'GET');
    assert.equal(out.status, 200);
    assert.equal(out.body?.currentSector, 13);
    assert.equal(out.body?.currentTile, 44);
    assert.equal(out.body?.pendingTravel, null);
});

test('a journey remains recoverable after more than seven offline days', async () => {
    const now = Date.now();
    await travel.setTravelLease(PLAYER, { originSector: 12, destinationSector: 13,
        arrivalAt: now + 3_000, arrivalTile: 44, moveId: 'long-offline-arrival' });
    const realNow = Date.now;
    try {
        Date.now = () => now + 30 * 86_400_000;
        assert.ok(await travel.getTravelLease(PLAYER));
        assert.equal(await travel.settleTravelLease(PLAYER), true);
        assert.equal((await kv.get<Json>(SAVE))?.currentSector, 13);
    } finally { Date.now = realNow; }
});

test('a cleanup failure retries without another save version or arrival effect', async () => {
    await travel.setTravelLease(PLAYER, { originSector: 12, destinationSector: 13,
        arrivalAt: Date.now() - 1, arrivalTile: 44, moveId: 'cleanup-retry-arrival' });
    const original = kv.delIfEqual;
    kv.delIfEqual = async (key, expected) => {
        if (key === travel.travelLeaseKey(PLAYER)) throw new Error('cleanup unavailable');
        return original.call(kv, key, expected);
    };
    try { await assert.rejects(travel.settleTravelLease(PLAYER), /cleanup unavailable/); }
    finally { kv.delIfEqual = original; }
    const committed = (await kv.get<Json>(SAVE))!;
    assert.equal(committed.currentSector, 13);
    assert.ok(committed.worldTravelReceipt);
    const walked = await import('../_realtime/walked-tile.js');
    assert.equal((await walked.readWalkedTile(kv, PLAYER))?.tile, 44);
    walked.resetWalkedTileThrottleForTests();
    await walked.noteWalkedTile(kv, PLAYER, 13, 77);
    assert.equal(await travel.settleTravelLease(PLAYER), true);
    assert.equal((await kv.get<Json>(SAVE))?._saveVersion, committed._saveVersion);
    assert.equal(await travel.getTravelLease(PLAYER), null);
    assert.equal((await request(saveHandler, 'GET')).body?.currentTile, 77,
        'retrying arrival cleanup must not erase walking after the committed arrival');
});

test('cold HTTP recovery preserves main walked-tile recovery while rejecting a stale client tile', async () => {
    const walked = await import('../_realtime/walked-tile.js');
    await walked.noteWalkedTile(kv, PLAYER, 12, 77);
    const out = await request(heartbeat, 'POST', { name: PLAYER, sector: 55, tile: 1 });
    assert.equal(out.status, 200);
    assert.equal(out.body?.sector, 12);
    assert.equal(out.body?.tile, 77);
});

test('legacy string leases with metadata settle and clear by exact stored value', async () => {
    await kv.set(travel.travelLeaseKey(PLAYER), JSON.stringify({ originSector: 12,
        destinationSector: 13, arrivalAt: Date.now() - 1, arrivalTile: 44, legacyMetadata: true }));
    assert.equal(await travel.settleTravelLease(PLAYER), true);
    assert.equal((await kv.get<Json>(SAVE))?.currentSector, 13);
    assert.equal(await travel.getTravelLease(PLAYER), null);
});

test('a stale restart roster cannot override the durable arrival or authorize field actions', async () => {
    const store = presence.onlineStore as InstanceType<typeof presence.MemoryOnlineStateStore>;
    store.restore([{ name: PLAYER, displayName: PLAYER, sector: 7,
        lastSeenAt: Date.now(), connectedAt: Date.now() }]);
    assert.equal(store.get(PLAYER), null, 'snapshot is display-only until rehydrated');
    const out = await request(heartbeat, 'POST', { name: PLAYER, sector: 55, tile: 140 });
    assert.equal(out.status, 200);
    assert.equal(out.body?.sector, 12);
    assert.equal(store.get(PLAYER)?.tile, 17);
    assert.equal(store.listSector(7).length, 0);
});

test('instant town entry persists and reconnect does not resurrect the old field sector', async () => {
    presence.onlineStore.upsert({ name: PLAYER, sector: 12, tile: 17, character: null });
    const out = await request(heartbeat, 'POST', { name: PLAYER, sector: 0 });
    assert.equal(out.status, 200);
    assert.equal(out.body?.sector, 0);
    assert.equal((await kv.get<Json>(SAVE))?.currentSector, 0);
    assert.equal((await kv.get<Json>(SAVE))?.currentTile, null);
    presence.onlineStore.remove(PLAYER);
    const reconnect = await request(heartbeat, 'POST', { name: PLAYER, sector: 55 });
    assert.equal(reconnect.body?.sector, 0);
});

test('opening town cannot cancel a durable in-flight journey', async () => {
    presence.onlineStore.upsert({ name: PLAYER, sector: 12, character: null });
    const lease = { originSector: 12, destinationSector: 13, arrivalAt: Date.now() + 3_000, moveId: 'town-blocked-flight' };
    await travel.setTravelLease(PLAYER, lease);
    const out = await request(heartbeat, 'POST', { name: PLAYER, sector: 0 });
    assert.equal(out.status, 200);
    assert.equal(out.body?.sector, 12);
    assert.deepEqual(await travel.getTravelLease(PLAYER), lease);
});

test('a stale origin-0 heartbeat at arrival cannot undo an outbound journey', async () => {
    const now = Date.now();
    presence.onlineStore.upsert({ name: PLAYER, sector: 0, character: null });
    const lease = { originSector: 0, destinationSector: 13, arrivalAt: now - 1, moveId: 'stale-town-origin' };
    await travel.setTravelLease(PLAYER, lease);
    presence.onlineStore.startTravel(PLAYER, 13, lease.arrivalAt, 0);
    const out = await request(heartbeat, 'POST', { name: PLAYER, sector: 0 });
    assert.equal(out.status, 200);
    assert.equal(out.body?.sector, 13);
    assert.equal(presence.onlineStore.get(PLAYER)?.sector, 13);
});

test('repeated world-map origin beats cannot become town entry after arrival cleanup', async () => {
    presence.onlineStore.upsert({ name: PLAYER, sector: 0, tile: 17, character: null });
    const lease = { originSector: 0, destinationSector: 13, arrivalAt: Date.now() - 1, arrivalTile: 44, moveId: 'repeated-origin-test' };
    await travel.setTravelLease(PLAYER, lease);
    presence.onlineStore.startTravel(PLAYER, 13, lease.arrivalAt, 0, 44);
    for (let beat = 0; beat < 3; beat++) {
        const out = await request(heartbeat, 'POST', { name: PLAYER, sector: 0, tile: 17, enterTown: false });
        assert.equal(out.status, 200);
        assert.equal(out.body?.sector, 13);
        assert.equal(out.body?.tile, 44, 'origin coordinates cannot overwrite the arrival');
        await travel.settleTravelLease(PLAYER);
    }
    const town = await request(heartbeat, 'POST', { name: PLAYER, sector: 0, enterTown: true });
    assert.equal(town.body?.sector, 0, 'explicit town navigation still works after the trip');
});

test('town settlement failure forces the next heartbeat to recover the admitted destination', async () => {
    presence.onlineStore.upsert({ name: PLAYER, sector: 12, character: null });
    const original = kv.compareSet;
    kv.compareSet = async (key, expected, value, options) => {
        if (key === SAVE) throw new Error('save unavailable');
        return original.call(kv, key, expected, value, options);
    };
    try {
        const failed = await request(heartbeat, 'POST', { name: PLAYER, sector: 0 });
        assert.equal(failed.status, 500);
        assert.equal(presence.onlineStore.get(PLAYER), null);
        assert.equal((await travel.getTravelLease(PLAYER))?.destinationSector, 0);
    } finally { kv.compareSet = original; }
    const recovered = await request(heartbeat, 'POST', { name: PLAYER, sector: 12 });
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body?.sector, 0);
    await travel.settleTravelLease(PLAYER);
    assert.equal((await kv.get<Json>(SAVE))?.currentSector, 0);
});

test('town admission fails closed when world-duel evidence cannot be read', async () => {
    const { durablePresenceSectorForWrite } = await import('../_realtime/world-duel-engagement.js');
    const live = presence.onlineStore.upsert({ name: PLAYER, sector: 12, character: null });
    await assert.rejects(durablePresenceSectorForWrite({ get: async () => { throw new Error('evidence unavailable'); } },
        PLAYER, live, 0), /evidence unavailable/);
    assert.equal((await kv.get<Json>(SAVE))?.currentSector, 12);
    assert.equal(await travel.getTravelLease(PLAYER), null);
});

test('a delayed cold heartbeat cannot restore an old town snapshot over a newer journey', async (t) => {
    const original = kv.get.bind(kv);
    let release!: () => void;
    let captured!: () => void;
    const paused = new Promise<void>((resolve) => { captured = resolve; });
    const resume = new Promise<void>((resolve) => { release = resolve; });
    t.mock.method(kv, 'get', async (key: string) => {
        const value = await original(key);
        if (key === SAVE) { captured(); await resume; return { ...(value as Json), currentSector: 0 }; }
        return value;
    });
    const beat = request(heartbeat, 'POST', { name: PLAYER, sector: 0, tile: 1 });
    await paused;
    presence.onlineStore.upsert({ name: PLAYER, sector: 12, tile: 44, character: null });
    release();
    const out = await beat;
    assert.equal(out.status, 200);
    assert.equal(out.body?.sector, 12);
    assert.equal(presence.onlineStore.get(PLAYER)?.tile, 44);
});

test('boot snapshot expiry rebuilds a camp from durable position, never the display sector', async () => {
    const camps = await import('../_realtime/sleeper-camps.js');
    await camps.materializeSleeperCamps([{ name: PLAYER, displayName: PLAYER, sector: 7,
        character: null, pendingAttacker: null, lastSeenAt: 1, connectedAt: 1, locationUnverified: true }]);
    assert.equal((await camps.getSleeperCamp(PLAYER))?.sector, 12);
});

test('a town arrival never materializes an attackable camp', async () => {
    const camps = await import('../_realtime/sleeper-camps.js');
    const lease = { originSector: 12, destinationSector: 0, arrivalAt: Date.now() - 1, moveId: 'town-offline-test' };
    await travel.setTravelLease(PLAYER, lease);
    assert.equal(travel.sleeperSectorForTravelLease(lease, Date.now()), null);
    await camps.materializeSleeperCamps([{ name: PLAYER, displayName: PLAYER, sector: 12,
        character: null, pendingAttacker: null, lastSeenAt: 1, connectedAt: 1 }]);
    assert.equal(await camps.getSleeperCamp(PLAYER), null);
});

test('a camp cannot be KOed before its arrival commits, and cleanup replay cannot undo the KO', async () => {
    const camps = await import('../_realtime/sleeper-camps.js');
    const { settleSleeperKoLocked } = await import('./sleeper-kill.js');
    const lease = { originSector: 12, destinationSector: 13, arrivalAt: Date.now() - 1, moveId: 'camp-arrival-test' };
    await travel.setTravelLease(PLAYER, lease);
    await camps.setSleeperCamp({ name: PLAYER, displayName: PLAYER, sector: 13, createdAt: Date.now() });
    assert.equal((await settleSleeperKoLocked(PLAYER)).status, 409);
    await travel.settleTravelLease(PLAYER, lease);
    // Simulate an arrival whose save committed but lease cleanup was lost.
    await kv.set(travel.travelLeaseKey(PLAYER), lease);
    assert.equal((await settleSleeperKoLocked(PLAYER)).status, 200);
    await travel.settleTravelLease(PLAYER, lease);
    assert.equal((await kv.get<Json>(SAVE))?.currentSector, 0);
    assert.equal((await kv.get<Json>(SAVE))?.currentTile, null);
});

test('Academy trace sees a settled arrival and ceremony replay cannot teleport the player', async () => {
    const academy = (await import('./academy-narrative.js')).default as unknown as Handler;
    const saved = (await kv.get<Json>(SAVE))!;
    await kv.set(SAVE, { ...saved, character: { ...(saved.character as Json), onboardingStep: 'sectorReturn', academyFieldSeal: true } });
    await travel.setTravelLease(PLAYER, { originSector: 12, destinationSector: 13, arrivalAt: Date.now() - 1, moveId: 'academy-arrival-test' });
    assert.equal((await request(academy, 'POST', { playerName: PLAYER, action: 'trace', sector: 13 })).status, 200);
    presence.onlineStore.upsert({ name: PLAYER, sector: 13, character: null });
    assert.equal((await request(academy, 'POST', { playerName: PLAYER, action: 'complete' })).status, 200);
    assert.equal((await request(heartbeat, 'POST', { name: PLAYER, sector: 13 })).body?.sector, 0);
    await travel.setTravelLease(PLAYER, { originSector: 0, destinationSector: 12, arrivalAt: Date.now() - 1, moveId: 'academy-replay-test' });
    await travel.settleTravelLease(PLAYER);
    const replay = await request(academy, 'POST', { playerName: PLAYER, action: 'complete' });
    assert.equal(replay.status, 200);
    assert.equal(replay.body?.replayed, true);
    assert.equal((await kv.get<Json>(SAVE))?.currentSector, 12);
});

// Includes cold Socket.IO module startup and shutdown alongside the full suite.
// Teardown is fully quiesced before the test ends -- the client disconnects and
// reports it, THEN the Socket.IO server and its HTTP server close -- so the
// process reaches exit with no socket mid-handshake. This is the only file in
// the suite whose child holds live TCP handles, and a file-level 'test failed'
// with every subtest green here is a child-process crash (see the exit-code
// line scripts/run-tests.mjs prints), not a leaked rejection: 300+ instrumented
// runs found no unhandled rejection and no open handle. (2026-09-08)
test('a real socket reconnect discards delayed hydration superseded by HTTP presence', { timeout: 30_000 }, async (t) => {
    const sockets = await import('../_realtime/socket.js');
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    // Registered first so it runs LAST (hooks run in registration order): the
    // client hook below must have disconnected before the server goes away.
    t.after(async () => { await sockets.closeSocketServer(); if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve())); });
    sockets.attachSocketServer(server);
    for (let attempt = 0; !sockets.getIo() && attempt < 200; attempt++) await delay(5);
    assert.ok(sockets.getIo());
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const { io } = createRequire(resolve('shinobij.client/package.json'))('socket.io-client');
    const client = io(`http://127.0.0.1:${address.port}`, { transports: ['websocket'], reconnection: false, autoConnect: false,
        auth: { 'x-player-name': PLAYER, 'x-player-token': token } });
    t.after(async () => {
        if (!client.connected) { client.close(); return; }
        await new Promise<void>((resolve) => { client.once('disconnect', () => resolve()); client.close(); });
    });
    await new Promise<void>((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); client.connect(); });
    const walked = await import('../_realtime/walked-tile.js');
    await walked.noteWalkedTile(kv, PLAYER, 12, 77);
    const coldPublished = new Promise<Json>((resolve) => client.once('presence:sector', resolve));
    client.emit('presence', { sector: 55, tile: 1, enterTown: false });
    assert.equal((await coldPublished).sector, 12);
    assert.equal(presence.onlineStore.get(PLAYER)?.tile, 77, 'socket-first hydration also restores the durable walk');
    presence.onlineStore.remove(PLAYER);
    const original = kv.get.bind(kv);
    let release!: () => void;
    let captured!: () => void;
    const paused = new Promise<void>((resolve) => { captured = resolve; });
    const resume = new Promise<void>((resolve) => { release = resolve; });
    t.mock.method(kv, 'get', async (key: string) => {
        const value = await original(key);
        if (key === SAVE) { captured(); await resume; return { ...(value as Json), currentSector: 0 }; }
        return value;
    });
    const published = new Promise<Json>((resolve) => client.once('presence:sector', resolve));
    client.emit('presence', { sector: 55, tile: 1 });
    await paused;
    presence.onlineStore.upsert({ name: PLAYER, sector: 13, tile: 44, character: null });
    release();
    assert.equal((await published).sector, 13);
    assert.equal(presence.onlineStore.get(PLAYER)?.tile, 44);
});
