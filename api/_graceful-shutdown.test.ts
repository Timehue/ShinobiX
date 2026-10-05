import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { drainRuntime, type DrainDependencies } from './_graceful-shutdown.js';
import { runtimeTimeouts } from './_runtime-timeouts.js';
import { drainBackgroundWork, runBackgroundWork, stopBackgroundWork } from './_background-work.js';

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('shutdown drains admitted HTTP/jobs/presence/realtime before final telemetry and pool close', async () => {
    const events: string[] = [];
    const http = deferred(); const jobs = deferred(); const presence = deferred(); const realtime = deferred();
    const metrics = deferred(); const pool = deferred();
    const drain = drainRuntime({
        stopAdmission() { events.push('stop'); },
        drainHttp() { events.push('http'); return http.promise; },
        drainBackground() { events.push('jobs'); return jobs.promise; },
        savePresence() { events.push('presence'); return presence.promise; },
        closeRealtime() { events.push('realtime'); return realtime.promise; },
        flushMetrics() { events.push('metrics'); return metrics.promise; },
        closeStorage() { events.push('pool'); return pool.promise; },
        forceCloseHttp() { assert.fail('normal drain must not force-close requests'); },
        reportError() { assert.fail('normal drain must not report an error'); },
    }, 10_000);
    assert.deepEqual(events.slice(0, 2), ['stop', 'http']);
    http.resolve(); presence.resolve(); realtime.resolve(); await tick();
    assert.equal(events.includes('metrics'), false, 'background work keeps storage available after HTTP finishes');
    jobs.resolve(); await tick();
    assert.equal(events.at(-1), 'metrics');
    assert.equal(events.includes('pool'), false, 'telemetry must finish before pool close');
    metrics.resolve(); await tick(); assert.equal(events.at(-1), 'pool');
    pool.resolve(); const result = await drain;
    assert.equal(result.outcome, 'drained'); assert.equal(result.stage, 'storage');
    assert.ok(result.elapsedMs >= 0);
});

test('shutdown remains bounded when an admitted request hangs and never closes its pool early', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let forced = 0; let poolClosed = false;
    const drain = drainRuntime({
        stopAdmission() {}, drainHttp: () => new Promise(() => undefined),
        drainBackground: async () => undefined, savePresence: async () => undefined, closeRealtime: async () => undefined,
        flushMetrics: async () => undefined, closeStorage: async () => { poolClosed = true; },
        forceCloseHttp() { forced++; }, reportError() {},
    }, 1000);
    t.mock.timers.tick(1000);
    assert.equal((await drain).outcome, 'drain-timeout');
    assert.equal(forced, 1); assert.equal(poolClosed, false);
});

test('best-effort flush errors are reported without skipping pool closure', async () => {
    const errors: string[] = [];
    let closed = false;
    const deps: DrainDependencies = {
        stopAdmission() {}, drainHttp: async () => undefined, closeRealtime: async () => undefined,
        savePresence: async () => { throw new Error('presence failed'); }, drainBackground: async () => undefined,
        flushMetrics: async () => { throw new Error('metrics failed'); },
        closeStorage: async () => { closed = true; }, forceCloseHttp() {},
        reportError(stage) { errors.push(stage); },
    };
    assert.equal((await drainRuntime(deps, 10_000)).outcome, 'drained');
    assert.deepEqual(errors, ['presence', 'telemetry']); assert.equal(closed, true);
});

test('runtime timeout configuration rejects non-finite/disabled settings and bounds valid overrides', () => {
    assert.deepEqual(runtimeTimeouts({}), { statementMs: 30_000, connectionMs: 15_000, poolMax: 5, shutdownMs: 50_000 });
    assert.equal(runtimeTimeouts({ RAILWAY_ENVIRONMENT: 'test' }).poolMax, 15);
    const invalid = runtimeTimeouts({ PG_STATEMENT_TIMEOUT_MS: 'Infinity', PG_CONNECTION_TIMEOUT_MS: '-1', PG_POOL_MAX: 'NaN', SHUTDOWN_TIMEOUT_MS: '0' });
    assert.deepEqual(invalid, runtimeTimeouts({}));
    const bounded = runtimeTimeouts({ PG_STATEMENT_TIMEOUT_MS: '900000', PG_CONNECTION_TIMEOUT_MS: '900000', PG_POOL_MAX: '900000', SHUTDOWN_TIMEOUT_MS: '900000' });
    assert.deepEqual(bounded, { statementMs: 120_000, connectionMs: 60_000, poolMax: 100, shutdownMs: 300_000 });
});

test('Railway shutdown grace exceeds the default runtime drain by at least ten seconds', async () => {
    const config = JSON.parse(await readFile('railway.json', 'utf8'));
    const graceMs = Number(config.deploy?.drainingSeconds) * 1000;
    assert.ok(Number.isSafeInteger(graceMs));
    assert.ok(graceMs >= runtimeTimeouts({}).shutdownMs + 10_000,
        'Railway SIGKILL must leave time for the default drain and process teardown');
});

test('background shutdown rejects new admission and waits for the whole admitted job', async () => {
    const admitted = deferred(); let ran = false; let finished = false;
    const job = runBackgroundWork(async () => { ran = true; await admitted.promise; finished = true; });
    await tick(); assert.equal(ran, true);
    stopBackgroundWork();
    await runBackgroundWork(async () => assert.fail('shutdown must reject a new timer job'));
    let drained = false;
    const drain = drainBackgroundWork().then(() => { drained = true; });
    await tick(); assert.equal(drained, false); assert.equal(finished, false);
    admitted.resolve(); await Promise.all([job, drain]);
    assert.equal(drained, true); assert.equal(finished, true);
});
