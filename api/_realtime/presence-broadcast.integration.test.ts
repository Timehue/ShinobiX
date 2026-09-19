import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// End to end over real Socket.IO: HP ticks no longer fan out to the sector, and
// a visible change reaches a current client as one batched `presence:updates`
// frame and an older client as the legacy per-player `presence:update`.

type Json = Record<string, unknown>;
const MOVER = 'batchmover';
const WATCHER = 'batchwatcher';
const LEGACY = 'batchlegacy';
let kv: typeof import('../_storage.js').kv;
let tokens: Record<string, string>;

before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SHINOBIX_QA_MEMORY_KV = '1';
    process.env.SESSION_SECRET = 'presence-batch-integration-secret-with-enough-entropy';
    ({ kv } = await import('../_storage.js'));
    const auth = await import('../_auth.js');
    tokens = Object.fromEntries([MOVER, WATCHER, LEGACY].map((name) => [name, auth.issuePlayerToken(name)!]));
    for (const name of [MOVER, WATCHER, LEGACY]) {
        await kv.set(`save:${name}`, { _saveVersion: 1, _saveAt: Date.now(), worldGeoV: 2, currentSector: 21, currentTile: 5,
            character: { name, level: 7, hp: 100, maxHp: 100 } });
    }
});

// Teardown mirrors api/player/world-position.integration.test.ts: every client
// disconnects and reports it BEFORE the Socket.IO and HTTP servers close.
test('HP ticks stay quiet; visible changes arrive batched (current) or per player (older tab)', { timeout: 30_000 }, async (t) => {
    const sockets = await import('./socket.js');
    const server = createServer();
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    t.after(async () => { await sockets.closeSocketServer(); if (server.listening) await new Promise<void>((done) => server.close(() => done())); });
    sockets.attachSocketServer(server);
    for (let attempt = 0; !sockets.getIo() && attempt < 200; attempt++) await delay(5);
    assert.ok(sockets.getIo());
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const { io } = createRequire(resolve('shinobij.client/package.json'))('socket.io-client');

    const clients: Array<{ connected: boolean; once: (e: string, f: () => void) => void; close: () => void }> = [];
    t.after(async () => {
        for (const client of clients) {
            if (!client.connected) { client.close(); continue; }
            await new Promise<void>((done) => { client.once('disconnect', () => done()); client.close(); });
        }
    });
    const events: Record<string, Array<[string, Json]>> = { [MOVER]: [], [WATCHER]: [], [LEGACY]: [] };
    const connect = async (name: string, batched: boolean) => {
        const client = io(`http://127.0.0.1:${address.port}`, { transports: ['websocket'], reconnection: false, autoConnect: false,
            auth: { 'x-player-name': name, 'x-player-token': tokens[name], ...(batched ? { presenceBatch: 1 } : {}) } });
        clients.push(client);
        client.onAny((event: string, payload: Json) => events[name].push([event, payload]));
        await new Promise<void>((done, fail) => { client.once('connect', done); client.once('connect_error', fail); client.connect(); });
        const placed = new Promise<void>((done) => client.once('presence:sector', () => done()));
        client.emit('presence', { sector: 21, displayName: name, character: { name, level: 7, hp: 100, maxHp: 100 } });
        await placed;
        return client;
    };
    const mover = await connect(MOVER, true);
    await connect(WATCHER, true);
    await connect(LEGACY, false);
    await delay(700);
    // Arrivals ride the batch too (a join and an update are both an upsert).
    const arrivals = events[WATCHER].filter(([event]) => event === 'presence:updates')
        .flatMap(([, payload]) => (payload.players as Json[]).map((p) => p.name));
    assert.ok(arrivals.includes(LEGACY), 'the watcher hears of a later arrival through the batch');
    assert.equal(events[WATCHER].some(([event]) => event === 'presence:join'), false);
    for (const list of Object.values(events)) list.length = 0;

    // An idle-regen tick changes only HP — nothing a sector-mate receives.
    mover.emit('presence', { sector: 21, displayName: MOVER, character: { name: MOVER, level: 7, hp: 63, maxHp: 100 } });
    await delay(1_300);
    assert.deepEqual(events[WATCHER].map(([event]) => event), [], 'an HP tick must not reach the sector');
    assert.deepEqual(events[LEGACY].map(([event]) => event), []);

    // A level-up is visible, so it goes out on the next flush.
    mover.emit('presence', { sector: 21, displayName: MOVER, character: { name: MOVER, level: 8, hp: 63, maxHp: 100 } });
    await delay(1_000);
    const batched = events[WATCHER].filter(([event]) => event.startsWith('presence:'));
    assert.deepEqual(batched.map(([event]) => event), ['presence:updates']);
    const players = batched[0][1].players as Json[];
    assert.deepEqual(players.map((p) => [p.name, p.level]), [[MOVER, 8]]);
    const legacy = events[LEGACY].filter(([event]) => event.startsWith('presence:'));
    assert.deepEqual(legacy.map(([event]) => event), ['presence:update'], 'an older tab still gets the per-player frame');
    assert.equal((legacy[0][1].player as Json).level, 8);
});

// The fixes for the three roster-refresh regressions, over the wire: a fight
// flag flipped by a fight host, and a trip that matures on a socket-less
// player's read, both reach a live client without waiting for a full roster.
test('a fight host\'s flag flip and a socket-less trip reach a live client', { timeout: 30_000 }, async (t) => {
    const sockets = await import('./socket.js');
    const { onlineStore } = await import('./online-store.js');
    const { noteBattleEnded, noteBattleStarted } = await import('./battle-projection.js');
    const server = createServer();
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    t.after(async () => { await sockets.closeSocketServer(); if (server.listening) await new Promise<void>((done) => server.close(() => done())); });
    sockets.attachSocketServer(server);
    for (let attempt = 0; !sockets.getIo() && attempt < 200; attempt++) await delay(5);
    assert.ok(sockets.getIo());
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const { io } = createRequire(resolve('shinobij.client/package.json'))('socket.io-client');

    const watcher = io(`http://127.0.0.1:${address.port}`, { transports: ['websocket'], reconnection: false, autoConnect: false,
        auth: { 'x-player-name': WATCHER, 'x-player-token': tokens[WATCHER], presenceBatch: 1 } });
    t.after(async () => {
        if (!watcher.connected) { watcher.close(); return; }
        await new Promise<void>((done) => { watcher.once('disconnect', () => done()); watcher.close(); });
    });
    const events: Array<[string, Json]> = [];
    watcher.onAny((event: string, payload: Json) => events.push([event, payload]));
    await new Promise<void>((done, fail) => { watcher.once('connect', done); watcher.once('connect_error', fail); watcher.connect(); });
    const placed = new Promise<void>((done) => watcher.once('presence:sector', () => done()));
    watcher.emit('presence', { sector: 21, displayName: WATCHER, character: { name: WATCHER, level: 7 } });
    await placed;

    // A peer in sector 21 with no socket at all (the HTTP heartbeat's world).
    onlineStore.upsert({ name: MOVER, sector: 21, character: { name: MOVER, level: 7 } });
    await delay(700);
    events.length = 0;

    noteBattleStarted(MOVER);
    await delay(800);
    const started = events.filter(([event]) => event === 'presence:updates').flatMap(([, p]) => p.players as Json[]);
    assert.deepEqual(started.map((p) => [p.name, p.inBattle]), [[MOVER, true]], 'peers see the fight start');
    noteBattleEnded(MOVER);
    await delay(800);
    const ended = events.filter(([event]) => event === 'presence:updates').flatMap(([, p]) => p.players as Json[]);
    assert.deepEqual(ended.map((p) => [p.name, p.inBattle]), [[MOVER, true], [MOVER, false]], 'and the fight end');

    events.length = 0;
    assert.ok(onlineStore.startTravel(MOVER, 22, Date.now() + 50));
    await delay(80);
    assert.equal(onlineStore.get(MOVER)?.sector, 22, 'the trip settles on a plain read');
    await delay(200);
    const leaves = events.filter(([event]) => event === 'presence:leave').flatMap(([, p]) => p.names as string[]);
    assert.deepEqual(leaves, [MOVER], 'the origin hears the departure');
    onlineStore.remove(MOVER);
});
