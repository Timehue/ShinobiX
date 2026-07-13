import assert from "node:assert/strict";
import test from "node:test";

import {
    completeScreenTransition,
    createScreenTransitionTracker,
    startScreenTransition,
} from "./screen-transition-timing";

test("screen transition timing measures intent-to-ready rather than prior dwell", () => {
    const tracker = createScreenTransitionTracker();
    completeScreenTransition(tracker, "village", 100);

    // Thirty seconds spent in Village is dwell time and must not enter the metric.
    startScreenTransition(tracker, "missions", 30_100);
    assert.deepEqual(completeScreenTransition(tracker, "missions", 30_150), {
        from: "village",
        to: "missions",
        ms: 50,
    });
});

test("screen transition timing ignores duplicate starts and initial ready", () => {
    const tracker = createScreenTransitionTracker();
    assert.equal(completeScreenTransition(tracker, "start", 25), null);
    startScreenTransition(tracker, "start", 30);
    assert.equal(tracker.pendingScreen, "");

    startScreenTransition(tracker, "profile", 50);
    startScreenTransition(tracker, "profile", 75);
    assert.equal(completeScreenTransition(tracker, "profile", 90)?.ms, 40);
});
