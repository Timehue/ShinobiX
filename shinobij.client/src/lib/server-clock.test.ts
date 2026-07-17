import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { noteServerTime, serverNow, serverClockOffsetMs, resetServerClock } from './server-clock.js';

beforeEach(() => resetServerClock());

test('an unsampled clock behaves exactly like Date.now()', () => {
    assert.equal(serverClockOffsetMs(), 0);
    assert.ok(Math.abs(serverNow() - Date.now()) <= 1);
});

test('a healthy clock is left alone (round-trip noise must not jitter countdowns)', () => {
    const now = Date.now();
    noteServerTime(now + 120, now - 240, now); // server stamp ~mid-flight of a 240ms trip
    assert.equal(serverClockOffsetMs(), 0);
});

test('a browser running minutes behind reads the server clock, not its own', () => {
    const localNow = Date.now();
    const serverAhead = localNow + 180_000; // the 183s-travel symptom
    noteServerTime(serverAhead, localNow, localNow);
    assert.equal(serverClockOffsetMs(), 180_000);
    assert.ok(Math.abs(serverNow() - serverAhead) <= 5);
});

test('a browser running ahead is corrected too (the "Claim does nothing" case)', () => {
    const localNow = Date.now();
    noteServerTime(localNow - 90_000, localNow, localNow);
    assert.equal(serverClockOffsetMs(), -90_000);
});

test('garbage and slow samples are ignored rather than adopted', () => {
    const now = Date.now();
    for (const bad of [undefined, null, 'soon', NaN, Infinity, 0, -1]) {
        noteServerTime(bad, now, now);
        assert.equal(serverClockOffsetMs(), 0);
    }
    // A round trip this slow makes the stamp stale — its midpoint is a guess.
    noteServerTime(now + 180_000, now - 30_000, now);
    assert.equal(serverClockOffsetMs(), 0);
});

test('sentAt is optional; the round-trip bias stays inside the deadband', () => {
    const now = Date.now();
    noteServerTime(now, undefined, now); // no RTT correction available
    assert.equal(serverClockOffsetMs(), 0);
    noteServerTime(now + 180_000, undefined, now);
    assert.equal(serverClockOffsetMs(), 180_000);
});

test('a settled offset is not re-adopted on every beat', () => {
    const now = Date.now();
    noteServerTime(now + 180_000, now, now);
    noteServerTime(now + 180_150, now + 100, now + 100); // same drift, new sample
    assert.equal(serverClockOffsetMs(), 180_000);        // unchanged — no jitter
});
