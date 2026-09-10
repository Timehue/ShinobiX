import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    REAL_DAY_MS,
    WORLD_DAYS_PER_REAL_DAY,
    WORLD_DAY_MS,
    WORLD_HOUR_MS,
    worldHourAt,
} from "./world-clock.js";

describe("the world's day is compressed, and the numbers hang together", () => {
    it("runs a two-hour day, the cycle length live games settled on", () => {
        assert.equal(WORLD_DAY_MS, 2 * 60 * 60 * 1_000);
        assert.equal(WORLD_HOUR_MS, 5 * 60 * 1_000, "an in-world hour should be five real minutes");
        assert.equal(WORLD_DAYS_PER_REAL_DAY, 12);
    });

    // Load-bearing, not trivia: several suites build an instant at a given
    // in-world hour as `Date.UTC(y, m, d) + hour * WORLD_HOUR_MS`, which is only
    // correct because a real UTC midnight is also an in-world day boundary.
    it("divides a real day evenly, so real midnight is an in-world day boundary", () => {
        assert.equal(REAL_DAY_MS % WORLD_DAY_MS, 0);
        assert.equal(worldHourAt(Date.UTC(2026, 7, 26)), 0);
        assert.equal(worldHourAt(Date.UTC(2026, 0, 1)), 0);
    });

    it("leaves the dawn and dusk ramps long enough to watch the light move", () => {
        // The keyframes in lib/day-cycle put dawn at 5:00-7:30 and dusk at 17:00-20:00.
        assert.ok(2.5 * WORLD_HOUR_MS >= 10 * 60_000, "dawn is too short to read as a sunrise");
        assert.ok(3 * WORLD_HOUR_MS >= 10 * 60_000, "dusk is too short to read as a sunset");
    });
});

describe("worldHourAt", () => {
    it("maps an instant onto a continuous 0-24 hour", () => {
        const day0 = Date.UTC(2026, 7, 26);
        assert.equal(worldHourAt(day0), 0);
        assert.equal(worldHourAt(day0 + 6 * WORLD_HOUR_MS), 6);
        assert.equal(worldHourAt(day0 + 23.5 * WORLD_HOUR_MS), 23.5);
        assert.equal(worldHourAt(day0 + WORLD_DAY_MS), 0, "the clock must wrap, not run past 24");
    });

    it("advances one in-world hour per five real minutes, all the way round", () => {
        const day0 = Date.UTC(2026, 7, 26);
        for (let h = 0; h < 24; h++) {
            assert.ok(
                Math.abs(worldHourAt(day0 + h * 5 * 60_000) - h) < 1e-9,
                `+${h * 5} real minutes should read hour ${h}`,
            );
        }
    });

    it("handles instants before the epoch without going negative", () => {
        for (const ms of [-1, -WORLD_DAY_MS, -WORLD_DAY_MS - 1, -12_345_678]) {
            const hour = worldHourAt(ms);
            assert.ok(hour >= 0 && hour < 24, `${ms} gave hour ${hour}`);
        }
    });

    it("folds a non-instant to hour 0 rather than throwing", () => {
        for (const junk of [Number.NaN, Infinity, -Infinity, undefined, null, "nope"]) {
            assert.equal(worldHourAt(junk as unknown as number), 0);
        }
    });

    it("is the same answer on every machine for the same instant", () => {
        const instant = 1_760_000_000_123;
        assert.equal(worldHourAt(instant), worldHourAt(instant));
        // No local timezone anywhere in the derivation.
        assert.equal(worldHourAt(instant), ((instant % WORLD_DAY_MS) / WORLD_DAY_MS) * 24);
    });
});
