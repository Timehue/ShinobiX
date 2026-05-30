"use strict";
/**
 * Two-tier rate limiter.
 *
 * Tier 1 — per-instance in-memory bucket. Cheap, no I/O. Catches burst abuse
 * within a single Vercel lambda or the long-lived cPanel Node process.
 *
 * Tier 2 — KV-backed fixed-window counter. Survives across serverless
 * invocations and Vercel's stateless cold starts. The in-memory limiter is
 * used as a fast pre-reject; if the local check passes, we then check the
 * KV-backed window asynchronously and reject if THAT is over.
 *
 * Uses a fixed-window counter (cheap and good enough for abuse prevention).
 * Returns { ok: true } when allowed, { ok: false, retryAfterMs } when limited.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.allow = allow;
exports.allowKv = allowKv;
exports.clientKey = clientKey;
exports.enforceRateLimit = enforceRateLimit;
exports.enforceRateLimitKv = enforceRateLimitKv;
const _storage_js_1 = require("./_storage.js");
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
 * Allow up to `limit` hits per `windowMs` for the given `key` against the
 * in-memory bucket. Synchronous; no I/O.
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
 * KV-backed rate-limit check. Uses a coarse fixed-window keyed by
 *   ratelimit:<bucket>:<clientKey>:<windowIndex>
 * windowIndex = floor(now / windowMs), so each window has its own key
 * with TTL = windowMs*2.
 *
 * Returns { ok: true } when allowed; { ok: false, retryAfterMs } when over.
 *
 * KV-outage behavior depends on `strict`:
 *   • strict=false (default) — fail OPEN (return ok=true) so a flaky KV doesn't
 *     lock legitimate players out of low-risk endpoints.
 *   • strict=true — fall back to a per-instance in-memory bucket at the SAME
 *     limit. This is NOT a hard fail-closed (it won't lock a normal user out;
 *     it just enforces the limit locally), but it prevents an outage from
 *     turning into "unlimited calls" on cost-bearing / abuse-sensitive paths
 *     (auth, rewards, generate-image). Per-instance means an attacker hopping
 *     serverless instances could still get `limit` per instance, but that's a
 *     far smaller blast radius than unbounded.
 */
async function allowKv(key, limit, windowMs, strict = false) {
    const now = Date.now();
    const windowIndex = Math.floor(now / windowMs);
    const kvKey = `ratelimit:${key}:${windowIndex}`;
    try {
        const current = Number((await _storage_js_1.kv.get(kvKey)) ?? 0);
        if (current >= limit) {
            const resetAt = (windowIndex + 1) * windowMs;
            return { ok: false, retryAfterMs: Math.max(0, resetAt - now) };
        }
        // Best-effort increment with TTL ~2x the window so stale keys self-clean.
        const ttlSec = Math.max(1, Math.ceil((windowMs / 1000) * 2));
        await _storage_js_1.kv.set(kvKey, current + 1, { ex: ttlSec }).catch(() => undefined);
        return { ok: true };
    }
    catch {
        // KV unavailable. Strict callers fall back to a per-instance bucket so
        // an outage can't unlock unlimited cost-bearing calls; others fail open.
        if (strict)
            return allow(`kvfallback:${key}`, limit, windowMs);
        return { ok: true };
    }
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
 * Convenience: rate-limit a request against the in-memory bucket, write a
 * 429 response if blocked, return boolean indicating whether the handler
 * should continue. Synchronous — does not consult KV.
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
/**
 * Two-tier enforcement: check in-memory bucket first (cheap), then the
 * KV-backed window (authoritative across serverless instances). Returns
 * true to continue, false if a 429 has already been written.
 *
 * Use this for endpoints that need durable rate limits (auth, save,
 * generate-image) so abusers can't bypass by hopping serverless instances.
 *
 * Pass `{ strict: true }` for cost-bearing / abuse-sensitive endpoints so a KV
 * outage falls back to a per-instance limit instead of fail-open (see allowKv).
 */
async function enforceRateLimitKv(req, res, bucket, limit, windowMs, authedName, opts) {
    const key = `${bucket}:${clientKey(req, authedName)}`;
    // Per-instance fast path — reject early on hot lambdas without a KV trip.
    const localBurstLimit = Math.max(limit, 5); // small local cushion
    const localBurstDecision = allow(`local:${key}`, localBurstLimit, windowMs);
    if (!localBurstDecision.ok) {
        res.status(429).json({ error: 'Rate limit exceeded.', retryAfterMs: localBurstDecision.retryAfterMs });
        return false;
    }
    // Authoritative path — KV-backed window.
    const kvDecision = await allowKv(key, limit, windowMs, opts?.strict ?? false);
    if (!kvDecision.ok) {
        res.status(429).json({ error: 'Rate limit exceeded.', retryAfterMs: kvDecision.retryAfterMs });
        return false;
    }
    return true;
}
