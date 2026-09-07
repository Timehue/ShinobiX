import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { visiblePoll } from './poll.ts';

function setup(t: TestContext) {
    const listeners = new Set<() => void>();
    const timers = new Map<number, () => void>();
    let id = 0;
    const doc = { hidden: false,
        addEventListener: (_: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    };
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
    t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document'); });
    t.mock.method(globalThis, 'setTimeout', (fn: () => void) => { timers.set(++id, fn); return id; });
    t.mock.method(globalThis, 'clearTimeout', (key: number) => { timers.delete(key); });
    return {
        timers, listeners,
        tick() { const next = timers.entries().next().value; assert.ok(next); timers.delete(next[0]); next[1](); },
        visible(value: boolean) { doc.hidden = !value; for (const fn of listeners) fn(); },
    };
}

test('slow polls and rapid foreground events never overlap, including the initial fetch', async t => {
    const env = setup(t);
    let requests = 0;
    let release!: () => void;
    const stop = visiblePoll(() => { requests++; return new Promise<void>(r => { release = r; }); }, 1000, 0, { immediate: true });
    assert.equal(requests, 1);
    assert.equal(env.timers.size, 0);
    for (let i = 0; i < 20; i++) { env.visible(false); env.visible(true); }
    assert.equal(requests, 1);
    release();
    await Promise.resolve();
    assert.equal(env.timers.size, 1);
    env.tick();
    assert.equal(requests, 2);
    stop();
    release();
    await Promise.resolve();
    assert.equal(env.timers.size, 0);
    assert.equal(env.listeners.size, 0);
});

test('hidden screens have no timer and resume immediately with one fresh poll', async t => {
    const env = setup(t);
    let requests = 0;
    const stop = visiblePoll(() => { requests++; }, 1000, 0);
    assert.equal(requests, 0);
    assert.equal(env.timers.size, 1);
    env.visible(false);
    assert.equal(env.timers.size, 0);
    env.visible(true);
    assert.equal(requests, 1);
    await Promise.resolve();
    assert.equal(env.timers.size, 1);
    stop();
});

test('a rejected request retries only on the next scheduled tick and cleanup stops it', async t => {
    const env = setup(t);
    t.mock.method(console, 'error', () => {});
    let requests = 0;
    const stop = visiblePoll(() => { requests++; throw new Error('offline'); }, 1000, 0, { immediate: true });
    assert.equal(requests, 1);
    assert.equal(env.timers.size, 1);
    env.tick();
    assert.equal(requests, 2);
    assert.equal(env.timers.size, 1);
    stop();
    env.visible(false); env.visible(true);
    assert.equal(requests, 2);
});

test('a poll mounted in the background defers its initial fetch until foreground', async t => {
    const env = setup(t);
    env.visible(false);
    let requests = 0;
    const stop = visiblePoll(() => { requests++; }, 1000, 0, { immediate: true });
    assert.equal(requests, 0);
    assert.equal(env.timers.size, 0);
    env.visible(true);
    assert.equal(requests, 1);
    stop();
    await Promise.resolve();
    assert.equal(env.timers.size, 0);
});
