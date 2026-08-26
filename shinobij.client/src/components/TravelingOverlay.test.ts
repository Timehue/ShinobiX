import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const overlaySource = readFileSync(new URL("./TravelingOverlay.tsx", import.meta.url), "utf8");
const worldMapSource = readFileSync(new URL("../screens/WorldMap.tsx", import.meta.url), "utf8");

// App deliberately wakes ONCE, at the arrival instant, so the heaviest screen in
// the game is not re-rendered four times a second for a progress bar. That perf
// choice froze the countdown when it was computed inline in WorldMap's render:
// nothing re-rendered during the trip, so the bar sat on its first frame and the
// seconds text sat on "3s" — except when an unrelated poll happened to re-render
// App inside the window, which is why it looked intermittent rather than broken.
// The mask must therefore carry its own heartbeat, and WorldMap must not grow a
// second inline one.
test("the traveling mask drives its own countdown instead of reading render-time clocks", () => {
    assert.match(overlaySource, /setInterval\(/u, "the mask needs a heartbeat of its own");
    assert.match(overlaySource, /window\.clearInterval\(/u, "the heartbeat must be cleared on unmount");
});

test("WorldMap delegates the traveling mask and keeps no inline countdown", () => {
    const travelingBranch = worldMapSource.slice(worldMapSource.indexOf("if (isTraveling) {"));
    const branch = travelingBranch.slice(0, travelingBranch.indexOf("\n    }"));

    assert.match(branch, /<TravelingOverlay arrivalAt=\{travelingUntil\} \/>/u);
    assert.doesNotMatch(branch, /Date\.now\(\)/u, "a render-time clock here cannot tick");
    assert.doesNotMatch(branch, /secondsLeft/u, "the countdown belongs to the component that re-renders");
});
