import assert from "node:assert/strict";
import test from "node:test";
import { skyAtHour } from "../shinobij.client/src/lib/day-cycle.js";
import { NIGHT_END_HOUR, NIGHT_START_HOUR, isWorldNight, worldHourAt, worldNightWindowLabel } from "./world-phase.js";

const at = (hour: number, minute = 0) => Date.UTC(2026, 7, 26, hour, minute);

test("the world hour is UTC, not the local wall clock", () => {
    assert.equal(worldHourAt(Date.UTC(2026, 7, 26, 0, 0)), 0);
    assert.equal(worldHourAt(Date.UTC(2026, 7, 26, 13, 30)), 13.5);
    assert.equal(worldHourAt(Date.UTC(2026, 7, 26, 23, 59)), 23 + 59 / 60);
});

test("night covers the evening and the small hours, and nothing between", () => {
    for (const hour of [20, 21, 23, 0, 3, 4]) assert.equal(isWorldNight(at(hour)), true, `${hour}:00 should be night`);
    for (const hour of [5, 8, 12, 17, 19]) assert.equal(isWorldNight(at(hour)), false, `${hour}:00 should not be night`);
    // Exactly on the boundaries.
    assert.equal(isWorldNight(at(NIGHT_START_HOUR)), true);
    assert.equal(isWorldNight(at(NIGHT_START_HOUR, -1)), false);
    assert.equal(isWorldNight(at(NIGHT_END_HOUR)), false);
    assert.equal(isWorldNight(at(NIGHT_END_HOUR, -1)), true);
});

// The gate the server enforces must agree with the sky the player can see, or
// one of them reads as a bug regardless of which is "right".
test("the night gate matches the visible sky's own night phase, hour for hour", () => {
    for (let hour = 0; hour < 24; hour += 0.25) {
        assert.equal(
            isWorldNight(at(0) + hour * 3_600_000),
            skyAtHour(hour).phase === "night",
            `hour ${hour}: gate and sky disagree`,
        );
    }
});

test("garbage timestamps never accidentally read as night", () => {
    for (const junk of [Number.NaN, Infinity, -Infinity]) {
        assert.equal(worldHourAt(junk as number), 0);
        assert.equal(isWorldNight(junk as number), false);
    }
});

test("the window label names the real boundaries", () => {
    assert.equal(worldNightWindowLabel(), "20:00–05:00 UTC");
});
