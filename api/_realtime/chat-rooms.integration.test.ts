import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CHAT_PUSH_EVENT, CHAT_SUBSCRIBE_EVENT, CHAT_UNSUBSCRIBE_EVENT } from '../../shared/chat-push.js';

// Over real Socket.IO: a reader joins a tavern or clan room only after the same
// membership check the chat's GET applies, hears contentless hints while
// joined, and stops hearing them after unsubscribing.

type Json = Record<string, unknown>;
type Client = {
    connected: boolean;
    once: (e: string, f: (...args: unknown[]) => void) => void;
    on: (e: string, f: (payload: Json) => void) => void;
    emit: (e: string, payload: unknown) => void;
    timeout: (ms: number) => { emitWithAck: (e: string, payload: unknown) => Promise<Json> };
    connect: () => void;
    close: () => void;
};
const MEMBER = 'roommember';
const RIVAL = 'roomrival';
const GUEST = 'roomguest';
const VILLAGE = 'Frostfang Village';
let tokens: Record<string, string>;

before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SHINOBIX_QA_MEMORY_KV = '1';
    process.env.SESSION_SECRET = 'chat-rooms-integration-secret-with-enough-entropy';
    const { kv } = await import('../_storage.js');
    const auth = await import('../_auth.js');
    const { authKey } = await import('../player-auth.js');
    tokens = Object.fromEntries([MEMBER, RIVAL, GUEST].map((name) => [name, auth.issuePlayerToken(name)!]));
    await kv.set(`save:${MEMBER}`, { _saveVersion: 1, character: { name: MEMBER, village: VILLAGE, clan: 'Storm Clan', level: 9 } });
    await kv.set(`save:${RIVAL}`, { _saveVersion: 1, character: { name: RIVAL, village: 'Moonshadow Village', clan: 'Ash Clan', level: 9 } });
    await kv.set(`save:${GUEST}`, { _saveVersion: 1, character: { name: GUEST, village: VILLAGE, clan: 'Storm Clan', level: 2 } });
    await kv.set(authKey(GUEST), { guest: true });
});

test('tavern and clan rooms admit only the readers their GETs admit', { timeout: 30_000 }, async (t) => {
    const sockets = await import('./socket.js');
    const notify = await import('./notify.js');
    const server = createServer();
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    t.after(async () => { await sockets.closeSocketServer(); if (server.listening) await new Promise<void>((done) => server.close(() => done())); });
    sockets.attachSocketServer(server);
    for (let attempt = 0; !sockets.getIo() && attempt < 200; attempt++) await delay(5);
    assert.ok(sockets.getIo());
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const { io } = createRequire(resolve('shinobij.client/package.json'))('socket.io-client');

    const clients: Client[] = [];
    t.after(async () => {
        for (const client of clients) {
            if (!client.connected) { client.close(); continue; }
            await new Promise<void>((done) => { client.once('disconnect', () => done()); client.close(); });
        }
    });
    const hints: Record<string, Json[]> = { [MEMBER]: [], [RIVAL]: [], [GUEST]: [] };
    const connect = async (name: string): Promise<Client> => {
        const client = io(`http://127.0.0.1:${address.port}`, { transports: ['websocket'], reconnection: false, autoConnect: false,
            auth: { 'x-player-name': name, 'x-player-token': tokens[name] } }) as Client;
        clients.push(client);
        client.on(CHAT_PUSH_EVENT, (payload) => hints[name].push(payload));
        await new Promise<void>((done, fail) => { client.once('connect', () => done()); client.once('connect_error', fail); client.connect(); });
        return client;
    };
    const subscribe = (client: Client, channel: string, key: unknown) =>
        client.timeout(2_000).emitWithAck(CHAT_SUBSCRIBE_EVENT, { channel, key });

    const member = await connect(MEMBER);
    const rival = await connect(RIVAL);
    const guest = await connect(GUEST);

    assert.deepEqual(await subscribe(member, 'village', VILLAGE), { ok: true });
    assert.deepEqual(await subscribe(member, 'clan', 'Storm Clan'), { ok: true });
    assert.deepEqual(await subscribe(rival, 'village', VILLAGE), { ok: false, reason: 'forbidden' }, 'another village');
    assert.deepEqual(await subscribe(rival, 'clan', 'Storm Clan'), { ok: false, reason: 'forbidden' }, 'another clan');
    assert.deepEqual(await subscribe(guest, 'village', VILLAGE), { ok: false, reason: 'forbidden' }, 'the tavern is shut to guests');
    // Clan chat reading stays open to guests, matching its GET.
    assert.deepEqual(await subscribe(guest, 'clan', 'Storm Clan'), { ok: true });
    assert.deepEqual(await subscribe(rival, 'lobby', 'x'), { ok: false, reason: 'invalid' });
    assert.deepEqual(await subscribe(rival, 'village', ''), { ok: false, reason: 'invalid' });

    notify.kickVillageChat(VILLAGE, 101);
    notify.kickClanChat('stormclan', 202);
    await delay(150);
    assert.deepEqual(hints[MEMBER], [
        { channel: 'village', key: 'frostfang-village', ts: 101 },
        { channel: 'clan', key: 'stormclan', ts: 202 },
    ]);
    assert.deepEqual(hints[RIVAL], [], 'refused joins hear nothing');
    assert.deepEqual(hints[GUEST], [{ channel: 'clan', key: 'stormclan', ts: 202 }]);

    member.emit(CHAT_UNSUBSCRIBE_EVENT, { channel: 'village', key: VILLAGE });
    await delay(100);
    hints[MEMBER].length = 0;
    notify.kickVillageChat(VILLAGE, 303);
    notify.kickClanChat('stormclan', 404);
    await delay(150);
    assert.deepEqual(hints[MEMBER], [{ channel: 'clan', key: 'stormclan', ts: 404 }], 'unsubscribing leaves only that room');
});

test('a subscribe loop is throttled per socket', { timeout: 30_000 }, async (t) => {
    const sockets = await import('./socket.js');
    const server = createServer();
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    t.after(async () => { await sockets.closeSocketServer(); if (server.listening) await new Promise<void>((done) => server.close(() => done())); });
    sockets.attachSocketServer(server);
    for (let attempt = 0; !sockets.getIo() && attempt < 200; attempt++) await delay(5);
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const { io } = createRequire(resolve('shinobij.client/package.json'))('socket.io-client');
    const client = io(`http://127.0.0.1:${address.port}`, { transports: ['websocket'], reconnection: false, autoConnect: false,
        auth: { 'x-player-name': MEMBER, 'x-player-token': tokens[MEMBER] } }) as Client;
    t.after(async () => {
        if (!client.connected) { client.close(); return; }
        await new Promise<void>((done) => { client.once('disconnect', () => done()); client.close(); });
    });
    await new Promise<void>((done, fail) => { client.once('connect', () => done()); client.once('connect_error', fail); client.connect(); });

    const results = await Promise.all(Array.from({ length: 12 }, () =>
        client.timeout(2_000).emitWithAck(CHAT_SUBSCRIBE_EVENT, { channel: 'village', key: VILLAGE })));
    assert.equal(results.filter((r) => r.ok === true).length, 8);
    assert.equal(results.filter((r) => r.reason === 'throttled').length, 4);
});
