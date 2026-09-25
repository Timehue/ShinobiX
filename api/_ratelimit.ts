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

import { kv } from './_storage.js';
import { clientIp } from './_client-ip.js';

type Bucket = { count: number; resetAt: number };
const _buckets = new Map<string, Bucket>();

// Garbage-collect expired buckets periodically so the Map doesn't grow
// without bound. Cheap — runs every 60s, walks at most a few hundred entries.
const _GC_INTERVAL_MS = 60_000;
let _gcTimer: ReturnType<typeof setInterval> | null = null;
function _ensureGc() {
    if (_gcTimer !== null) return;
    _gcTimer = setInterval(() => {
        const now = Date.now();
        for (const [k, b] of _buckets) {
            if (b.resetAt < now) _buckets.delete(k);
        }
    }, _GC_INTERVAL_MS);
    // Don't block process exit on the timer.
    if (typeof _gcTimer === 'object' && _gcTimer !== null && 'unref' in _gcTimer) {
        (_gcTimer as { unref: () => void }).unref();
    }
}

export type RateLimitDecision =
    | { ok: true }
    | { ok: false; retryAfterMs: number };

/**
 * Allow up to `limit` hits per `windowMs` for the given `key` against the
 * in-memory bucket. Synchronous; no I/O.
 */
export function allow(key: string, limit: number, windowMs: number): RateLimitDecision {
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
 * Whether `key` still has budget, WITHOUT consuming any.
 *
 * For buckets that should only count SOME outcomes — e.g. failed password
 * verifications, where a legitimate client always succeeds and never approaches the
 * limit, so charging every attempt would punish honest traffic. Check with this,
 * then call `allow()` only on the outcome you mean to charge for.
 */
export function hasBudget(key: string, limit: number): boolean {
    const bucket = _buckets.get(key);
    if (!bucket || bucket.resetAt < Date.now()) return true;
    return bucket.count < limit;
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
export async function allowKv(key: string, limit: number, windowMs: number, strict = false): Promise<RateLimitDecision> {
    const now = Date.now();
    const windowIndex = Math.floor(now / windowMs);
    const kvKey = `ratelimit:${key}:${windowIndex}`;
    try {
        // ATOMIC increment (kv_incr RPC). The previous get-then-set was a
        // non-atomic read-modify-write: concurrent requests in the same window
        // all read the same `current`, all passed the `< limit` check, and all
        // wrote `current+1`, so a burst could blow past the limit — exactly the
        // concurrency this tier exists to stop. kv.incr returns the post-
        // increment count, so the Nth allowed hit returns N; reject when the
        // count exceeds `limit`. TTL ~2x the window so stale keys self-clean
        // (and pg_cron purges them server-side).
        const ttlSec = Math.max(1, Math.ceil((windowMs / 1000) * 2));
        const count = await kv.incr(kvKey, { ex: ttlSec });
        if (count > limit) {
            const resetAt = (windowIndex + 1) * windowMs;
            return { ok: false, retryAfterMs: Math.max(0, resetAt - now) };
        }
        return { ok: true };
    } catch {
        // KV unavailable. Keep the fallback on the same aligned boundary as
        // the durable window so a retry hint names the actual next allowance.
        if (strict) return allowAlignedLocal(`kvfallback:${key}`, limit, windowMs);
        return { ok: true };
    }
}

/**
 * allowKv's exact fixed-window counting — windows aligned to
 * floor(now / windowMs), reject once the window's count exceeds `limit` — with
 * the counter kept in this process instead of a database increment.
 *
 * For the hottest per-player limits only (heartbeat, autosave), which cost a
 * database write on every request. The server runs one instance, so the count
 * is the same one the database would hold. The single difference: counters
 * restart when the process restarts (a deploy), which can at most hand a player
 * a fresh allowance for the window in progress. Never use this for daily caps
 * or anything else whose window outlives a deploy.
 */
function allowAlignedLocal(key: string, limit: number, windowMs: number): RateLimitDecision {
    _ensureGc();
    const now = Date.now();
    const windowIndex = Math.floor(now / windowMs);
    const resetAt = (windowIndex + 1) * windowMs;
    const bucketKey = `aligned:${key}:${windowIndex}`;
    const bucket = _buckets.get(bucketKey);
    const count = (bucket?.count ?? 0) + 1;
    _buckets.set(bucketKey, { count, resetAt });
    if (count > limit) return { ok: false, retryAfterMs: Math.max(0, resetAt - now) };
    return { ok: true };
}

/**
 * Test-only: forget every in-memory bucket. Suites that wipe the KV store
 * between tests used to reset the heartbeat/autosave windows with it; those
 * windows now live here ({ local: true }).
 */
export function __resetRateLimitsForTest(): void {
    _buckets.clear();
}

/** Test-only: the in-memory count charged to `key` (`<bucket>:name:<player>`) across live windows. */
export function __localWindowCountForTest(key: string): number {
    const prefix = `aligned:${key}:`;
    let sum = 0;
    for (const [bucketKey, bucket] of _buckets) if (bucketKey.startsWith(prefix)) sum += bucket.count;
    return sum;
}

/**
 * Extract a stable client key from the request. Prefers the authed player
 * name (most fair — one account, one quota). Falls back to req.ip / X-Forwarded-For.
 */
export function clientKey(
    req: { headers: Record<string, string | string[] | undefined>; ip?: string; socket?: { remoteAddress?: string } },
    authedName?: string | null,
): string {
    if (authedName) return `name:${authedName}`;
    // Cloudflare-aware: keys on the real client IP, not the Cloudflare edge IP.
    const ip = clientIp(req) ?? 'unknown';
    return `ip:${ip}`;
}

/**
 * A rate-limit key for a PUBLIC read that every signed-in player polls: the
 * (unverified) `x-player-name` authFetch attaches, PAIRED with the client IP.
 * Returns null for a request with no name, which stays purely IP-keyed.
 *
 * Why not the IP alone: an IP-keyed limit is shared by everyone behind one
 * address — a household, a dorm, a mobile carrier's CGNAT — so ordinary play by
 * a few neighbours trips it. Why not the name alone: the header is unverified,
 * so anyone anywhere could send a victim's name and drain THEIR budget (end a
 * ranked fight by exhausting pvp-session-get, say). Name@IP gives each account
 * on a shared address its own budget while a stranger on another address can
 * only ever spend their own. Rotating names from one address still mints
 * buckets, so pair this with a tight ipBackstopMultiplier
 * (PUBLIC_READ_IP_BACKSTOP) on anything expensive.
 *
 * For an endpoint that authenticates anyway, rate-limit AFTER authentication
 * on the verified identity instead — that is strictly better than this.
 */
export function requestPlayerKey(req: { headers: Record<string, string | string[] | undefined>; ip?: string; socket?: { remoteAddress?: string } }, nameOverride?: unknown): string | null {
    const raw = nameOverride !== undefined ? nameOverride : req.headers['x-player-name'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string') return null;
    const name = value.toLowerCase().replace(/[^a-z0-9\-_]/g, '').slice(0, 32); // safeName()'s rule
    if (!name) return null;
    return `${name}@${clientIp(req) ?? 'unknown'}`;
}

/**
 * IP backstop for requestPlayerKey buckets: how many players' worth of budget one
 * address may spend. Covers a household or small shared network at full rate
 * while holding a single client that rotates names to 4x the per-player limit,
 * not the 20x the general backstop allows (see IP_BACKSTOP_MULTIPLIER).
 */
export const PUBLIC_READ_IP_BACKSTOP = 4;

/**
 * How much total budget one IP gets when a bucket is keyed on a player name.
 *
 * Many handlers pass a name peeked from the request body BEFORE authenticating it
 * (heartbeat, pvp/move, claim-mission, and others). That is fine for fairness —
 * one account, one quota — but it means the key is attacker-controlled: rotating
 * the field mints a fresh bucket per request and the per-account limit stops
 * meaning anything.
 *
 * So every name-keyed check also charges an IP-keyed backstop at this multiple of
 * the same limit. Legitimate shared connections stay comfortable — a household or
 * dorm behind one address can run several accounts at the full per-account rate —
 * while a single client cycling names is capped instead of unbounded. In-memory
 * only: this is on hot paths and must not add a storage round trip.
 *
 * 20 rather than a tighter number on purpose. This is defence-in-depth, NOT the
 * primary control: expensive work is guarded where it happens (the failed-password
 * budget in _auth.ts fronts scrypt) and reward abuse is already blocked by server-side
 * authority, per-save locks and the currency caps in the save sanitizer. What the
 * backstop must prevent is UNBOUNDED bucket minting, and 20x does that while leaving
 * real headroom for a shared address — the combat heartbeat alone runs at ~60/min per
 * player, so a tighter cap could throttle a dozen housemates fighting at once.
 */
const IP_BACKSTOP_MULTIPLIER = 20;

/**
 * Charge the IP backstop for a name-keyed bucket. Returns the decision so callers
 * can 429 with a real retry hint. A no-op when the bucket is already IP-keyed
 * (`authedName` absent), since that is the same counter.
 */
function chargeIpBackstop(
    req: { headers: Record<string, string | string[] | undefined>; ip?: string; socket?: { remoteAddress?: string } },
    bucket: string,
    limit: number,
    windowMs: number,
    authedName?: string | null,
    multiplier: number = IP_BACKSTOP_MULTIPLIER,
): RateLimitDecision {
    if (!authedName) return { ok: true };
    const ip = clientIp(req) ?? 'unknown';
    return allow(`${bucket}:ipcap:${ip}`, limit * Math.max(1, multiplier), windowMs);
}

/**
 * The body of every rate-limit 429, written for a player, not a developer.
 * `code: 'RATE_LIMITED'` marks it for API callers. Screens that surface the
 * message through alert() are recognised by its WORDING instead (the alert
 * layer only sees text) and shown as a quiet toast, not a blocking notice —
 * shinobij.client/src/lib/slow-down-notice.ts; scripts/slow-down-notice-contract
 * .test.mjs fails if this wording and that matcher ever drift apart.
 */
export function rateLimitBody(retryAfterMs: number): { error: string; code: 'RATE_LIMITED'; retryAfterMs: number } {
    const seconds = Math.max(1, Math.ceil(Math.max(0, retryAfterMs) / 1000));
    return { error: `This action is temporarily unavailable. Try again in ${seconds}s.`, code: 'RATE_LIMITED', retryAfterMs };
}

// ── Refusal log ─────────────────────────────────────────────────────────────
// Which limits players actually hit, without a log line per refusal: counts are
// gathered in memory and written as ONE summary line a minute, only when
// something was refused. Players are named (they are who we need to find);
// address-keyed refusals are counted but the address itself is never logged.
const REFUSAL_LOG_INTERVAL_MS = 60_000;
const refusals = new Map<string, { total: number; who: Map<string, number> }>();
let refusalTimer: ReturnType<typeof setInterval> | null = null;

/**
 * "name:kaya" / "name:kaya@1.2.3.4" → "kaya"; an address key → "by address".
 * Several limits key on a name read from the request body BEFORE auth, so the
 * name is attacker-controlled: reduce it to safeName()'s alphabet (which also
 * strips newlines, control codes and the spaces a forged "by address" needs).
 */
function refusalLabel(clientKeyValue: string): string {
    if (!clientKeyValue.startsWith('name:')) return 'by address';
    const name = clientKeyValue.slice(5).split('@')[0].toLowerCase().replace(/[^a-z0-9\-_]/g, '').slice(0, 32);
    return name || 'unknown';
}

function noteRefusal(bucket: string, who: string): void {
    let entry = refusals.get(bucket);
    if (!entry) { entry = { total: 0, who: new Map() }; refusals.set(bucket, entry); }
    entry.total += 1;
    entry.who.set(who, (entry.who.get(who) ?? 0) + 1);
    if (refusalTimer === null) {
        refusalTimer = setInterval(() => { flushRefusalLog(); }, REFUSAL_LOG_INTERVAL_MS);
        if (typeof refusalTimer === 'object' && refusalTimer !== null && 'unref' in refusalTimer) {
            (refusalTimer as { unref: () => void }).unref();
        }
    }
}

/**
 * Write (and clear) the pending summary, e.g.
 * `[ratelimit] refusals in the last minute: heartbeat 12 (nero×10, kaya×2) · pvp-stream 3 (by address×3)`.
 * Returns the line, or null when nothing was refused. Exported for tests.
 */
export function flushRefusalLog(log: (line: string) => void = (line) => console.warn(line)): string | null {
    if (refusals.size === 0) return null;
    const parts = [...refusals.entries()]
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 12)
        .map(([bucket, entry]) => {
            const who = [...entry.who.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
                .map(([name, n]) => `${name}×${n}`).join(', ');
            return `${bucket} ${entry.total} (${who})`;
        });
    refusals.clear();
    // Names are as the requests CLAIMED them — some limits run before auth — so
    // treat them as leads to check, not proof of who sent the traffic.
    const line = `[ratelimit] refusals in the last minute (names as claimed): ${parts.join(' · ')}`;
    log(line);
    return line;
}

/** Record a refusal and write the 429. */
function refuse(
    res: { status: (n: number) => { json: (body: unknown) => void } },
    bucket: string,
    who: string,
    retryAfterMs: number,
): false {
    noteRefusal(bucket, who);
    res.status(429).json(rateLimitBody(retryAfterMs));
    return false;
}

/**
 * Convenience: rate-limit a request against the in-memory bucket, write a
 * 429 response if blocked, return boolean indicating whether the handler
 * should continue. Synchronous — does not consult KV.
 */
export function enforceRateLimit(
    req: { headers: Record<string, string | string[] | undefined>; ip?: string; socket?: { remoteAddress?: string } },
    res: { status: (n: number) => { json: (body: unknown) => void } },
    bucket: string,
    limit: number,
    windowMs: number,
    authedName?: string | null,
    opts?: { ipBackstopMultiplier?: number },
): boolean {
    const who = clientKey(req, authedName);
    const key = `${bucket}:${who}`;
    const d = allow(key, limit, windowMs);
    // Reject on the per-account limit BEFORE touching the shared IP backstop. Charging
    // an already-rejected request would let one abusive account drain the budget its
    // co-located neighbours share, turning a per-account limit into collateral lockout
    // for everyone behind the same address.
    if (!d.ok) return refuse(res, bucket, refusalLabel(who), d.retryAfterMs);
    const backstop = chargeIpBackstop(req, bucket, limit, windowMs, authedName, opts?.ipBackstopMultiplier);
    if (!backstop.ok) return refuse(res, bucket, 'address cap', backstop.retryAfterMs);
    return true;
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
 *
 * Pass `{ local: true }` to keep the same window in process memory instead of
 * a database increment (see allowAlignedLocal) — the heartbeat and autosave
 * limits only. The counter restarts on a deploy; `strict` is moot there.
 */
export async function enforceRateLimitKv(
    req: { headers: Record<string, string | string[] | undefined>; ip?: string; socket?: { remoteAddress?: string } },
    res: { status: (n: number) => { json: (body: unknown) => void } },
    bucket: string,
    limit: number,
    windowMs: number,
    authedName?: string | null,
    opts?: { strict?: boolean; local?: boolean; ipBackstopMultiplier?: number },
): Promise<boolean> {
    const who = clientKey(req, authedName);
    const key = `${bucket}:${who}`;
    // A tightened backstop marks a requestPlayerKey bucket, whose name half is
    // unverified: a client rotating names gets a fresh per-name bucket every
    // request, so without this each one would reach the KV increment below
    // before the backstop refused it. Peek (don't charge) the address's budget
    // first so an exhausted address never touches the database.
    if (authedName && opts?.ipBackstopMultiplier !== undefined) {
        const backstopKey = `${bucket}:ipcap:${clientIp(req) ?? 'unknown'}`;
        if (!hasBudget(backstopKey, limit * Math.max(1, opts.ipBackstopMultiplier))) {
            const resetAt = _buckets.get(backstopKey)?.resetAt ?? 0;
            return refuse(res, bucket, 'address cap', resetAt > Date.now() ? resetAt - Date.now() : windowMs);
        }
    }
    // Per-instance fast path — reject early on hot lambdas without a KV trip.
    // It shares the durable window boundary; a separate first-hit window could
    // promise an earlier retry while the durable bucket was still exhausted.
    const localBurstLimit = Math.max(limit, 5); // small local cushion
    const localBurstDecision = allowAlignedLocal(`local:${key}`, localBurstLimit, windowMs);
    if (!localBurstDecision.ok) return refuse(res, bucket, refusalLabel(who), localBurstDecision.retryAfterMs);
    // Authoritative path — KV-backed window (or the same window in memory).
    const kvDecision = opts?.local
        ? allowAlignedLocal(key, limit, windowMs)
        : await allowKv(key, limit, windowMs, opts?.strict ?? false);
    if (!kvDecision.ok) return refuse(res, bucket, refusalLabel(who), kvDecision.retryAfterMs);
    // IP backstop LAST, so only a request that would otherwise be allowed charges the
    // budget its co-located neighbours share. Rotating the name still lands here — each
    // fresh name passes its own per-account window and then meets this cap — so
    // ordering costs nothing in coverage and avoids punishing an IP for requests that
    // were already refused (see IP_BACKSTOP_MULTIPLIER).
    const backstop = chargeIpBackstop(req, bucket, limit, windowMs, authedName, opts?.ipBackstopMultiplier);
    if (!backstop.ok) return refuse(res, bucket, 'address cap', backstop.retryAfterMs);
    return true;
}
