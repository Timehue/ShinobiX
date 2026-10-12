/**
 * Process-level runtime metrics for capacity work.
 *
 * The game server is ONE Node process (presence is in memory, so Railway pins a
 * single replica). Its first ceiling is the JavaScript main thread, not the
 * container's vCPU count: a 24-vCPU container still runs game logic on one core.
 * Request latency alone cannot say WHICH resource ran out, so a load test samples
 * this snapshot to tell apart:
 *   - a saturated main thread  (eventLoop.utilization â†’ 1, eventLoop delay climbs);
 *   - a starved database pool   (pool.waiting > 0 while the loop is idle);
 *   - memory growth             (memory.rssMb / heapUsedMb across a soak).
 *
 * Window semantics: eventLoop and cpu figures cover the interval since the
 * PREVIOUS snapshot (the histogram is reset on every read), so one sampler
 * polling every N seconds gets clean per-interval numbers. Concurrent readers
 * would split the windows between them; the endpoint is token-gated for exactly
 * that reason (one operator, one sampler).
 */
import { monitorEventLoopDelay, performance, type EventLoopUtilization } from 'node:perf_hooks';

type IntervalHistogram = ReturnType<typeof monitorEventLoopDelay>;

export interface RuntimePoolStats {
    max: number;
    total: number;
    idle: number;
    waiting: number;
}

export interface RuntimeMetricsSnapshot {
    generatedAt: number;
    uptimeSec: number;
    windowMs: number;
    eventLoop: {
        /** Fraction of the window the main thread was busy (0..1). ~1 = saturated. */
        utilization: number;
        delayMs: { p50: number; p99: number; max: number; mean: number };
    };
    cpu: {
        /** Process CPU over the window in cores (user+system; >1 means libuv/GC threads helped). */
        cores: number;
    };
    memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number; externalMb: number };
    pool: RuntimePoolStats | null;
    realtime: { sockets: number; onlinePlayers: number };
}

export interface RuntimeMetricsSources {
    pool?: () => RuntimePoolStats | null;
    sockets?: () => number;
    onlinePlayers?: () => number;
}

const NS_PER_MS = 1e6;
const BYTES_PER_MB = 1024 * 1024;

function round(value: number, digits = 2): number {
    if (!Number.isFinite(value)) return 0;
    const f = 10 ** digits;
    return Math.round(value * f) / f;
}

export class RuntimeMetricsSampler {
    private readonly histogram: IntervalHistogram;
    private lastAt: number;
    private lastElu: EventLoopUtilization;
    private lastCpu: NodeJS.CpuUsage;

    constructor(private readonly now: () => number = Date.now) {
        // 10 ms resolution keeps the sampler's own cost negligible while still
        // resolving the delays that matter (tens to hundreds of ms under load).
        this.histogram = monitorEventLoopDelay({ resolution: 10 });
        this.histogram.enable();
        this.lastAt = now();
        this.lastElu = performance.eventLoopUtilization();
        this.lastCpu = process.cpuUsage();
    }

    snapshot(sources: RuntimeMetricsSources = {}): RuntimeMetricsSnapshot {
        const at = this.now();
        const windowMs = Math.max(1, at - this.lastAt);
        const elu = performance.eventLoopUtilization(this.lastElu);
        const cpu = process.cpuUsage(this.lastCpu);
        const h = this.histogram;
        // An empty histogram (no samples yet) reports NaN/huge sentinels.
        const hasSamples = h.count > 0;
        const delayMs = {
            p50: hasSamples ? round(h.percentile(50) / NS_PER_MS) : 0,
            p99: hasSamples ? round(h.percentile(99) / NS_PER_MS) : 0,
            max: hasSamples ? round(h.max / NS_PER_MS) : 0,
            mean: hasSamples ? round(h.mean / NS_PER_MS) : 0,
        };
        h.reset();
        this.lastAt = at;
        this.lastElu = performance.eventLoopUtilization();
        this.lastCpu = process.cpuUsage();

        const mem = process.memoryUsage();
        let pool: RuntimePoolStats | null = null;
        try { pool = sources.pool?.() ?? null; } catch { pool = null; }
        let sockets = 0;
        try { sockets = sources.sockets?.() ?? 0; } catch { sockets = 0; }
        let onlinePlayers = 0;
        try { onlinePlayers = sources.onlinePlayers?.() ?? 0; } catch { onlinePlayers = 0; }

        return {
            generatedAt: at,
            uptimeSec: Math.round(process.uptime()),
            windowMs,
            eventLoop: { utilization: round(elu.utilization, 3), delayMs },
            cpu: { cores: round((cpu.user + cpu.system) / 1000 / windowMs, 3) },
            memory: {
                rssMb: round(mem.rss / BYTES_PER_MB, 1),
                heapUsedMb: round(mem.heapUsed / BYTES_PER_MB, 1),
                heapTotalMb: round(mem.heapTotal / BYTES_PER_MB, 1),
                externalMb: round(mem.external / BYTES_PER_MB, 1),
            },
            pool,
            realtime: { sockets, onlinePlayers },
        };
    }

    stop(): void {
        this.histogram.disable();
    }
}

let _shared: RuntimeMetricsSampler | null = null;

/** The process-wide sampler, started on first use. */
export function runtimeMetricsSampler(): RuntimeMetricsSampler {
    _shared ??= new RuntimeMetricsSampler();
    return _shared;
}
