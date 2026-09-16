import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionPerformanceReporter, observeSessionPerformance, sessionPerformanceSampleRate, type SessionPerformanceSummary } from './session-performance';

function harness(options: { minimumIntervalMs?: number; maximumReports?: number } = {}) {
    let now = 0;
    const sent: SessionPerformanceSummary[] = [];
    const reporter = createSessionPerformanceReporter({ ...options, now: () => now, send: summary => { sent.push(summary); } });
    return { reporter, sent, time: (value: number) => { now = value; } };
}

test('session sampling is disabled unless the explicit string rate is within 0..1', () => {
    for (const invalid of [undefined, null, false, true, 1, 0.5, '', ' ', 'NaN', 'Infinity', '-0.01', '1.01', 'not-a-rate']) {
        assert.equal(sessionPerformanceSampleRate(invalid), 0, String(invalid));
    }
    for (const [value, expected] of [['0', 0], ['0.05', 0.05], [' .5 ', 0.5], ['1', 1]] as const) {
        assert.equal(sessionPerformanceSampleRate(value), expected);
    }
});

test('reports wait 60 seconds, reset their window, and deduplicate hidden/pagehide', () => {
    const h = harness();
    h.reporter.transition(120);
    h.time(59_999);
    assert.equal(h.reporter.flush('hidden'), false);
    h.time(60_000);
    assert.equal(h.reporter.flush('hidden'), true);
    assert.equal(h.reporter.flush('pagehide'), false);
    h.reporter.transition(300);
    assert.equal(h.reporter.flush('pagehide'), false);
    h.time(120_000);
    assert.equal(h.reporter.flush('interval'), true);
    assert.deepEqual(h.sent.map(s => [s.reason, s.windowMs, s.transitionCount, s.slowTransitionCount, s.maxScreenTransition]),
        [['hidden', 60_000, 1, 0, 120], ['interval', 60_000, 1, 1, 300]]);
    h.time(180_000);
    assert.equal(h.reporter.flush('interval'), false, 'idle windows do not emit empty reports');
});

test('unsupported streams are null and cannot manufacture activity', () => {
    const h = harness();
    h.reporter.longTask(200);
    h.reporter.event(150);
    h.reporter.layoutShift(0.1, false);
    h.time(60_000);
    assert.equal(h.reporter.flush('interval'), false);
    h.reporter.transition(0);
    h.reporter.flush('interval');
    assert.deepEqual(h.sent[0], {
        kind: 'session', reason: 'interval', windowMs: 60_000,
        transitionCount: 1, slowTransitionCount: 0, maxScreenTransition: 0,
        longTaskSupported: false, longTaskCount: null, longTaskTotal: null, longTaskMax: null,
        eventTimingSupported: false, eventCount: null, maxEventDuration: null,
        layoutShiftSupported: false, layoutShiftTotal: null,
    });
});

test('supported streams report aggregate diagnostics, excluding input-related shifts and invalid values', () => {
    const h = harness();
    h.reporter.support('longTask'); h.reporter.support('eventTiming'); h.reporter.support('layoutShift');
    for (const value of [NaN, Infinity, -1, 600_000_001]) {
        h.reporter.transition(value); h.reporter.longTask(value); h.reporter.event(value); h.reporter.layoutShift(value, false);
    }
    h.reporter.longTask(99); h.reporter.longTask(100); h.reporter.longTask(275.5);
    h.reporter.event(32); h.reporter.event(128);
    h.reporter.layoutShift(0.1, false); h.reporter.layoutShift(0.2, false); h.reporter.layoutShift(0.9, true);
    h.time(60_000); h.reporter.flush('interval');
    assert.equal(h.sent[0].transitionCount, 0);
    assert.equal(h.sent[0].longTaskCount, 2); assert.equal(h.sent[0].longTaskTotal, 375.5); assert.equal(h.sent[0].longTaskMax, 275.5);
    assert.equal(h.sent[0].eventCount, 2); assert.equal(h.sent[0].maxEventDuration, 128);
    assert.ok(Math.abs(h.sent[0].layoutShiftTotal! - 0.3) < 0.000001);
    h.reporter.transition(1); h.time(120_000); h.reporter.flush('interval');
    assert.equal(h.sent[1].longTaskCount, 0, 'supported and empty differs from unsupported');
    assert.equal(h.sent[1].eventCount, 0); assert.equal(h.sent[1].layoutShiftTotal, 0);
    assert.equal(h.sent[1].longTaskSupported, true);
    assert.ok(!('interactionCount' in h.sent[0]) && !('inp' in h.sent[0]) && !('cls' in h.sent[0]));
});

test('configuration cannot exceed 20 reports per document or shorten the 60-second floor', () => {
    const h = harness({ minimumIntervalMs: 1, maximumReports: 10_000 });
    for (let second = 1; second <= 2_000; second += 1) {
        h.reporter.transition(10); h.time(second * 1000); h.reporter.flush('interval');
    }
    assert.equal(h.sent.length, 20);
    assert.equal(h.reporter.active(), false);
    assert.ok(h.sent.every(s => s.windowMs === 60_000));
    const invalid = harness({ minimumIntervalMs: NaN, maximumReports: Infinity });
    invalid.reporter.transition(1); invalid.time(60_000);
    assert.equal(invalid.reporter.flush('interval'), true);
});

test('synchronous and asynchronous send failures consume the window without retries', async () => {
    let now = 60_000;
    let sends = 0;
    const reporter = createSessionPerformanceReporter({ now: () => now, send: () => {
        sends += 1;
        assert.equal(reporter.flush('pagehide'), false, 're-entrant lifecycle cannot duplicate the packet');
        if (sends === 1) throw new Error('transport failed');
        return Promise.reject(new Error('async transport failed'));
    } });
    reporter.transition(10); now = 120_000;
    assert.equal(reporter.flush('hidden'), true);
    assert.equal(reporter.flush('pagehide'), false);
    reporter.transition(20); now = 180_000;
    assert.equal(reporter.flush('interval'), true);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(sends, 2);
    assert.equal(reporter.flush('hidden'), false);
});

test('clock regressions and invalid readings do not bypass the cadence', () => {
    const h = harness(); h.reporter.transition(1);
    for (const time of [-1, NaN, Infinity, 59_999]) {
        h.time(time); assert.equal(h.reporter.flush('hidden'), false);
    }
    h.time(60_000); assert.equal(h.reporter.flush('hidden'), true);
    h.reporter.transition(2); h.time(59_000); assert.equal(h.reporter.flush('pagehide'), false);
    h.time(120_000); assert.equal(h.reporter.flush('interval'), true);
});

function observerHarness(types: string[], failType?: string) {
    const instances: FakeObserver[] = [];
    class FakeObserver {
        static supportedEntryTypes = types;
        type = ''; disconnected = false; options?: PerformanceObserverInit;
        constructor(readonly callback: PerformanceObserverCallback) { instances.push(this); }
        observe(options: PerformanceObserverInit) {
            this.options = options; this.type = options.type!;
            if (this.type === failType) throw new Error('observer unavailable');
        }
        disconnect() { this.disconnected = true; }
        emit(entries: unknown[]) {
            this.callback({ getEntries: () => entries } as unknown as PerformanceObserverEntryList,
                this as unknown as PerformanceObserver);
        }
    }
    return { instances, Observer: FakeObserver as unknown as typeof PerformanceObserver };
}

test('observer adapter exposes availability, bounded event entries, and aggregate-only privacy', () => {
    const h = harness(); const fake = observerHarness(['event', 'layout-shift']);
    const stop = observeSessionPerformance(h.reporter, fake.Observer);
    const event = fake.instances.find(o => o.type === 'event')!;
    assert.deepEqual(event.options, { type: 'event', buffered: true, durationThreshold: 16 });
    event.emit([
        { duration: 32, interactionId: 777, name: 'secret-route', target: { id: 'private-account' } },
        { duration: 48, interactionId: 777, name: 'secret-route', target: { id: 'private-account' } },
    ]);
    fake.instances.find(o => o.type === 'layout-shift')!.emit([
        { value: 0.125, hadRecentInput: false, sources: [{ node: { id: 'private-account' } }] },
        { value: 0.5, hadRecentInput: true },
    ]);
    h.time(60_000); h.reporter.flush('hidden');
    assert.equal(h.sent[0].eventCount, 2, 'entries are not deduplicated into a claimed interaction count');
    assert.equal(h.sent[0].maxEventDuration, 48); assert.equal(h.sent[0].layoutShiftTotal, 0.125);
    assert.equal(h.sent[0].longTaskSupported, false);
    const json = JSON.stringify(h.sent[0]);
    for (const secret of ['777', 'secret-route', 'private-account', 'sources', 'target']) assert.ok(!json.includes(secret));
    stop(); assert.ok(fake.instances.every(o => o.disconnected));
});

test('unsupported or rejected observers remain null and are cleaned up', () => {
    const h = harness(); const absent = observerHarness([]);
    observeSessionPerformance(h.reporter, absent.Observer)();
    observeSessionPerformance(h.reporter, undefined)();
    assert.equal(absent.instances.length, 0);
    const failed = observerHarness(['event'], 'event');
    observeSessionPerformance(h.reporter, failed.Observer)();
    assert.equal(failed.instances[0].disconnected, true);
    h.reporter.transition(20); h.time(60_000); h.reporter.flush('interval');
    assert.equal(h.sent[0].eventTimingSupported, false); assert.equal(h.sent[0].eventCount, null);
});
