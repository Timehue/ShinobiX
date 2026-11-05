import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

test('epoch rotation reconnects the current device and rejects an old token over real Socket.IO', { timeout: 15_000 }, async (t) => {
    process.env.NODE_ENV = 'test';
    process.env.SHINOBIX_QA_MEMORY_KV = '1';
    process.env.SESSION_SECRET = 'revocation-integration-test-secret';
    const { issuePlayerToken, rotatePlayerSessionEpoch } = await import('../_auth.js');
    const sockets = await import('./socket.js');
    const server = createServer();
    const clients: Array<{ close(): void }> = [];
    t.after(async () => {
        clients.forEach(client => client.close());
        await sockets.closeSocketServer();
        if (server.listening) await new Promise<void>(done => server.close(() => done()));
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    sockets.attachSocketServer(server);
    for (let i = 0; !sockets.getIo() && i < 200; i++) await delay(5);
    assert.ok(sockets.getIo());
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const { io } = createRequire(resolve('shinobij.client/package.json'))('socket.io-client');
    const oldToken = issuePlayerToken('revokeddevice')!;
    let currentToken = oldToken;
    const makeClient = (token: () => string) => {
        const client = io(`http://127.0.0.1:${address.port}`, {
            transports: ['websocket'], autoConnect: false, reconnection: true,
            reconnectionDelay: 20, reconnectionDelayMax: 20, randomizationFactor: 0,
            auth: (cb: (auth: Record<string, string>) => void) => cb({
                'x-player-name': 'revokeddevice', 'x-player-token': token(),
            }),
        });
        clients.push(client);
        return client;
    };
    const current = makeClient(() => currentToken);
    const stale = makeClient(() => oldToken);
    for (const client of [current, stale]) {
        await new Promise<void>((done, fail) => {
            client.once('connect', done); client.once('connect_error', fail); client.connect();
        });
    }
    let currentDisconnect = '';
    let reconnected = false;
    let staleError = '';
    current.once('disconnect', (reason: string) => { currentDisconnect = reason; });
    current.once('connect', () => { reconnected = true; });
    stale.once('connect_error', (error: Error) => { staleError = error.message; });
    const epoch = await rotatePlayerSessionEpoch('revokeddevice');
    currentToken = issuePlayerToken('revokeddevice', undefined, epoch)!;
    for (let i = 0; (!reconnected || !staleError) && i < 200; i++) await delay(10);
    assert.equal(reconnected, true, `valid device must reconnect automatically; disconnect reason: ${currentDisconnect}`);
    assert.equal(current.connected, true);
    assert.equal(stale.connected, false);
    assert.equal(staleError, 'unauthorized');
    assert.equal(sockets.getIo()!.sockets.adapter.rooms.get('user:revokeddevice')?.size, 1);
    const { kv } = await import('../_storage.js');
    const { disconnectPlayerSockets } = await import('./notify.js');
    await kv.set('mod:ban:revokeddevice', { until: Date.now() + 60_000, reason: 'test', by: 'test', at: Date.now() });
    let bannedError = '';
    current.once('connect_error', (error: Error) => { bannedError = error.message; });
    disconnectPlayerSockets('revokeddevice');
    for (let i = 0; !bannedError && i < 200; i++) await delay(10);
    assert.equal(bannedError, 'unauthorized');
    assert.equal(current.connected, false, 'a valid token cannot reconnect after a ban');
});
