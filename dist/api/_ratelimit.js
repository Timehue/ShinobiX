"use strict";
/**
 * Lightweight in-process rate limiter.
 *
 * Works great on cPanel (one long-lived Node process, in-memory state survives).
 * On Vercel (stateless serverless), each function invocation starts fresh, so
 * this effectively becomes a per-instance limiter — still useful for capping
 * burst behavior within a single hot lambda.
 *
 * Uses a fixed-window counter (cheap and good enough for abuse prevention).
 * Returns { ok: true } when allowed, { ok: false, retryAfterMs } when limited.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.allow = allow;
exports.clientKey = clientKey;
exports.enforceRateLimit = enforceRateLimit;
const _buckets = new Map();
// Garbage-collect expired buckets periodically so the Map doesn't grow
// without bound. Cheap — runs every 60s, walks at most a few hundred entries.
const _GC_INTERVAL_MS = 60_000;
let _gcTimer = null;
function _ensureGc() {
    if (_gcTimer !== null)
        return;
    _gcTimer = setInterval(() => {
        const now = Date.now();
        for (const [k, b] of _buckets) {
            if (b.resetAt < now)
                _buckets.delete(k);
        }
    }, _GC_INTERVAL_MS);
    // Don't block process exit on the timer.
    if (typeof _gcTimer === 'object' && _gcTimer !== null && 'unref' in _gcTimer) {
        _gcTimer.unref();
    }
}
/**
 * Allow up to `limit` hits per `windowMs` for the given `key`.
 */
function allow(key, limit, windowMs) {
    _ensureGc();
    const now = Date.now();
    const existing = _buckets.get(key);
    if (!existing || existing.resetAt < now) {
        _buckets.set(key, { count: 1, resetAt: now + windowMs });
        return { ok: true };
    }
    if (existing.count >= limit) {
        return { ok: false, retryAfterMs: Math.max(0, existing.resetAt - now) };
    }
    existing.count += 1;
    return { ok: true };
}
/**
 * Extract a stable client key from the request. Prefers the authed player
 * name (most fair — one account, one quota). Falls back to req.ip / X-Forwarded-For.
 */
function clientKey(req, authedName) {
    if (authedName)
        return `name:${authedName}`;
    const xff = req.headers['x-forwarded-for'];
    const xffStr = Array.isArray(xff) ? xff[0] : xff;
    const ip = xffStr?.split(',')[0]?.trim() || req.ip || req.socket?.remoteAddress || 'unknown';
    return `ip:${ip}`;
}
/**
 * Convenience: rate-limit a request, write a 429 response if blocked, return
 * boolean indicating whether the handler should continue.
 */
function enforceRateLimit(req, res, bucket, limit, windowMs, authedName) {
    const key = `${bucket}:${clientKey(req, authedName)}`;
    const d = allow(key, limit, windowMs);
    if (d.ok)
        return true;
    res.status(429).json({
        error: 'Rate limit exceeded.',
        retryAfterMs: d.retryAfterMs,
    });
    return false;
}
