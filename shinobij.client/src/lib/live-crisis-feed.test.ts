import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLiveCrisisFeed, LIVE_CRISIS_STOP_GRACE_MS, type LiveCrisisFrame } from './live-crisis-feed.ts';
import type { WorldCrisisProjection } from '../../../shared/world-crisis';
import type { WorldCrisis80Projection } from '../../../shared/world-crisis-80';

function harness() {
    const crisis = { runId: 'a', status: 'active' } as unknown as WorldCrisisProjection;
    const reckoning = { runId: 'b', status: 'armed' } as unknown as WorldCrisis80Projection;
    const env = {
        fetches: 0,
        pollsStarted: 0,
        pollsStopped: 0,
        failNext: false,
        refresh: null as null | (() => Promise<void>),
        timers: new Map<number, { fn: () => void; ms: number }>(),
    };
    let timerId = 0;
    const subscribe = createLiveCrisisFeed({
        fetchCrisis: async () => { env.fetches += 1; return env.failNext ? null : crisis; },
        fetchReckoning: async () => (env.failNext ? null : reckoning),
        startPoll: (refresh) => {
            env.pollsStarted += 1;
            env.refresh = refresh;
            void refresh(); // visiblePoll's immediate first run
            return () => { env.pollsStopped += 1; };
        },
        setTimer: (fn, ms) => { env.timers.set(++timerId, { fn, ms }); return timerId; },
        clearTimer: (handle) => { env.timers.delete(handle as number); },
    });
    const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
    const runTimers = () => { for (const [id, timer] of [...env.timers]) { env.timers.delete(id); timer.fn(); } };
    return { env, subscribe, flush, runTimers, crisis, reckoning };
}

test('the first herald starts one poll and receives its first frame', async () => {
    const { env, subscribe, flush, crisis, reckoning } = harness();
    const frames: LiveCrisisFrame[] = [];
    subscribe((frame) => frames.push(frame));
    await flush();
    assert.equal(env.pollsStarted, 1);
    assert.equal(env.fetches, 1);
    assert.deepEqual(frames.at(-1), { crisis, reckoning });
});

test('a screen change (unmount then remount) neither refetches nor restarts the poll', async () => {
    const { env, subscribe, flush, crisis } = harness();
    const stop = subscribe(() => undefined);
    await flush();
    stop();
    const frames: LiveCrisisFrame[] = [];
    subscribe((frame) => frames.push(frame));
    assert.equal(env.fetches, 1, 'the remount must not trigger another request');
    assert.equal(env.pollsStarted, 1);
    assert.equal(env.timers.size, 0, 'the pending stop is cancelled');
    assert.equal(frames[0]?.crisis, crisis, 'the remounted herald gets the latest frame at once');
});

test('the poll stops once no herald is mounted for the grace period, and restarts fresh', async () => {
    const { env, subscribe, flush, runTimers } = harness();
    const stop = subscribe(() => undefined);
    await flush();
    stop();
    assert.equal([...env.timers.values()][0]?.ms, LIVE_CRISIS_STOP_GRACE_MS);
    runTimers();
    assert.equal(env.pollsStopped, 1);
    subscribe(() => undefined);
    await flush();
    assert.equal(env.pollsStarted, 2);
    assert.equal(env.fetches, 2, 'a herald mounted after the poll stopped fetches immediately');
});

test('a failed read keeps the last good frame', async () => {
    const { env, subscribe, flush, crisis, reckoning } = harness();
    const frames: LiveCrisisFrame[] = [];
    subscribe((frame) => frames.push(frame));
    await flush();
    env.failNext = true;
    await env.refresh!();
    assert.deepEqual(frames.at(-1), { crisis, reckoning });
});
