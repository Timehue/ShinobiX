import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSharedNow, subscribeSharedNow } from './shared-now-store.ts';

test('countdowns share one ticker, stop when hidden/unmounted, and catch up on return', t => {
    const events = new Set<() => void>();
    const intervals = new Map<number, () => void>();
    let clock = 1000;
    let id = 0;
    const doc = { hidden: false,
        addEventListener: (_: string, fn: () => void) => events.add(fn),
        removeEventListener: (_: string, fn: () => void) => events.delete(fn),
    };
    const win = {
        setInterval: (fn: () => void) => { intervals.set(++id, fn); return id; },
        clearInterval: (key: number) => { intervals.delete(key); },
    };
    for (const [key, value] of [['document', doc], ['window', win]] as const) {
        const prior = Object.getOwnPropertyDescriptor(globalThis, key);
        Object.defineProperty(globalThis, key, { configurable: true, value });
        t.after(() => { if (prior) Object.defineProperty(globalThis, key, prior); else Reflect.deleteProperty(globalThis, key); });
    }
    t.mock.method(Date, 'now', () => clock);
    let ticks = 0;
    const stopA = subscribeSharedNow(() => { ticks++; });
    const stopB = subscribeSharedNow(() => {});
    assert.equal(getSharedNow(), 1000);
    assert.equal(intervals.size, 1);
    assert.equal(events.size, 1);
    stopA();
    assert.equal(intervals.size, 1);
    doc.hidden = true;
    events.forEach(fn => fn());
    assert.equal(intervals.size, 0);
    clock += 3_600_000;
    doc.hidden = false;
    events.forEach(fn => fn());
    assert.equal(getSharedNow(), clock);
    assert.equal(intervals.size, 1);
    assert.equal(ticks, 1);
    stopB();
    assert.equal(intervals.size, 0);
    assert.equal(events.size, 0);
    // StrictMode-style mount/cleanup and later navigation leave no resources.
    for (let i = 0; i < 100; i++) {
        clock += 1000;
        const stop = subscribeSharedNow(() => {});
        assert.equal(getSharedNow(), clock);
        stop();
    }
    assert.equal(intervals.size, 0);
    assert.equal(events.size, 0);
});
