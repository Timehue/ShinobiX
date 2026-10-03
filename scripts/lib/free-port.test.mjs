import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { freePort } from './free-port.mjs';

function listen(server, port) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, () => resolve(server.address().port));
    });
}

function close(server) {
    return new Promise((resolve) => server.close(() => resolve()));
}

test('hands back a port a server can bind at once, on every interface', async () => {
    const port = await freePort();
    assert.ok(Number.isInteger(port) && port > 0 && port < 65_536, `port ${port}`);
    // Bound exactly the way server.ts binds: no host.
    const server = createServer();
    assert.equal(await listen(server, port), port);
    await close(server);
});

test('never hands back a port another server is holding', async () => {
    const holder = createServer();
    const held = await listen(holder, 0);
    try {
        for (let i = 0; i < 25; i += 1) assert.notEqual(await freePort(), held);
    } finally {
        await close(holder);
    }
});
