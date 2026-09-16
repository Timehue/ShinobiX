/** Anonymous aggregate diagnostics, not field INP/CLS certification. No route,
 * account, element, URL or interaction identifiers leave this accumulator. */
export type SessionPerformanceSummary = {
    kind: 'session'; reason: 'interval' | 'hidden' | 'pagehide'; windowMs: number;
    transitionCount: number; slowTransitionCount: number; maxScreenTransition: number;
    longTaskSupported: boolean; longTaskCount: number | null; longTaskTotal: number | null; longTaskMax: number | null;
    eventTimingSupported: boolean; eventCount: number | null; maxEventDuration: number | null;
    layoutShiftSupported: boolean; layoutShiftTotal: number | null;
};

export function sessionPerformanceSampleRate(value: unknown): number {
    if (typeof value !== 'string' || value.trim() === '') return 0;
    const rate = Number(value);
    return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 0;
}

const METRIC_LIMIT = 600_000_000;

export function createSessionPerformanceReporter(options: {
    now: () => number; send: (summary: SessionPerformanceSummary) => void | Promise<void>;
    minimumIntervalMs?: number; maximumReports?: number;
}) {
    // Test/custom callers cannot bypass the document-wide privacy/volume bounds.
    const minimumInterval = Number.isFinite(options.minimumIntervalMs)
        ? Math.max(60_000, options.minimumIntervalMs!) : 60_000;
    const maximumReports = Number.isFinite(options.maximumReports)
        ? Math.max(0, Math.min(20, Math.floor(options.maximumReports!))) : 20;
    const readNow = () => {
        try { const value = options.now(); return Number.isFinite(value) && value >= 0 ? value : 0; }
        catch { return 0; }
    };
    let startedAt = readNow();
    let reports = 0;
    const support = { longTask: false, eventTiming: false, layoutShift: false };
    const empty = () => ({ transitionCount: 0, slowTransitionCount: 0, maxScreenTransition: 0,
        longTaskCount: 0, longTaskTotal: 0, longTaskMax: 0, eventCount: 0,
        maxEventDuration: 0, layoutShiftTotal: 0 });
    let totals = empty();
    let activity = false;
    const valid = (value: number) => Number.isFinite(value) && value >= 0 && value <= METRIC_LIMIT;
    const add = (a: number, b: number) => Math.min(METRIC_LIMIT, a + b);
    const active = () => reports < maximumReports;
    return {
        active,
        support(metric: keyof typeof support) { support[metric] = true; },
        transition(ms: number) {
            if (!active() || !valid(ms)) return;
            activity = true; totals.transitionCount = add(totals.transitionCount, 1);
            if (ms > 250) totals.slowTransitionCount = add(totals.slowTransitionCount, 1);
            totals.maxScreenTransition = Math.max(totals.maxScreenTransition, ms);
        },
        // Match the existing boot diagnostic: main-thread tasks of at least 100ms.
        longTask(ms: number) {
            if (!active() || !support.longTask || !valid(ms) || ms < 100) return;
            activity = true; totals.longTaskCount = add(totals.longTaskCount, 1);
            totals.longTaskTotal = add(totals.longTaskTotal, ms);
            totals.longTaskMax = Math.max(totals.longTaskMax, ms);
        },
        event(ms: number) {
            if (!active() || !support.eventTiming || !valid(ms)) return;
            activity = true; totals.eventCount = add(totals.eventCount, 1);
            totals.maxEventDuration = Math.max(totals.maxEventDuration, ms);
        },
        layoutShift(value: number, hadRecentInput: boolean) {
            if (!active() || !support.layoutShift || !valid(value) || hadRecentInput || value === 0) return;
            activity = true; totals.layoutShiftTotal = add(totals.layoutShiftTotal, value);
        },
        flush(reason: SessionPerformanceSummary['reason']) {
            const now = readNow();
            if (!active() || !activity || now - startedAt < minimumInterval
                || !['interval', 'hidden', 'pagehide'].includes(reason)) return false;
            const summary: SessionPerformanceSummary = {
                kind: 'session', reason, windowMs: Math.round(now - startedAt),
                transitionCount: totals.transitionCount, slowTransitionCount: totals.slowTransitionCount,
                maxScreenTransition: totals.maxScreenTransition,
                longTaskSupported: support.longTask,
                longTaskCount: support.longTask ? totals.longTaskCount : null,
                longTaskTotal: support.longTask ? totals.longTaskTotal : null,
                longTaskMax: support.longTask ? totals.longTaskMax : null,
                eventTimingSupported: support.eventTiming,
                eventCount: support.eventTiming ? totals.eventCount : null,
                maxEventDuration: support.eventTiming ? totals.maxEventDuration : null,
                layoutShiftSupported: support.layoutShift,
                layoutShiftTotal: support.layoutShift ? totals.layoutShiftTotal : null,
            };
            // Retire before transport: failures/re-entrant hide/pagehide events
            // consume this attempt and can never resend the same window.
            reports++; startedAt = now; totals = empty(); activity = false;
            try { void Promise.resolve(options.send(summary)).catch(() => undefined); }
            catch { /* telemetry cannot affect play */ }
            return true;
        },
    };
}

export type SessionPerformanceReporter = ReturnType<typeof createSessionPerformanceReporter>;

/** Additional observers exist only for sampled documents. Long tasks share the
 * existing boot observer; this installs only the two session-specific streams. */
export function observeSessionPerformance(reporter: SessionPerformanceReporter, Observer: typeof PerformanceObserver | undefined) {
    const observers: PerformanceObserver[] = [];
    for (const type of ['event', 'layout-shift'] as const) {
        let observer: PerformanceObserver | undefined;
        try {
            // Some browsers silently accept unsupported observe() entry types.
            // A successful call alone is not evidence of metric availability.
            if (!Observer?.supportedEntryTypes?.includes(type)) continue;
            observer = new Observer(list => {
                for (const entry of list.getEntries()) {
                    if (type === 'event') reporter.event(entry.duration);
                    else {
                        const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
                        if (typeof shift.value === 'number') reporter.layoutShift(shift.value, Boolean(shift.hadRecentInput));
                    }
                }
            });
            // Event Timing counts qualifying entries, not distinct interactions;
            // a single interaction can produce several entries. This is not INP.
            observer.observe({ type, buffered: true, ...(type === 'event' ? { durationThreshold: 16 } : {}) });
            reporter.support(type === 'event' ? 'eventTiming' : 'layoutShift');
            observers.push(observer);
        } catch {
            try { observer?.disconnect(); } catch { /* best-effort cleanup */ }
            // Failed or unsupported observers leave metrics explicitly null.
        }
    }
    return () => {
        for (const observer of observers) {
            try { observer.disconnect(); } catch { /* best-effort cleanup */ }
        }
    };
}
