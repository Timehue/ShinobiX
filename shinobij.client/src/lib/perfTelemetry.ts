// Phase 0 load/refresh performance telemetry.
// See docs/load-and-refresh-perf-audit-2026-06-08.md.
//
// Collects navigation timing (TTFB / FCP / LCP / DCL / load), per-resource-type
// transfer bytes (JS / CSS / img / the heavy /api/images base64 buckets), and a
// few app-reported boot milestones (first screen, restore-complete, playable),
// then sends ONE small beacon to /api/perf-beacon. The server logs a single
// `[perf]` line per load — no storage. This exists so the image-defer and
// instant-refresh work in later phases can be verified with real numbers
// instead of "feels faster".
//
// Hard rules for this module:
//   • NEVER throw and NEVER block render — every entry point is wrapped so a
//     missing Performance API just degrades to a no-op.
//   • NEVER send PII — only anonymous timing numbers + viewport/network hints.
//   • Self-initializes on import (registers observers + a pagehide flush). The
//     app stamps milestones via setBootKind / notifyScreen / notifyRestoreComplete.
//
// Boot kinds measured here are the two automatic, load-paced flows the audit
// targets: a logged-out 'cold-start' landing and an auto-restoring 'refresh'.
// Interactive login is human-paced (not a load metric) and is deliberately out
// of scope for this harness.

type BootKind = 'cold-start' | 'refresh';

const supported =
    typeof window !== 'undefined' &&
    typeof performance !== 'undefined' &&
    typeof performance.now === 'function';

// Settle delay after the terminal boot milestone before flushing, so the
// largest-contentful-paint observer has a moment to record the final LCP.
const SETTLE_MS = 2500;

const state = {
    bootKind: 'cold-start' as BootKind,
    bootKindSet: false,
    lcp: 0,
    fcp: 0,
    tFirstScreen: 0,
    tRestore: 0,
    tPlayable: 0,
    flushed: false,
    sawFirstScreen: false,
    settleTimer: null as ReturnType<typeof setTimeout> | null,
};

// Login / character-creation shells. The first NON-shell screen = "playable".
const SHELL_SCREENS = new Set(['start', 'createCharacter']);

function nowMs(): number {
    try {
        return Math.round(performance.now());
    } catch {
        return 0;
    }
}

// ── Public API (called from App.tsx) ────────────────────────────────────────

/** Stamp which boot flow this load is, so the beacon is bucketed correctly. */
export function setBootKind(kind: BootKind): void {
    if (!supported) return;
    state.bootKind = kind;
    state.bootKindSet = true;
}

/** Call on every screen change. Marks first-screen + first-playable and, for a
 *  cold-start landing, schedules the flush as soon as the shell is up. */
export function notifyScreen(screen: string): void {
    if (!supported || state.flushed) return;
    try {
        if (!state.sawFirstScreen) {
            state.sawFirstScreen = true;
            state.tFirstScreen = nowMs();
            // Cold-start has no async restore — the shell IS the load, so flush
            // once it settles. (Refresh waits for restore-complete / playable so
            // a slow save pull doesn't truncate the measurement.)
            if (state.bootKind === 'cold-start') scheduleFlush();
        }
        if (!SHELL_SCREENS.has(screen) && state.tPlayable === 0) {
            state.tPlayable = nowMs();
            scheduleFlush();
        }
    } catch {
        /* never throw from telemetry */
    }
}

/** Call when the refresh restore-gate finishes (restoringSession → false). */
export function notifyRestoreComplete(): void {
    if (!supported || state.flushed) return;
    try {
        if (state.tRestore === 0) state.tRestore = nowMs();
        scheduleFlush();
    } catch {
        /* never throw */
    }
}

// ── Internals ───────────────────────────────────────────────────────────────

function scheduleFlush(): void {
    if (state.flushed || state.settleTimer !== null) return;
    try {
        state.settleTimer = setTimeout(flush, SETTLE_MS);
    } catch {
        flush();
    }
}

function bytesByType(): {
    htmlBytes: number;
    jsBytes: number;
    cssBytes: number;
    imgBytes: number;
    apiImgBytes: number;
    apiImgCount: number;
    totalBytes: number;
} {
    const out = {
        htmlBytes: 0,
        jsBytes: 0,
        cssBytes: 0,
        imgBytes: 0,
        apiImgBytes: 0,
        apiImgCount: 0,
        totalBytes: 0,
    };
    try {
        const nav = performance.getEntriesByType('navigation')[0] as
            | PerformanceNavigationTiming
            | undefined;
        if (nav) {
            out.htmlBytes = nav.transferSize || 0;
            out.totalBytes += out.htmlBytes;
        }
        const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
        for (const e of resources) {
            // transferSize is 0 for cross-origin resources without a
            // Timing-Allow-Origin header; same-origin bundle + /api/* report it.
            const sz = e.transferSize || 0;
            out.totalBytes += sz;
            const url = e.name;
            if (url.includes('/api/images')) {
                out.apiImgBytes += sz;
                out.apiImgCount += 1;
            } else if (e.initiatorType === 'img' || /\.(png|webp|jpe?g|gif|svg|avif)(\?|$)/i.test(url)) {
                out.imgBytes += sz;
            } else if (e.initiatorType === 'script' || /\.js(\?|$)/i.test(url)) {
                out.jsBytes += sz;
            } else if (
                e.initiatorType === 'css' ||
                e.initiatorType === 'link' ||
                /\.css(\?|$)/i.test(url)
            ) {
                out.cssBytes += sz;
            }
        }
    } catch {
        /* getEntriesByType unsupported — return what we have */
    }
    return out;
}

function buildPayload(): Record<string, unknown> {
    let ttfb = 0;
    let dcl = 0;
    let load = 0;
    try {
        const nav = performance.getEntriesByType('navigation')[0] as
            | PerformanceNavigationTiming
            | undefined;
        if (nav) {
            ttfb = Math.round(nav.responseStart);
            dcl = Math.round(nav.domContentLoadedEventEnd);
            load = Math.round(nav.loadEventEnd); // may be 0 if still loading at flush
        }
    } catch {
        /* ignore */
    }

    const sizes = bytesByType();

    let net: string | undefined;
    let dpr: number | undefined;
    let vw: number | undefined;
    let vh: number | undefined;
    try {
        const conn = (navigator as unknown as { connection?: { effectiveType?: string } }).connection;
        net = conn?.effectiveType;
        dpr = window.devicePixelRatio;
        vw = window.innerWidth;
        vh = window.innerHeight;
    } catch {
        /* ignore */
    }

    return {
        kind: state.bootKind,
        ttfb,
        fcp: Math.round(state.fcp),
        lcp: Math.round(state.lcp),
        dcl,
        load,
        tFirstScreen: state.tFirstScreen,
        tRestore: state.tRestore,
        tPlayable: state.tPlayable,
        ...sizes,
        net,
        vw,
        vh,
        dpr,
    };
}

function send(payload: Record<string, unknown>): void {
    let json: string;
    try {
        json = JSON.stringify(payload);
    } catch {
        return;
    }
    // Prefer sendBeacon — survives page unload (it's why we can flush on
    // pagehide for refreshes). Same-origin in production, so no CORS preflight.
    try {
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
            const blob = new Blob([json], { type: 'application/json' });
            if (navigator.sendBeacon('/api/perf-beacon', blob)) return;
        }
    } catch {
        /* fall through to fetch */
    }
    // Fallback: keepalive fetch (tiny body, well under the 64 KB keepalive cap).
    try {
        void fetch('/api/perf-beacon', {
            method: 'POST',
            body: json,
            headers: { 'Content-Type': 'application/json' },
            keepalive: true,
        }).catch(() => undefined);
    } catch {
        /* give up silently — telemetry is best-effort */
    }
}

function flush(): void {
    if (state.flushed) return;
    state.flushed = true;
    try {
        if (state.settleTimer !== null) {
            clearTimeout(state.settleTimer);
            state.settleTimer = null;
        }
    } catch {
        /* ignore */
    }
    const payload = buildPayload();
    // Dev-only console echo so the numbers are visible without reading server
    // logs. Also stash the last payload on window for ad-hoc inspection.
    try {
        if (import.meta.env?.DEV) {
            console.info('[perf]', payload);
            (window as unknown as { __perf?: unknown }).__perf = payload;
        }
    } catch {
        /* ignore */
    }
    send(payload);
}

// ── Self-initialization (runs once on import) ────────────────────────────────

if (supported) {
    try {
        // FCP — first-contentful-paint from the paint timeline.
        const paintObs = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                if (entry.name === 'first-contentful-paint') state.fcp = entry.startTime;
            }
        });
        paintObs.observe({ type: 'paint', buffered: true });
    } catch {
        /* PerformanceObserver / paint unsupported */
    }

    try {
        // LCP — keep the latest reported candidate up until we flush.
        const lcpObs = new PerformanceObserver((list) => {
            const entries = list.getEntries();
            const last = entries[entries.length - 1] as
                | (PerformanceEntry & { renderTime?: number; loadTime?: number })
                | undefined;
            if (last) state.lcp = last.renderTime || last.loadTime || last.startTime || state.lcp;
        });
        lcpObs.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {
        /* LCP unsupported (e.g. Safari < 16) */
    }

    // Flush when the page is being hidden / unloaded — captures a refresh or
    // tab-close before the settle timer fires, with the final LCP.
    try {
        const onHide = () => flush();
        window.addEventListener('pagehide', onHide, { once: true });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') flush();
        });
    } catch {
        /* ignore */
    }

    // Long-session backstop: if no milestone ever schedules a flush (edge case),
    // still send once well after load so we never silently drop a sample.
    try {
        setTimeout(scheduleFlush, 15_000);
    } catch {
        /* ignore */
    }
}
