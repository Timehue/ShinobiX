import assert from "node:assert/strict";
import test from "node:test";
import { skyAtHour } from "../shinobij.client/src/lib/day-cycle.js";
import { WORLD_DAY_MS, WORLD_HOUR_MS, WORLD_DAYS_PER_REAL_DAY } from "./world-clock.js";
import { NIGHT_END_HOUR, NIGHT_START_HOUR, isWorldNight, worldHourAt, worldNightWindowLabel } from "./world-phase.js";

// A real UTC midnight is a whole number of real days from the epoch, and a real
// day divides evenly into in-world days — so this instant is in-world hour 0.
const DAY0 = Date.UTC(2026, 7, 26);
/** A real instant at a given IN-WORLD hour (and in-world minute). */
const at = (hour: number, minute = 0) => DAY0 + hour * WORLD_HOUR_MS + minute * (WORLD_HOUR_MS / 60);

test("the world hour is derived from the shared instant, not the local wall clock", () => {
    assert.equal(worldHourAt(DAY0), 0);
    assert.equal(worldHourAt(at(13, 30)), 13.5);
    assert.ok(Math.abs(worldHourAt(at(23, 59)) - (23 + 59 / 60)) < 1e-9);
});

test("the world's day is compressed, so every player sees every hour in a session", () => {
    // The whole point of the compression: an hour of real play covers half an
    // in-world day, rather than parking one timezone in the same sky forever.
    assert.equal(WORLD_DAY_MS, 2 * 60 * 60 * 1_000);
    assert.equal(WORLD_DAYS_PER_REAL_DAY, 12);
    const hours = new Set<string>();
    for (let ms = 0; ms < WORLD_DAY_MS; ms += 60_000) hours.add(skyAtHour(worldHourAt(DAY0 + ms)).phase);
    assert.deepEqual([...hours].sort(), ["dawn", "day", "dusk", "night"]);
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

// The reason the cycle was compressed: night used to be one fixed slab of the
// real day, so whether you could work a night contract at all came down to the
// timezone you happened to live in.
test("night comes round for everyone, whatever real hour they play", () => {
    for (let realHour = 0; realHour < 24; realHour++) {
        const start = Date.UTC(2026, 7, 26, realHour);
        let sawNight = false;
        let sawDay = false;
        for (let ms = 0; ms < WORLD_DAY_MS; ms += 60_000) {
            if (isWorldNight(start + ms)) sawNight = true; else sawDay = true;
        }
        assert.ok(sawNight && sawDay, `a two-hour session starting ${realHour}:00 UTC must see both`);
    }
});

// The gate the server enforces must agree with the sky the player can see, or
// one of them reads as a bug regardless of which is "right".
test("the night gate matches the visible sky's own night phase, hour for hour", () => {
    for (let hour = 0; hour < 24; hour += 0.25) {
        assert.equal(
            isWorldNight(at(hour)),
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

// A wall-clock window ("20:00–05:00 UTC") would now be actively wrong: night is
// a recurring window, not a slot in the player's evening.
test("the window label describes a recurring window, not a clock time", () => {
    const label = worldNightWindowLabel();
    assert.equal(label, "nightfall comes round every 2h");
    assert.doesNotMatch(label, /UTC|\d\d:\d\d/, "must not read as a wall-clock instruction");
});
