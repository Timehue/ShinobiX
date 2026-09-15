import assert from 'node:assert/strict';
import test from 'node:test';
import { retryArenaSettlement } from './arena-settlement-retry';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test('successful settlement immediately clears its deadline', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const clear = t.mock.method(globalThis, 'clearTimeout');
    let calls = 0;
    const result = await retryArenaSettlement(async () => { calls++; return 'receipt'; }, new AbortController().signal);
    assert.equal(result, 'receipt'); assert.equal(calls, 1); assert.equal(clear.mock.callCount(), 1);
    t.mock.timers.tick(60_000); await flush(); assert.equal(calls, 1);
});

test('failures retain four attempts with backoff, then allow a fresh manual retry', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let calls = 0;
    const controller = new AbortController();
    const pending = retryArenaSettlement(async () => { calls++; throw new Error('offline'); }, controller.signal);
    const rejected = assert.rejects(pending, /offline/);
    await flush(); assert.equal(calls, 1);
    for (const delay of [600, 1200, 2400]) { t.mock.timers.tick(delay); await flush(); }
    await rejected; assert.equal(calls, 4);
    assert.equal(await retryArenaSettlement(async () => 'recovered', controller.signal), 'recovered');
});

test('an aborted mount never dispatches a settlement mutation', async () => {
    const controller = new AbortController(); let calls = 0;
    const pending = retryArenaSettlement(async () => { calls++; return 1; }, controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' }); assert.equal(calls, 0);
});

test('unmount aborts an in-flight request and releases the deadline', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const clear = t.mock.method(globalThis, 'clearTimeout');
    const controller = new AbortController(); let requestSignal: AbortSignal | undefined, calls = 0;
    const pending = retryArenaSettlement(signal => { calls++; requestSignal = signal; return new Promise(() => {}); }, controller.signal);
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await flush(); controller.abort(); await rejected;
    assert.equal(requestSignal?.aborted, true); assert.equal(clear.mock.callCount(), 1);
    t.mock.timers.tick(60_000); await flush(); assert.equal(calls, 1);
});

test('unmount cancels a retry already waiting in backoff', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const controller = new AbortController(); let calls = 0;
    const pending = retryArenaSettlement(async () => { calls++; throw new Error('offline'); }, controller.signal);
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await flush(); controller.abort(); await rejected;
    t.mock.timers.tick(60_000); await flush(); assert.equal(calls, 1);
});

test('stalled attempts abort their transport before retrying and remain bounded', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const signals: AbortSignal[] = [];
    const pending = retryArenaSettlement(signal => {
        assert(signals.every(previous => previous.aborted));
        signals.push(signal); return new Promise(() => {});
    }, new AbortController().signal, { timeoutMs: 100, backoffMs: 1 });
    const rejected = assert.rejects(pending, /timed out/);
    await flush();
    for (let attempt = 0; attempt < 4; attempt++) {
        t.mock.timers.tick(100); await flush(); assert.equal(signals[attempt].aborted, true);
        if (attempt < 3) { t.mock.timers.tick(2 ** attempt); await flush(); }
    }
    await rejected; assert.equal(signals.length, 4);
});

test('late completion from a transport without cancellation cannot revive an abandoned retry', async () => {
    const controller = new AbortController(); let resolveRequest!: (result: string) => void;
    const pending = retryArenaSettlement(() => new Promise<string>(resolve => { resolveRequest = resolve; }), controller.signal);
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await flush(); controller.abort(); await rejected;
    resolveRequest('late receipt'); await flush();
});
