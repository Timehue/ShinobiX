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
