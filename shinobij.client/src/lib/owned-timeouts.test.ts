import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnedTimeouts } from './owned-timeouts';

test('effect timers release callbacks when fired, canceled, or the battle unmounts', () => {
    let next = 0, calls = 0;
    const host = new Map<number, () => void>();
    const timers = createOwnedTimeouts(run => { host.set(++next, run); return next; }, id => { host.delete(id); });
    const fire = (id: number) => { const run = host.get(id); host.delete(id); run?.(); };
    for (let i = 0; i < 1000; i++) fire(timers.schedule(() => calls++, 100));
    assert.equal(calls, 1000);
    assert.equal(timers.size, 0);
    const canceled = timers.schedule(() => calls++, 100);
    timers.cancel(canceled);
    fire(canceled);
    const pending = timers.schedule(() => { calls++; timers.schedule(() => calls++, 50); }, 100);
    timers.clear();
    fire(pending);
    assert.equal(calls, 1000);
    assert.equal(host.size, 0);
    assert.equal(timers.size, 0);
    // StrictMode's cleanup/setup cycle can reuse the same owner.
    fire(timers.schedule(() => calls++, 100));
    assert.equal(calls, 1001);
});
