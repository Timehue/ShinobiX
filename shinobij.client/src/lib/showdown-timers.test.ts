import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShowdownTimerScope } from './showdown-timers';

function clock() {
    let next = 1;
    const jobs = new Map<number, { callback: () => void; delay: number }>();
    return {
        jobs,
        setTimeout(callback: () => void, delay: number) { const id = next++; jobs.set(id, { callback, delay }); return id; },
        clearTimeout(id: number) { jobs.delete(id); },
        fire(id: number) { const job = jobs.get(id); jobs.delete(id); job?.callback(); },
    };
}

test('advancing a beat cancels pending impacts without stranding earlier effect removals', () => {
    const host = clock(), beat = createShowdownTimerScope(host), effects = createShowdownTimerScope(host);
    let damage = 0, visible = true;
    beat.schedule(() => damage++, 400);
    effects.schedule(() => { visible = false; }, 1400);
    beat.clear();
    assert.equal(host.jobs.size, 1);
    host.fire([...host.jobs.keys()][0]);
    assert.equal(damage, 0);
    assert.equal(visible, false);
    assert.equal(effects.size, 0);
});

test('closing repeatedly during nested effects cancels every pending callback', () => {
    const host = clock();
    let staleCallbacks = 0;
    for (let battle = 0; battle < 100; battle++) {
        const beat = createShowdownTimerScope(host), effects = createShowdownTimerScope(host);
        beat.schedule(() => {
            for (let hit = 0; hit < 6; hit++) effects.schedule(() => staleCallbacks++, 7400);
            beat.schedule(() => staleCallbacks++, 900);
        }, 100);
        host.fire([...host.jobs.keys()][0]);
        assert.equal(beat.size, 1, 'executed handles are removed even when the callback schedules more work');
        assert.equal(effects.size, 6);
        beat.clear(); effects.clear();
        assert.equal(host.jobs.size, 0);
        assert.equal(beat.size + effects.size, 0);
    }
    assert.equal(staleCallbacks, 0);
});

test('effect replay can reuse a cleared scope without reviving cancelled work', () => {
    const host = clock(), scope = createShowdownTimerScope(host);
    let calls = 0;
    scope.schedule(() => calls += 100, 5);
    scope.clear(); scope.clear();
    scope.schedule(() => calls++, 5);
    host.fire([...host.jobs.keys()][0]);
    assert.equal(calls, 1);
    assert.equal(scope.size, 0);
});
