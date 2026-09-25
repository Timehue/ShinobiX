import assert from "node:assert/strict";
import test from "node:test";
import {
    WARFRONT_CONTEXT_RESTORE_DEADLINE_SECONDS,
    WARFRONT_CONTEXT_RESTORE_LIMIT,
    startWarfrontVisibleCountdown,
    warfrontContextLossRecovery,
    warfrontStageRoute,
    type WarfrontStageFailures,
    type WarfrontStageRoute,
    type WarfrontVisibleClock,
} from "./pet-warfront-stage-fallback";

const fail = (failures: WarfrontStageFailures, route: WarfrontStageRoute): WarfrontStageFailures =>
    route === "webgl" ? { ...failures, webgl: true } : route === "canvas" ? { ...failures, canvas: true } : failures;

test("routing is unchanged while nothing has failed", () => {
    assert.equal(warfrontStageRoute(true, { webgl: false, canvas: false }), "webgl");
    assert.equal(warfrontStageRoute(false, { webgl: false, canvas: false }), "canvas");
});

test("each failure moves one route down and every run of failures ends on the reduced view", () => {
    for (const preferWebGl of [true, false]) {
        let failures: WarfrontStageFailures = { webgl: false, canvas: false };
        const visited: WarfrontStageRoute[] = [];
        let route = warfrontStageRoute(preferWebGl, failures);
        while (route !== "reduced" && visited.length < 5) {
            visited.push(route);
            failures = fail(failures, route);
            route = warfrontStageRoute(preferWebGl, failures);
        }
        assert.equal(route, "reduced", `preferWebGl=${preferWebGl} must reach the reduced view`);
        assert.equal(visited.length, 2, "both graphics routes are tried once before the reduced view");
        assert.equal(new Set(visited).size, 2, "no route is retried automatically");
    }
});

test("the reduced view is absorbing: it cannot fail and only an explicit retry leaves it", () => {
    const both = { webgl: true, canvas: true };
    for (const preferWebGl of [true, false]) {
        assert.equal(warfrontStageRoute(preferWebGl, both), "reduced");
        assert.equal(warfrontStageRoute(preferWebGl, fail(both, "reduced")), "reduced");
        // The retry clears only the Canvas failure; WebGL has already failed once.
        assert.equal(warfrontStageRoute(preferWebGl, { webgl: true, canvas: false }), "canvas");
    }
});

test("a lost WebGL context is restored a bounded number of times, then falls back", () => {
    for (let loss = 1; loss <= WARFRONT_CONTEXT_RESTORE_LIMIT; loss += 1) {
        assert.equal(warfrontContextLossRecovery(loss), "restore", `loss ${loss} may restore in place`);
    }
    assert.equal(warfrontContextLossRecovery(WARFRONT_CONTEXT_RESTORE_LIMIT + 1), "fall-back");
    assert.equal(warfrontContextLossRecovery(WARFRONT_CONTEXT_RESTORE_LIMIT + 5), "fall-back");
    assert.ok(WARFRONT_CONTEXT_RESTORE_DEADLINE_SECONDS > 0 && WARFRONT_CONTEXT_RESTORE_DEADLINE_SECONDS <= 30,
        "a paused battle must not wait on its renderer for more than half a minute");
});

function fakeClock() {
    let hidden = false;
    let next = 1;
    const intervals = new Map<number, () => void>();
    const clock: WarfrontVisibleClock = {
        setInterval: (callback) => { const id = next++; intervals.set(id, callback); return id; },
        clearInterval: (id) => { intervals.delete(id); },
        hidden: () => hidden,
    };
    return {
        clock,
        intervals,
        setHidden(value: boolean) { hidden = value; },
        tick(times = 1) { for (let i = 0; i < times; i += 1) for (const callback of [...intervals.values()]) callback(); },
    };
}

test("the restore deadline counts only visible seconds and fires exactly once", () => {
    const harness = fakeClock();
    let expired = 0;
    const cancel = startWarfrontVisibleCountdown(3, () => { expired += 1; }, harness.clock);
    harness.tick(2);
    assert.equal(expired, 0);
    harness.setHidden(true);
    harness.tick(10);
    assert.equal(expired, 0, "hidden time never spends the budget");
    harness.setHidden(false);
    harness.tick(1);
    assert.equal(expired, 1);
    assert.equal(harness.intervals.size, 0, "the interval is released once it fires");
    harness.tick(5);
    assert.equal(expired, 1);
    cancel();
    assert.equal(expired, 1, "cancelling after expiry is harmless");
});

test("a restored context cancels the deadline before it fires", () => {
    const harness = fakeClock();
    let expired = 0;
    const cancel = startWarfrontVisibleCountdown(2, () => { expired += 1; }, harness.clock);
    harness.tick(1);
    cancel();
    harness.tick(5);
    assert.equal(expired, 0);
    assert.equal(harness.intervals.size, 0);
});
