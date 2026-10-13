/*
 * Shared pieces of the capacity probe (scripts/capacity-probe/README.md):
 * latency stats, the simulated Cloudflare edge cache, synthetic client IPs and
 * the target-safety gate. Pure and dependency-free so they are unit-tested
 * (lib.test.mjs) and identical in the orchestrator and every worker.
 */

// ── Latency stats ────────────────────────────────────────────────────────────

const RESERVOIR = 4_000;

/** Per-label latency/status accumulator with a bounded uniform reservoir. */
export class StatsBook {
    constructor(random = Math.random) {
        this.random = random;
        this.rows = new Map();
    }

    record(label, ms, status) {
        let row = this.rows.get(label);
        if (!row) {
            row = { n: 0, errors: 0, sumMs: 0, maxMs: 0, samples: [], statuses: {} };
            this.rows.set(label, row);
        }
        row.n += 1;
        row.sumMs += ms;
        if (ms > row.maxMs) row.maxMs = ms;
        if (isErrorStatus(status)) row.errors += 1;
        const key = String(status);
        row.statuses[key] = (row.statuses[key] ?? 0) + 1;
        if (row.samples.length < RESERVOIR) row.samples.push(ms);
        else {
            const slot = Math.floor(this.random() * row.n);
            if (slot < RESERVOIR) row.samples[slot] = ms;
        }
    }

    /** Plain-object form for IPC; merge() accepts it back. */
    toJSON() {
        return Object.fromEntries(this.rows);
    }

    merge(serialized) {
        for (const [label, src] of Object.entries(serialized ?? {})) {
            let row = this.rows.get(label);
            if (!row) {
                row = { n: 0, errors: 0, sumMs: 0, maxMs: 0, samples: [], statuses: {} };
                this.rows.set(label, row);
            }
            row.n += src.n;
            row.errors += src.errors;
            row.sumMs += src.sumMs;
            row.maxMs = Math.max(row.maxMs, src.maxMs);
            for (const [code, count] of Object.entries(src.statuses)) row.statuses[code] = (row.statuses[code] ?? 0) + count;
            // Keep the merged reservoir bounded; sampling each source in
            // proportion to its share keeps percentiles representative.
            row.samples.push(...src.samples);
            if (row.samples.length > RESERVOIR) {
                for (let i = row.samples.length - 1; i > 0; i -= 1) {
                    const j = Math.floor(this.random() * (i + 1));
                    [row.samples[i], row.samples[j]] = [row.samples[j], row.samples[i]];
                }
                row.samples.length = RESERVOIR;
            }
        }
    }

    summary() {
        const out = [];
        for (const [label, row] of this.rows) {
            const sorted = [...row.samples].sort((a, b) => a - b);
            out.push({
                label,
                n: row.n,
                errors: row.errors,
                errorRate: row.n ? row.errors / row.n : 0,
                p50: percentile(sorted, 50),
                p95: percentile(sorted, 95),
                p99: percentile(sorted, 99),
                max: Math.round(row.maxMs),
                statuses: row.statuses,
            });
        }
        return out.sort((a, b) => b.n - a.n);
    }
}

export function percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return Math.round(sorted[idx]);
}

/**
 * What counts as a failure. 409 (save-version conflict) and 429 (rate limit)
 * are designed answers under concurrency; a real client retries or backs off.
 * They are reported per status, never hidden, but they are not server errors.
 * 0 = transport failure / timeout.
 */
export function isErrorStatus(status) {
    return status === 0 || status >= 500 || (status >= 400 && status !== 409 && status !== 429);
}

// ── Simulated Cloudflare edge cache ──────────────────────────────────────────

/**
 * Production sits behind Cloudflare, which serves some public polls from its
 * edge (verified 2026-10-11 with cf-cache-status: game-state, world-state,
 * world-crisis, world-crisis-80, weekly-boss, player/roster). A generator on
 * Railway's private network reaches the origin directly, so without this every
 * one of those polls would land on the game server and overstate its load
 * several times over.
 *
 * Model: `pops` independent edge locations, each honouring the origin's
 * `s-maxage` (falling back to `defaultTtlMs`). A virtual player is pinned to one
 * POP. A request is a HIT while the POP's copy is fresh; otherwise it goes to
 * the origin. Concurrent misses at one POP share a single origin fetch, as
 * Cloudflare's request collapsing does. Stale-while-revalidate is ignored, which
 * errs toward MORE origin traffic, never less.
 */
export class EdgeCache {
    constructor({ pops = 6, now = Date.now, defaultTtlMs = 5_000 } = {}) {
        this.pops = Math.max(1, Math.floor(pops));
        this.now = now;
        this.defaultTtlMs = defaultTtlMs;
        this.entries = new Map(); // `${pop}|${route}` -> { expiresAt, value } | { inflight }
        this.hits = 0;
        this.misses = 0;
    }

    popFor(playerIndex) {
        return playerIndex % this.pops;
    }

    /**
     * fetchOrigin() must resolve to { value, ttlMs } where ttlMs comes from the
     * response's s-maxage (null/undefined → not cacheable at the edge).
     */
    async get(pop, route, fetchOrigin) {
        const key = `${pop}|${route}`;
        const entry = this.entries.get(key);
        if (entry?.value !== undefined && entry.expiresAt > this.now()) {
            this.hits += 1;
            return { hit: true, value: entry.value };
        }
        if (entry?.inflight) {
            this.hits += 1;
            const value = await entry.inflight;
            return { hit: true, value };
        }
        this.misses += 1;
        const inflight = (async () => {
            const { value, ttlMs } = await fetchOrigin();
            if (ttlMs && ttlMs > 0) this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
            else this.entries.delete(key);
            return value;
        })();
        this.entries.set(key, { inflight });
        try {
            return { hit: false, value: await inflight };
        } catch (err) {
            this.entries.delete(key);
            throw err;
        }
    }
}

/**
 * Edge TTL in ms from a Cache-Control header, or null when the edge must not
 * cache: s-maxage wins, else max-age (Cloudflare falls back to it — e.g.
 * /api/images?ids=1 sends only `public, max-age=60` and is a verified HIT).
 */
export function sMaxAgeMs(cacheControl) {
    if (!cacheControl) return null;
    if (/\b(no-store|no-cache|private)\b/i.test(cacheControl)) return null;
    const s = /\bs-maxage=(\d+)/i.exec(cacheControl);
    if (s) return Number(s[1]) * 1_000;
    const m = /(?:^|[\s,])max-age=(\d+)/i.exec(cacheControl);
    return m && Number(m[1]) > 0 ? Number(m[1]) * 1_000 : null;
}

// ── Synthetic client addresses ───────────────────────────────────────────────

/**
 * One address per virtual player from 198.18.0.0/15, the range RFC 2544
 * reserves for benchmarking: it can never collide with a real visitor, and the
 * game's anti-alt evidence (trustedVisitorIp) ignores non-public ranges, so
 * test accounts cannot be linked to real players or to each other.
 */
export function syntheticIp(index) {
    const n = index % (2 * 256 * 256 - 2) + 1;
    return `198.${18 + (n >> 16)}.${(n >> 8) & 0xff}.${n & 0xff}`;
}

// ── Load-test account naming ─────────────────────────────────────────────────

/** Every probe account is `lt<run><index>`; cleanup deletes exactly this pattern. */
export function probeAccountName(runId, index) {
    return `lt${runId}${String(index).padStart(5, '0')}`;
}

export function isProbeAccountName(name, runId) {
    return new RegExp(`^lt${runId}\\d{5}$`).test(String(name));
}

// ── Target safety ────────────────────────────────────────────────────────────

/**
 * The probe drives real accounts and real writes. It refuses to start unless
 * the operator names the exact host twice (target URL + confirmation), and it
 * refuses production unless that is ALSO explicit. Loopback needs neither.
 */
export function assertTargetAllowed({ targetUrl, confirmHost, allowProduction, productionHosts = [] }) {
    let url;
    try { url = new URL(targetUrl); } catch { throw new Error(`Invalid --target URL: ${targetUrl}`); }
    if (!/^https?:$/.test(url.protocol)) throw new Error('Target must be http(s).');
    const host = url.hostname.toLowerCase();
    const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    if (loopback) return { url, host, production: false, loopback: true };
    if (!confirmHost || confirmHost.toLowerCase() !== host) {
        throw new Error(`Refusing ${host}: set CAPACITY_CONFIRM_HOST=${host} to confirm the exact target.`);
    }
    const production = productionHosts.map((h) => h.toLowerCase()).includes(host);
    if (production && !allowProduction) {
        throw new Error(`Refusing production host ${host}: set CAPACITY_ALLOW_PRODUCTION=1 for an owner-approved production run.`);
    }
    return { url, host, production, loopback: false };
}

// ── Step plan ────────────────────────────────────────────────────────────────

/** "50:300,100:300,..." or a ramp spec "start-end/step@seconds" → [{ players, seconds }]. */
export function parseStepPlan(spec) {
    const ramp = /^(\d+)-(\d+)\/(\d+)@(\d+)$/.exec(String(spec).trim());
    if (ramp) {
        const [start, end, step, seconds] = ramp.slice(1).map(Number);
        if (step <= 0 || end < start) throw new Error(`Bad ramp: ${spec}`);
        const out = [];
        for (let players = start; players <= end; players += step) out.push({ players, seconds });
        return out;
    }
    return String(spec).split(',').map((part) => {
        const m = /^(\d+):(\d+)$/.exec(part.trim());
        if (!m) throw new Error(`Bad step "${part}" (want players:seconds)`);
        return { players: Number(m[1]), seconds: Number(m[2]) };
    });
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** ±jitter around a base interval so virtual players never move in lockstep. */
export function jittered(baseMs, fraction = 0.1, random = Math.random) {
    return Math.max(0, baseMs * (1 + (random() * 2 - 1) * fraction));
}
