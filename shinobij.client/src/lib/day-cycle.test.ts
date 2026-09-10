import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { noteServerTime, resetServerClock } from './server-clock.js';
import { currentHour, skyNow, skyAtHour, worldHourAt, dayCycleDisabled, SKY_REFRESH_MS, WORLD_DAY_MS, WORLD_HOUR_MS } from './day-cycle.js';

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

// A real UTC midnight is a whole number of real days from the epoch, and a real
// day divides evenly into in-world days — so this instant is in-world hour 0.
const DAY0 = Date.UTC(2026, 7, 22);
/** A real instant at a given IN-WORLD hour. */
const at = (hour: number) => DAY0 + hour * WORLD_HOUR_MS;

test('worldHourAt reads the in-world hour of an instant, never a local wall clock', () => {
    assert.equal(worldHourAt(at(21.5)), 21.5);
    assert.equal(worldHourAt(DAY0), 0);
    assert.ok(Math.abs(worldHourAt(at(6.25)) - 6.25) < 1e-9);
});

// The reason the clock was compressed: on the real UTC hour, a player whose
// evening is 19:00-21:00 local saw the same slice of sky every night of their
// life and never saw dawn.
test('the world day is compressed, so one session covers every phase', () => {
    assert.equal(WORLD_DAY_MS, 2 * 60 * 60 * 1_000);
    assert.equal(WORLD_HOUR_MS, WORLD_DAY_MS / 24);
    for (const realHour of [3, 9, 14, 19, 22]) {
        const start = Date.UTC(2026, 7, 22, realHour);
        const phases = new Set<string>();
        for (let ms = 0; ms < WORLD_DAY_MS; ms += 60_000) phases.add(skyNow(start + ms).phase);
        assert.deepEqual([...phases].sort(), ['dawn', 'day', 'dusk', 'night'], `session at ${realHour}:00 UTC`);
    }
});

test('the sky repaints often enough that dusk glides rather than steps', () => {
    // Dusk is the tightest ramp on the dial: 3 in-world hours, so 15 real minutes.
    // The tint carries a 2s CSS transition, so a step it cannot cover reads as a
    // pulse. Pin the real bound: no single step may move the wash perceptibly.
    const duskMs = 3 * WORLD_HOUR_MS;
    assert.ok(SKY_REFRESH_MS >= 5_000, 'a sub-5s repaint is churn, not smoothness');
    assert.ok(SKY_REFRESH_MS <= duskMs / 40, `${SKY_REFRESH_MS}ms is too coarse for a ${duskMs}ms ramp`);
    const stepHours = (SKY_REFRESH_MS / WORLD_HOUR_MS);
    const worst = Math.max(
        ...Array.from({ length: 200 }, (_, i) => {
            const hour = 17 + (i / 200) * 3; // across the dusk ramp
            return Math.abs(skyAtHour(hour + stepHours).tintAlpha - skyAtHour(hour).tintAlpha);
        }),
    );
    assert.ok(worst < 0.01, `one step moves the wash by ${worst.toFixed(4)} alpha — visible as a pulse`);
});

test('a Date is read as its absolute instant, not its local getHours()', () => {
    const d = new Date(at(21.5));
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
    assert.ok(diff < 0.05, `expected ~${expected}, got ${got}`);
});

test('two players in different time zones derive the same sky from the same instant', () => {
    const instant = at(12);
    const tokyo = skyNow(instant);   // same instant, whatever the device TZ
    const london = skyNow(instant);
    assert.deepEqual(tokyo, london);
    assert.equal(tokyo.phase, 'day');
    assert.equal(skyNow(at(2)).phase, 'night');
});

// The look of each hour is deliberately unchanged by the compression — only the
// rate the hours pass at moved. A keyframe drift here would repaint the world.
test('the art direction of each hour is untouched — only the clock rate moved', () => {
    assert.equal(skyAtHour(12).tintAlpha, 0);
    assert.equal(skyAtHour(0).phase, 'night');
    assert.equal(skyAtHour(6.5).phase, 'dawn');
    assert.equal(skyAtHour(18).phase, 'dusk');
    assert.ok(skyAtHour(0).night === 1 && skyAtHour(12).night === 0);
});

test('the dayCycle.hour pin is IGNORED outside dev builds (node tests have no import.meta.env.DEV)', () => {
    fakeWindow({ 'dayCycle.hour': '3' });
    assert.equal(currentHour(at(15)), 15);
});

test('the cosmetic dayCycle.v1=off toggle still works', () => {
    assert.equal(dayCycleDisabled(), false);
    fakeWindow({ 'dayCycle.v1': 'off' });
    assert.equal(dayCycleDisabled(), true);
});
