import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { noteServerTime, resetServerClock } from './server-clock.js';
import { currentHour, skyNow, worldHourAt, dayCycleDisabled } from './day-cycle.js';

beforeEach(() => resetServerClock());
afterEach(() => {
    resetServerClock();
    delete (globalThis as { window?: unknown }).window;
});

function fakeWindow(store: Record<string, string>) {
    (globalThis as { window?: unknown }).window = {
        localStorage: { getItem: (k: string) => (k in store ? store[k] : null) },
    };
}

test('worldHourAt reads the UTC hour of an instant, never a local wall clock', () => {
    assert.equal(worldHourAt(Date.UTC(2026, 7, 22, 21, 30, 0)), 21.5);
    assert.equal(worldHourAt(Date.UTC(2026, 7, 22, 0, 0, 0)), 0);
    assert.ok(Math.abs(worldHourAt(Date.UTC(2026, 7, 22, 6, 15, 0)) - 6.25) < 1e-9);
});

test('a Date is read as its absolute instant (UTC), not its local getHours()', () => {
    const d = new Date(Date.UTC(2026, 7, 22, 21, 30, 0));
    assert.equal(currentHour(d), 21.5);
    assert.equal(currentHour(d.getTime()), 21.5);
});

test('currentHour() defaults to the SERVER clock — a drifted device still sees the shared sky', () => {
    const localNow = Date.now();
    const serverAhead = localNow + 5 * 3_600_000; // device 5h behind the server
    noteServerTime(serverAhead, localNow, localNow);
    const expected = worldHourAt(serverAhead);
    const got = currentHour();
    // allow the few ms that elapsed between the two reads
    const diff = Math.min(Math.abs(got - expected), 24 - Math.abs(got - expected));
    assert.ok(diff < 0.01, `expected ~${expected}, got ${got}`);
    assert.ok(Math.abs(got - worldHourAt(localNow)) > 4, 'must not be the device hour');
});

test('two players in different time zones derive the same sky from the same instant', () => {
    const instant = Date.UTC(2026, 7, 22, 12, 0, 0);
    const tokyo = skyNow(instant);   // same instant, whatever the device TZ
    const london = skyNow(instant);
    assert.deepEqual(tokyo, london);
    assert.equal(tokyo.phase, 'day');
    assert.equal(skyNow(Date.UTC(2026, 7, 22, 2, 0, 0)).phase, 'night');
});

test('the dayCycle.hour pin is IGNORED outside dev builds (node tests have no import.meta.env.DEV)', () => {
    fakeWindow({ 'dayCycle.hour': '3' });
    assert.equal(currentHour(Date.UTC(2026, 7, 22, 15, 0, 0)), 15);
});

test('the cosmetic dayCycle.v1=off toggle still works', () => {
    assert.equal(dayCycleDisabled(), false);
    fakeWindow({ 'dayCycle.v1': 'off' });
    assert.equal(dayCycleDisabled(), true);
});
