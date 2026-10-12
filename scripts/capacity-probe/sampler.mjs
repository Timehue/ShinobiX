/*
 * Resource sampler for the capacity probe. Every SAMPLE_MS it records:
 *   - the game server's own view (/health/runtime, HEALTH_DEEP_TOKEN): main
 *     thread utilization and delay, CPU, memory, pg pool waiting, sockets;
 *   - Postgres (DATABASE_URL, read-only queries): database size, backends,
 *     sessions waiting on locks, WAL bytes generated;
 *   - Supabase's host (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, optional):
 *     CPU busy and memory used from the project's privileged Prometheus
 *     endpoint — the Micro instance is the expected first limit, and its CPU is
 *     invisible to SQL.
 *
 * It also enforces the disk guard: production's Supabase disk is spend-capped
 * at 8 GB and a full disk turns the database read-only (an outage), so the run
 * aborts when the database grows past CAPACITY_MAX_DB_BYTES.
 */
import { performance } from 'node:perf_hooks';

export function parsePrometheus(text) {
    const out = [];
    for (const line of String(text).split('\n')) {
        if (!line || line.startsWith('#')) continue;
        const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+([^\s]+)/.exec(line);
        if (!m) continue;
        const labels = {};
        if (m[3]) {
            for (const pair of m[3].matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g)) labels[pair[1]] = pair[2];
        }
        const value = Number(m[4]);
        if (Number.isFinite(value)) out.push({ name: m[1], labels, value });
    }
    return out;
}

/** CPU busy fraction between two node_cpu_seconds_total scrapes (all CPUs). */
export function cpuBusyFraction(prev, next) {
    const totals = (metrics) => {
        let all = 0;
        let idle = 0;
        for (const m of metrics) {
            if (m.name !== 'node_cpu_seconds_total') continue;
            all += m.value;
            if (m.labels.mode === 'idle' || m.labels.mode === 'iowait') idle += m.value;
        }
        return { all, idle };
    };
    const a = totals(prev);
    const b = totals(next);
    const dAll = b.all - a.all;
    if (!(dAll > 0)) return null;
    return Math.max(0, Math.min(1, 1 - (b.idle - a.idle) / dAll));
}

export function memoryUsedFraction(metrics) {
    const get = (name) => metrics.find((m) => m.name === name)?.value;
    const total = get('node_memory_MemTotal_bytes');
    const available = get('node_memory_MemAvailable_bytes');
    if (!total || available === undefined) return null;
    return 1 - available / total;
}

export class ResourceSampler {
    constructor({ targetUrl, healthToken, databaseUrl, supabaseUrl, serviceRoleKey, sampleMs = 15_000, maxDbBytes, log = console.log }) {
        this.targetUrl = targetUrl.replace(/\/$/, '');
        this.healthToken = healthToken;
        this.databaseUrl = databaseUrl;
        this.supabaseUrl = supabaseUrl?.replace(/\/$/, '');
        this.serviceRoleKey = serviceRoleKey;
        this.sampleMs = sampleMs;
        this.maxDbBytes = maxDbBytes;
        this.log = log;
        this.samples = [];
        this.abortReason = null;
        this.pgClient = null;
        this.prevProm = null;
        this.prevWal = null;
        this.timer = null;
    }

    async start() {
        if (this.databaseUrl) {
            const pg = (await import('pg')).default;
            // Same TLS posture as the game server's own pool (api/_storage.ts):
            // encrypted, but unverified unless a CA is supplied. Set
            // PG_CA_CERT_PATH to the provider's CA (Supabase: Database settings →
            // SSL certificate) to verify the server certificate as well.
            const caPath = process.env.PG_CA_CERT_PATH;
            const ssl = process.env.PG_SSL === 'disable'
                ? false
                : caPath
                    ? { rejectUnauthorized: true, ca: (await import('node:fs')).readFileSync(caPath, 'utf8') }
                    : { rejectUnauthorized: false };
            this.pgClient = new pg.Client({
                connectionString: this.databaseUrl.replace(/([?&])sslmode=[^&]*/g, '$1').replace(/[?&]$/, ''),
                ssl,
                statement_timeout: 5_000,
                application_name: 'capacity-probe-sampler',
            });
            await this.pgClient.connect();
        }
        await this.sampleOnce('baseline');
        this.timer = setInterval(() => { void this.sampleOnce(); }, this.sampleMs);
    }

    async stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        await this.sampleOnce('final').catch(() => undefined);
        await this.pgClient?.end().catch(() => undefined);
    }

    async runtime() {
        if (!this.healthToken) return null;
        const started = performance.now();
        try {
            const res = await fetch(`${this.targetUrl}/health/runtime`, {
                headers: { 'x-health-token': this.healthToken },
                signal: AbortSignal.timeout(5_000),
            });
            const body = await res.json().catch(() => null);
            return { status: res.status, ms: Math.round(performance.now() - started), ...(body?.runtime ?? {}), slo: body?.requestMetrics?.slo, rpm: body?.requestMetrics?.requestsPerMinute };
        } catch (err) {
            return { status: 0, ms: Math.round(performance.now() - started), error: err instanceof Error ? err.name : String(err) };
        }
    }

    async database() {
        if (!this.pgClient) return null;
        try {
            const { rows } = await this.pgClient.query(`
                SELECT pg_database_size(current_database())::bigint AS db_bytes,
                       (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::int AS backends,
                       (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'active')::int AS active,
                       (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock')::int AS lock_waits,
                       pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0')::bigint AS wal_pos,
                       (SELECT n_dead_tup FROM pg_stat_user_tables WHERE relname = 'kv_store')::bigint AS kv_dead_tuples`);
            const row = rows[0];
            const at = Date.now();
            const walPos = Number(row.wal_pos);
            let walBytesPerSec = null;
            if (this.prevWal) walBytesPerSec = Math.round((walPos - this.prevWal.pos) / ((at - this.prevWal.at) / 1_000));
            this.prevWal = { pos: walPos, at };
            return {
                dbBytes: Number(row.db_bytes),
                backends: row.backends,
                active: row.active,
                lockWaits: row.lock_waits,
                walBytesPerSec,
                kvDeadTuples: Number(row.kv_dead_tuples),
            };
        } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
        }
    }

    async supabaseHost() {
        if (!this.supabaseUrl || !this.serviceRoleKey) return null;
        try {
            const auth = Buffer.from(`service_role:${this.serviceRoleKey}`).toString('base64');
            const res = await fetch(`${this.supabaseUrl}/customer/v1/privileged/metrics`, {
                headers: { authorization: `Basic ${auth}` },
                signal: AbortSignal.timeout(8_000),
            });
            if (!res.ok) return { status: res.status };
            const metrics = parsePrometheus(await res.text());
            const cpu = this.prevProm ? cpuBusyFraction(this.prevProm, metrics) : null;
            this.prevProm = metrics;
            return { cpuBusy: cpu === null ? null : Math.round(cpu * 1_000) / 1_000, memUsed: memoryUsedFraction(metrics) };
        } catch (err) {
            return { error: err instanceof Error ? err.name : String(err) };
        }
    }

    async sampleOnce(tag) {
        const [runtime, db, host] = await Promise.all([this.runtime(), this.database(), this.supabaseHost()]);
        const sample = { at: Date.now(), tag, runtime, db, host };
        this.samples.push(sample);
        if (this.maxDbBytes && db?.dbBytes && db.dbBytes > this.maxDbBytes && !this.abortReason) {
            this.abortReason = `database size ${(db.dbBytes / 1e9).toFixed(2)} GB passed the ${(this.maxDbBytes / 1e9).toFixed(2)} GB guard`;
            this.log(`[capacity] ABORT: ${this.abortReason}`);
        }
        this.log(`[capacity-sample] ${JSON.stringify(compactSample(sample))}`);
        return sample;
    }

    /** Samples taken inside [from, to). */
    window(from, to) {
        return this.samples.filter((s) => s.at >= from && s.at < to);
    }
}

export function compactSample(s) {
    const r = s.runtime ?? {};
    return {
        at: new Date(s.at).toISOString(),
        ...(s.tag ? { tag: s.tag } : {}),
        elu: r.eventLoop?.utilization,
        loopP99: r.eventLoop?.delayMs?.p99,
        cpu: r.cpu?.cores,
        rssMb: r.memory?.rssMb,
        poolWait: r.pool?.waiting,
        poolTotal: r.pool?.total,
        sockets: r.realtime?.sockets,
        online: r.realtime?.onlinePlayers,
        healthMs: r.ms,
        dbGB: s.db?.dbBytes ? Math.round(s.db.dbBytes / 1e7) / 100 : undefined,
        pgBackends: s.db?.backends,
        pgActive: s.db?.active,
        pgLockWaits: s.db?.lockWaits,
        walMBs: s.db?.walBytesPerSec == null ? undefined : Math.round(s.db.walBytesPerSec / 1e4) / 100,
        sbCpu: s.host?.cpuBusy,
        sbMem: s.host?.memUsed == null ? undefined : Math.round(s.host.memUsed * 1_000) / 1_000,
    };
}

/** Aggregate a step's samples into the figures the report compares across steps. */
export function summarizeSamples(samples) {
    const nums = (pick) => samples.map(pick).filter((v) => typeof v === 'number' && Number.isFinite(v));
    const max = (arr) => (arr.length ? Math.max(...arr) : null);
    const avg = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 1_000) / 1_000 : null);
    return {
        samples: samples.length,
        eluAvg: avg(nums((s) => s.runtime?.eventLoop?.utilization)),
        eluMax: max(nums((s) => s.runtime?.eventLoop?.utilization)),
        loopP99Max: max(nums((s) => s.runtime?.eventLoop?.delayMs?.p99)),
        cpuCoresAvg: avg(nums((s) => s.runtime?.cpu?.cores)),
        rssMbMax: max(nums((s) => s.runtime?.memory?.rssMb)),
        poolWaitingMax: max(nums((s) => s.runtime?.pool?.waiting)),
        healthMsMax: max(nums((s) => s.runtime?.ms)),
        pgBackendsMax: max(nums((s) => s.db?.backends)),
        pgLockWaitsMax: max(nums((s) => s.db?.lockWaits)),
        walBytesPerSecAvg: avg(nums((s) => s.db?.walBytesPerSec)),
        dbBytesMax: max(nums((s) => s.db?.dbBytes)),
        supabaseCpuAvg: avg(nums((s) => s.host?.cpuBusy)),
        supabaseCpuMax: max(nums((s) => s.host?.cpuBusy)),
        supabaseMemMax: max(nums((s) => s.host?.memUsed)),
    };
}
