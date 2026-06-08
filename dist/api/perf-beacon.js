"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("./_utils.js");
const _ratelimit_js_1 = require("./_ratelimit.js");
// Phase 0 load/refresh telemetry sink (see
// docs/load-and-refresh-perf-audit-2026-06-08.md).
//
// The client (shinobij.client/src/lib/perfTelemetry.ts) posts ONE small JSON
// beacon per page load summarizing navigation timing + a few app-reported boot
// milestones + per-type transfer bytes. We log a single structured line to
// stdout (visible in Railway logs / cPanel passenger log) and store NOTHING —
// no KV writes, no Supabase egress — so this stays a thin, zero-cost endpoint
// per the hosting rules (Railway = compute + thin responses; never add metered
// egress/storage here).
//
// It is intentionally UNAUTHENTICATED and carries NO PII: the beacon fires on
// the cold-landing / login screen before any credential exists, and the body is
// only anonymous timing numbers + viewport/network hints (no player name, no
// token, no save data). Grep the logs with `[perf]` to collect samples.
const KINDS = new Set(['cold-start', 'refresh']);
// Accept a finite, non-negative integer-ish metric; reject NaN/Infinity and
// absurd values (> ~10 min in ms) so a malformed body can't bloat the log line.
function intOrNull(v) {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 600_000_000)
        return null;
    return Math.round(n);
}
// devicePixelRatio is a small fractional (1, 1.5, 2, 2.625…). Keep 2 decimals.
function dprOrNull(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || n >= 16)
        return null;
    return Math.round(n * 100) / 100;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    // A telemetry POST must never be cached by the CDN / browser.
    res.setHeader('Cache-Control', 'no-store');
    // Light in-memory rate limit by IP. Telemetry isn't security-critical and
    // must not add KV load, so this uses the per-instance bucket only (no KV).
    // A page fires a handful of beacons per session; 60/min/IP is generous and
    // still blunts a flood.
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'perf-beacon', 60, 60_000))
        return;
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        if (!body || typeof body !== 'object')
            return res.status(204).end();
        const b = body;
        const kind = typeof b.kind === 'string' && KINDS.has(b.kind) ? b.kind : 'unknown';
        // Whitelist + clamp every field; ignore anything unexpected.
        const rec = {
            kind,
            // navigation timing (ms from navigationStart)
            ttfb: intOrNull(b.ttfb),
            fcp: intOrNull(b.fcp),
            lcp: intOrNull(b.lcp),
            dcl: intOrNull(b.dcl),
            load: intOrNull(b.load),
            // app-reported boot milestones (ms from navigationStart)
            tFirstScreen: intOrNull(b.tFirstScreen),
            tRestore: intOrNull(b.tRestore),
            tPlayable: intOrNull(b.tPlayable),
            // transfer bytes by resource type (0 for cross-origin without TAO)
            htmlBytes: intOrNull(b.htmlBytes),
            jsBytes: intOrNull(b.jsBytes),
            cssBytes: intOrNull(b.cssBytes),
            imgBytes: intOrNull(b.imgBytes),
            apiImgBytes: intOrNull(b.apiImgBytes),
            apiImgCount: intOrNull(b.apiImgCount),
            totalBytes: intOrNull(b.totalBytes),
            // environment hints
            net: typeof b.net === 'string' ? b.net.slice(0, 12) : null,
            vw: intOrNull(b.vw),
            vh: intOrNull(b.vh),
            dpr: dprOrNull(b.dpr),
        };
        // One structured line. JSON.stringify so it's trivially greppable and
        // machine-parseable from the platform logs.
        console.log('[perf]', JSON.stringify(rec));
        return res.status(204).end();
    }
    catch (err) {
        // Telemetry must never surface an error to the client or spam logs —
        // swallow and 204. A malformed beacon is not worth a 500.
        console.error('[perf-beacon] bad payload', err?.message);
        return res.status(204).end();
    }
}
