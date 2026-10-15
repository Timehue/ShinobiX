import { it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import pg from 'pg';
import { startupFailureKind } from './_startup-recovery.js';
import { runtimeTimeouts } from './_runtime-timeouts.js';

// The installed pg-pool implementation is real; its Client is a local transport
// double. No sockets, SQL, live credentials, latency or capacity claims.
class TransportClient extends EventEmitter {
    static unavailable = false;
    _queryable = true;
    _ending = false;
    connected = false;
    callback?: (error?: Error) => void;
    connect(callback: (error?: Error) => void) {
        this.callback = callback;
        if (!TransportClient.unavailable) setImmediate(() => { this.connected = true; callback(); });
    }
    isConnected() { return this.connected; }
    ref() {}
    unref() {}
    end(callback?: () => void) {
        this._ending = true;
        if (!this.connected) this.callback?.(new Error('Connection terminated unexpectedly'));
        this.emit('end');
        callback?.();
    }
}
const CONNECTION_TIMEOUT_MS = 40;
function pool(max: number) {
    return new pg.Pool({ max, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS, idleTimeoutMillis: 0, Client: TransportClient as unknown as pg.PoolConfig['Client'] });
}

// The pool's connection timeouts run on a mocked setTimeout, so each fires
// only when a test ticks the clock. The double still connects on a real
// setImmediate. With real timers, a loaded machine that stalled this process
// for 40 ms let a timeout beat a healthy connect while the fifteen clients
// opened. On Windows (2026-10-14) that failed 1 run in 30 alone and 18 in 100
// with eight runs at once, two of them hanging until killed.
function holdPoolTimers(t: TestContext) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
}

it('the real driver new-connection timeout is retryable and the same pool recovers', async (t) => {
    holdPoolTimers(t);
    const connections = pool(1);
    TransportClient.unavailable = true;
    try {
        const attempt = connections.connect();
        t.mock.timers.tick(CONNECTION_TIMEOUT_MS);
        await assert.rejects(attempt, error => {
            assert.ok(error instanceof Error);
            assert.equal(error.message, 'Connection terminated due to connection timeout');
            assert.equal((error.cause as Error).message, 'Connection terminated unexpectedly');
            assert.equal(startupFailureKind(error), 'transient');
            return true;
        });
        assert.equal(connections.totalCount, 0);
        TransportClient.unavailable = false;
        const recovered = await connections.connect();
        recovered.release();
        assert.equal(connections.totalCount, 1);
    } finally { TransportClient.unavailable = false; await connections.end(); }
});

it('fifteen occupied clients bound the real pool; queued startup acquisition times out and recovers after release', async (t) => {
    assert.equal(runtimeTimeouts({ RAILWAY_ENVIRONMENT: 'test' }).poolMax, 15);
    holdPoolTimers(t);
    const connections = pool(15);
    const clients: pg.PoolClient[] = [];
    try {
        // allSettled, so a failed connect still leaves every acquired client in
        // `clients` for the finally block to release. With Promise.all it
        // stranded them checked out, and pool.end() then waited forever.
        const opened = await Promise.allSettled(Array.from({ length: 15 }, () => connections.connect()));
        for (const result of opened) if (result.status === 'fulfilled') clients.push(result.value);
        assert.equal(clients.length, 15, 'every client the pool allows connects');
        const waiting = connections.connect();
        assert.equal(connections.totalCount, 15);
        assert.equal(connections.waitingCount, 1);
        t.mock.timers.tick(CONNECTION_TIMEOUT_MS - 1);
        assert.equal(connections.waitingCount, 1, 'the queued request waits out the full timeout');
        t.mock.timers.tick(1);
        await assert.rejects(waiting, error => {
            assert.ok(error instanceof Error);
            assert.equal(error.message, 'timeout exceeded when trying to connect');
            assert.equal(startupFailureKind(error), 'transient');
            return true;
        });
        assert.equal(connections.waitingCount, 0);
        clients.pop()!.release();
        const recovered = await connections.connect();
        assert.equal(connections.totalCount, 15, 'recovery does not raise the pool limit');
        recovered.release();
    } finally {
        for (const client of clients) client.release();
        await connections.end();
    }
});
