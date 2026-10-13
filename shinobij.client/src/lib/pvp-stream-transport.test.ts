import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    PVP_RECONNECT_BADGE_GRACE_MS,
    PVP_STREAM_HANDOFF_SPREAD_MS,
    PVP_STREAM_HEALTHY_AFTER_MS,
    PVP_STREAM_SILENCE_LIMIT_MS,
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

test("a quiet fight never trips the silence watchdog: it allows more than two server pings", () => {
    const server = readFileSync(new URL("../../../api/pvp/stream.ts", import.meta.url), "utf8");
    const ping = Number(/const HEARTBEAT_INTERVAL_MS = ([\d_]+);/.exec(server)?.[1].replace(/_/g, ""));
    assert.ok(ping > 0, "server heartbeat interval found");
    assert.ok(PVP_STREAM_SILENCE_LIMIT_MS > 2 * ping, `silence limit ${PVP_STREAM_SILENCE_LIMIT_MS} vs ping ${ping}`);
    assert.match(server, /sendEvent\('ping', \{ at: Date\.now\(\) \}\)/, "the heartbeat is an event the browser can see, not an SSE comment");
});

test("a stream that connects then dies keeps backing off and stays inside the budget", () => {
    // The backoff resets only after PVP_STREAM_HEALTHY_AFTER_MS of uptime, so a
    // stream that opens, delivers one frame, and dies within that window keeps
    // climbing: each cycle costs the retry delay plus its short life.
    let elapsed = 0;
    let opens = 0;
    for (let failures = 1; elapsed < 60_000; failures += 1) {
        elapsed += pvpStreamRetryDelayMs(failures, true, () => 0) + (PVP_STREAM_HEALTHY_AFTER_MS - 1);
        opens += 1;
    }
    assert.ok(opens <= 30, `${opens} opens in a minute of connect-then-die`);
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
