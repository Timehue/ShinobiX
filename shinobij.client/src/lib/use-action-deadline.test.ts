import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the live deadline hook only subscribes to the 1s clock while a cooldown is ahead", () => {
    const source = read("./use-action-deadline.ts");
    assert.match(source, /const live = deadline > getSharedNow\(\);/);
    assert.match(source, /useSyncExternalStore\(live \? subscribeSharedNow : noSubscription, getSharedNow, getSharedNow\)/);
    assert.match(source, /return Math\.max\(0, deadline - now\);/);
});

test("the World Map uses the live deadline and a coarse visible-only clock, not a per-second re-render", () => {
    const map = read("../screens/WorldMap.tsx");
    assert.match(map, /const raidStartCooldownMs = useLiveActionDeadline\(raidStartActionScope\(character\.name\)\);/);
    assert.doesNotMatch(map, /\buseActionDeadline\(/, "the World Map must not re-render every second for a zero cooldown");
    assert.match(map, /visiblePoll\(\(\) => setMapClockTick\(\(tick\) => tick \+ 1\), 5_000, 0\)/);
});
