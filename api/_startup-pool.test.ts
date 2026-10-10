import { it } from 'node:test';
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
function pool(max: number) {
    return new pg.Pool({ max, connectionTimeoutMillis: 40, idleTimeoutMillis: 0, Client: TransportClient as unknown as pg.PoolConfig['Client'] });
}

it('the real driver new-connection timeout is retryable and the same pool recovers', async () => {
    const connections = pool(1);
    TransportClient.unavailable = true;
    try {
        await assert.rejects(connections.connect(), error => {
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

it('fifteen occupied clients bound the real pool; queued startup acquisition times out and recovers after release', async () => {
    assert.equal(runtimeTimeouts({ RAILWAY_ENVIRONMENT: 'test' }).poolMax, 15);
    const connections = pool(15);
    const clients: pg.PoolClient[] = [];
    const keepAlive = setInterval(() => undefined, 1000);
    try {
        clients.push(...await Promise.all(Array.from({ length: 15 }, () => connections.connect())));
        const waiting = connections.connect();
        assert.equal(connections.totalCount, 15);
        assert.equal(connections.waitingCount, 1);
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
        clearInterval(keepAlive);
    }
});
