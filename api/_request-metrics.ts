/**
 * Bounded, in-process HTTP service-level metrics.
 *
 * The game can run on hosts where no metrics collector is available. Keeping a
 * short rolling window here makes latency and 5xx regressions visible through
 * the authenticated deep-health endpoint and through throttled warning logs.
 * Route names are deliberately coarse and samples are capped, preventing both
 * player-name cardinality and unbounded memory growth.
 */

export interface RequestMetricInput {
    method: string;
    path: string;
    statusCode: number;
    durationMs: number;
    at?: number;
}

export interface RequestRouteMetric {
    route: string;
    count: number;
    serverErrors: number;
    averageMs: number;
}

export interface RequestMetricsSnapshot {
    generatedAt: number;
    windowMs: number;
    count: number;
    requestsPerMinute: number;
    serverErrors: number;
    serverErrorRate: number;
    clientErrors: number;
    latencyMs: {
        average: number;
        p50: number;
        p95: number;
        p99: number;
        max: number;
        sampled: number;
    };
    routes: RequestRouteMetric[];
    slo: {
        healthy: boolean;
        evaluable: boolean;
        minimumRequests: number;
        p95TargetMs: number;
        maxServerErrorRate: number;
        breaches: string[];
    };
}

interface RouteAccumulator {
    count: number;
    serverErrors: number;
    durationTotalMs: number;
}

interface MetricBucket {
    start: number;
    count: number;
    serverErrors: number;
    clientErrors: number;
    durationTotalMs: number;
    durations: number[];
    routes: Map<string, RouteAccumulator>;
}

export interface RollingRequestMetricsOptions {
    windowMs?: number;
    bucketMs?: number;
    maxLatencySamplesPerBucket?: number;
    maxRoutesPerBucket?: number;
    p95TargetMs?: number;
    maxServerErrorRate?: number;
    minimumRequests?: number;
}

const DEFAULT_WINDOW_MS = 15 * 60_000;
const DEFAULT_BUCKET_MS = 60_000;

function finiteNumber(value: unknown, fallback: number): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function percentile(sorted: number[], fraction: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
    return Math.round(sorted[Math.min(index, sorted.length - 1)] * 10) / 10;
}

/** Collapse concrete API paths to a bounded, non-identifying service group. */
export function requestMetricRoute(path: string): string {
    const clean = String(path || '/').split('?')[0].replace(/\/+$/g, '') || '/';
    if (clean === '/health' || clean === '/api/health' || clean.startsWith('/health/')) return '/health';
    const withoutApi = clean.startsWith('/api/') ? clean.slice(5) : clean.replace(/^\//, '');
    const domain = withoutApi.split('/')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '');
    return domain ? `/api/${domain}` : '/other';
}

export class RollingRequestMetrics {
    private readonly windowMs: number;
    private readonly bucketMs: number;
    private readonly maxLatencySamplesPerBucket: number;
    private readonly maxRoutesPerBucket: number;
    private readonly p95TargetMs: number;
    private readonly maxServerErrorRate: number;
    private readonly minimumRequests: number;
    private readonly buckets = new Map<number, MetricBucket>();

    constructor(options: RollingRequestMetricsOptions = {}) {
        this.windowMs = Math.max(60_000, finiteNumber(options.windowMs, DEFAULT_WINDOW_MS));
        this.bucketMs = Math.max(1_000, finiteNumber(options.bucketMs, DEFAULT_BUCKET_MS));
        this.maxLatencySamplesPerBucket = Math.max(10, Math.floor(finiteNumber(options.maxLatencySamplesPerBucket, 2_000)));
        this.maxRoutesPerBucket = Math.max(4, Math.floor(finiteNumber(options.maxRoutesPerBucket, 64)));
        this.p95TargetMs = Math.max(1, finiteNumber(options.p95TargetMs, 1_500));
        this.maxServerErrorRate = Math.min(1, Math.max(0, finiteNumber(options.maxServerErrorRate, 0.02)));
        this.minimumRequests = Math.max(1, Math.floor(finiteNumber(options.minimumRequests, 20)));
    }

    record(input: RequestMetricInput): void {
        const at = finiteNumber(input.at, Date.now());
        const bucketStart = Math.floor(at / this.bucketMs) * this.bucketMs;
        this.prune(at);
        let bucket = this.buckets.get(bucketStart);
        if (!bucket) {
            bucket = {
                start: bucketStart,
                count: 0,
                serverErrors: 0,
                clientErrors: 0,
                durationTotalMs: 0,
                durations: [],
                routes: new Map(),
            };
            this.buckets.set(bucketStart, bucket);
        }

        const durationMs = Math.max(0, finiteNumber(input.durationMs, 0));
        const statusCode = Math.floor(finiteNumber(input.statusCode, 0));
        bucket.count += 1;
        bucket.durationTotalMs += durationMs;
        if (statusCode >= 500) bucket.serverErrors += 1;
        else if (statusCode >= 400) bucket.clientErrors += 1;

        if (bucket.durations.length < this.maxLatencySamplesPerBucket) {
            bucket.durations.push(durationMs);
        } else {
            // Deterministic reservoir replacement keeps recent high-volume
            // buckets bounded while still sampling across the whole minute.
            bucket.durations[bucket.count % this.maxLatencySamplesPerBucket] = durationMs;
        }

        const route = `${String(input.method || 'GET').toUpperCase()} ${requestMetricRoute(input.path)}`;
        let routeMetric = bucket.routes.get(route);
        if (!routeMetric && bucket.routes.size < this.maxRoutesPerBucket) {
            routeMetric = { count: 0, serverErrors: 0, durationTotalMs: 0 };
            bucket.routes.set(route, routeMetric);
        }
        if (routeMetric) {
            routeMetric.count += 1;
            routeMetric.durationTotalMs += durationMs;
            if (statusCode >= 500) routeMetric.serverErrors += 1;
        }
    }

    snapshot(now = Date.now()): RequestMetricsSnapshot {
        this.prune(now);
        let count = 0;
        let serverErrors = 0;
        let clientErrors = 0;
        let durationTotalMs = 0;
        const durations: number[] = [];
        const routes = new Map<string, RouteAccumulator>();

        for (const bucket of this.buckets.values()) {
            count += bucket.count;
            serverErrors += bucket.serverErrors;
            clientErrors += bucket.clientErrors;
            durationTotalMs += bucket.durationTotalMs;
            durations.push(...bucket.durations);
            for (const [route, metric] of bucket.routes) {
                const aggregate = routes.get(route) ?? { count: 0, serverErrors: 0, durationTotalMs: 0 };
                aggregate.count += metric.count;
                aggregate.serverErrors += metric.serverErrors;
                aggregate.durationTotalMs += metric.durationTotalMs;
                routes.set(route, aggregate);
            }
        }

        durations.sort((a, b) => a - b);
        const p95 = percentile(durations, 0.95);
        const serverErrorRate = count > 0 ? serverErrors / count : 0;
        const evaluable = count >= this.minimumRequests;
        const breaches: string[] = [];
        if (evaluable && p95 > this.p95TargetMs) breaches.push(`p95 ${p95}ms > ${this.p95TargetMs}ms`);
        if (evaluable && serverErrorRate > this.maxServerErrorRate) {
            breaches.push(`5xx ${(serverErrorRate * 100).toFixed(2)}% > ${(this.maxServerErrorRate * 100).toFixed(2)}%`);
        }

        return {
            generatedAt: now,
            windowMs: this.windowMs,
            count,
            requestsPerMinute: Math.round((count / (this.windowMs / 60_000)) * 100) / 100,
            serverErrors,
            serverErrorRate: Math.round(serverErrorRate * 100_000) / 100_000,
            clientErrors,
            latencyMs: {
                average: count > 0 ? Math.round((durationTotalMs / count) * 10) / 10 : 0,
                p50: percentile(durations, 0.5),
                p95,
                p99: percentile(durations, 0.99),
                max: durations.length > 0 ? Math.round(durations[durations.length - 1] * 10) / 10 : 0,
                sampled: durations.length,
            },
            routes: [...routes.entries()]
                .map(([route, metric]) => ({
                    route,
                    count: metric.count,
                    serverErrors: metric.serverErrors,
                    averageMs: Math.round((metric.durationTotalMs / metric.count) * 10) / 10,
                }))
                .sort((a, b) => b.count - a.count || a.route.localeCompare(b.route))
                .slice(0, 20),
            slo: {
                healthy: breaches.length === 0,
                evaluable,
                minimumRequests: this.minimumRequests,
                p95TargetMs: this.p95TargetMs,
                maxServerErrorRate: this.maxServerErrorRate,
                breaches,
            },
        };
    }

    private prune(now: number): void {
        const cutoff = now - this.windowMs;
        for (const [start] of this.buckets) {
            if (start + this.bucketMs <= cutoff) this.buckets.delete(start);
        }
    }
}

const sharedMetrics = new RollingRequestMetrics({
    p95TargetMs: finiteNumber(process.env.REQUEST_SLO_P95_MS, 1_500),
    maxServerErrorRate: finiteNumber(process.env.REQUEST_SLO_MAX_5XX_RATE, 0.02),
    minimumRequests: finiteNumber(process.env.REQUEST_SLO_MIN_REQUESTS, 20),
});

const DEFAULT_EVALUATION_INTERVAL_MS = 15_000;
const ALERT_INTERVAL_MS = 5 * 60_000;

export interface RequestSloAlertGateOptions {
    evaluationIntervalMs?: number;
    alertIntervalMs?: number;
}

/**
 * Throttle the expensive rolling-window aggregation independently from alert
 * delivery. The response-finish middleware calls this for every request, so
 * checking the evaluation timestamp before invoking the snapshot provider is
 * what keeps percentile sorting off the hot path.
 */
export class RequestSloAlertGate {
    private readonly evaluationIntervalMs: number;
    private readonly alertIntervalMs: number;
    private lastEvaluationAt: number | null = null;
    private lastAlertAt: number | null = null;

    constructor(options: RequestSloAlertGateOptions = {}) {
        this.evaluationIntervalMs = Math.max(1_000, finiteNumber(options.evaluationIntervalMs, DEFAULT_EVALUATION_INTERVAL_MS));
        this.alertIntervalMs = Math.max(this.evaluationIntervalMs, finiteNumber(options.alertIntervalMs, ALERT_INTERVAL_MS));
    }

    evaluate(snapshotProvider: () => RequestMetricsSnapshot, now = Date.now()): string | null {
        if (this.lastEvaluationAt !== null) {
            const sinceEvaluation = now - this.lastEvaluationAt;
            if (sinceEvaluation >= 0 && sinceEvaluation < this.evaluationIntervalMs) return null;
        }
        this.lastEvaluationAt = now;

        const snapshot = snapshotProvider();
        if (!snapshot.slo.evaluable || snapshot.slo.healthy) return null;
        if (this.lastAlertAt !== null) {
            const sinceAlert = now - this.lastAlertAt;
            if (sinceAlert >= 0 && sinceAlert < this.alertIntervalMs) return null;
        }
        this.lastAlertAt = now;
        // This is a process-wide aggregate, not a measurement of the request
        // that happened to trigger evaluation. Keep the scope explicit so
        // incident tools do not mislabel the warning as route-specific.
        return `[request-slo:global] ${snapshot.slo.breaches.join('; ')} over ${snapshot.count} requests/${Math.round(snapshot.windowMs / 60_000)}m`;
    }

    reset(): void {
        this.lastEvaluationAt = null;
        this.lastAlertAt = null;
    }
}

const sharedSloAlertGate = new RequestSloAlertGate({
    evaluationIntervalMs: finiteNumber(process.env.REQUEST_SLO_EVALUATION_INTERVAL_MS, DEFAULT_EVALUATION_INTERVAL_MS),
});

export function recordRequestMetric(input: RequestMetricInput): void {
    sharedMetrics.record(input);
}

export function readRequestMetrics(now = Date.now()): RequestMetricsSnapshot {
    return sharedMetrics.snapshot(now);
}

/** Return a throttled warning suitable for logs/Sentry, or null when healthy. */
export function requestSloAlert(now = Date.now()): string | null {
    return sharedSloAlertGate.evaluate(() => sharedMetrics.snapshot(now), now);
}
