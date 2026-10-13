import { test } from "node:test";
import assert from "node:assert/strict";
import {
    PVP_RECONNECT_BADGE_GRACE_MS,
    PVP_STREAM_HANDOFF_SPREAD_MS,
    pvpStreamHandoffDelayMs,
    pvpStreamRetryDelayMs,
} from "./pvp-stream-transport";

test("a server-requested reconnect reopens within a fraction of a second", () => {
    assert.equal(pvpStreamHandoffDelayMs(() => 0), 0);
    assert.equal(pvpStreamHandoffDelayMs(() => 1), PVP_STREAM_HANDOFF_SPREAD_MS);
    assert.ok(PVP_STREAM_HANDOFF_SPREAD_MS < PVP_RECONNECT_BADGE_GRACE_MS,
        "a planned handoff must finish inside the badge grace, so the badge never shows for it");
});

test("the first retry after an error is under a second, then backs off to a 10 s cap", () => {
    assert.equal(pvpStreamRetryDelayMs(1, true, () => 0), 500);
    assert.equal(pvpStreamRetryDelayMs(1, true, () => 1), 1_000);
    assert.ok(pvpStreamRetryDelayMs(1, true, () => 1) < PVP_RECONNECT_BADGE_GRACE_MS,
        "a single blip is retried before the badge would appear");
    assert.equal(pvpStreamRetryDelayMs(2, true), 1_500);
    assert.equal(pvpStreamRetryDelayMs(3, true), 3_000);
    assert.equal(pvpStreamRetryDelayMs(4, true), 6_000);
    assert.equal(pvpStreamRetryDelayMs(5, true), 10_000);
    assert.equal(pvpStreamRetryDelayMs(50, true), 10_000);
});

test("a sustained outage stays inside the server's 30-per-minute stream budget", () => {
    let elapsed = 0;
    let attempts = 0;
    for (let failures = 1; elapsed < 60_000; failures += 1) {
        elapsed += pvpStreamRetryDelayMs(failures, true, () => 0);
        attempts += 1;
    }
    assert.ok(attempts <= 30, `${attempts} reconnects in the first minute of an outage`);
});

test("before the first session the retry stays a flat 1.5 s", () => {
    assert.equal(pvpStreamRetryDelayMs(1, false), 1_500);
    assert.equal(pvpStreamRetryDelayMs(4, false), 1_500);
});

test("a broken random source is clamped", () => {
    assert.equal(pvpStreamHandoffDelayMs(() => Number.NaN), 0);
    assert.equal(pvpStreamHandoffDelayMs(() => 7), PVP_STREAM_HANDOFF_SPREAD_MS);
    assert.equal(pvpStreamRetryDelayMs(1, true, () => -3), 500);
});
