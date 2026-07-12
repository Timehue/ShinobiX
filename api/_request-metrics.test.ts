import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestSloAlertGate, RollingRequestMetrics, requestMetricRoute } from './_request-metrics.js';

test('requestMetricRoute removes player-specific path cardinality', () => {
    assert.equal(requestMetricRoute('/api/save/SecretPlayer?x=1'), '/api/save');
    assert.equal(requestMetricRoute('/pvp/session/abc'), '/api/pvp');
    assert.equal(requestMetricRoute('/health/db'), '/health');
});

test('rolling request metrics reports latency, errors, and route groups', () => {
    const metrics = new RollingRequestMetrics({
        windowMs: 60_000,
        bucketMs: 10_000,
        minimumRequests: 2,
        p95TargetMs: 100,
        maxServerErrorRate: 0.2,
    });
    const at = 100_000;
    metrics.record({ method: 'GET', path: '/api/save/A', statusCode: 200, durationMs: 20, at });
    metrics.record({ method: 'GET', path: '/api/save/B', statusCode: 503, durationMs: 200, at: at + 1 });
    metrics.record({ method: 'POST', path: '/api/pvp/move/1', statusCode: 400, durationMs: 40, at: at + 2 });

    const snapshot = metrics.snapshot(at + 3);
    assert.equal(snapshot.count, 3);
    assert.equal(snapshot.serverErrors, 1);
    assert.equal(snapshot.clientErrors, 1);
    assert.equal(snapshot.latencyMs.p50, 40);
    assert.equal(snapshot.latencyMs.p95, 200);
    assert.deepEqual(snapshot.slo.breaches, ['p95 200ms > 100ms', '5xx 33.33% > 20.00%']);
    assert.deepEqual(snapshot.routes.map((route) => route.route), ['GET /api/save', 'POST /api/pvp']);
});

test('rolling request metrics expires old buckets and caps latency samples', () => {
    const metrics = new RollingRequestMetrics({
        windowMs: 60_000,
        bucketMs: 10_000,
        maxLatencySamplesPerBucket: 10,
    });
    for (let i = 0; i < 50; i++) {
        metrics.record({ method: 'GET', path: '/api/game-state', statusCode: 200, durationMs: i, at: 10_000 });
    }
    assert.equal(metrics.snapshot(10_001).latencyMs.sampled, 10);
    assert.equal(metrics.snapshot(80_000).count, 0);
});

test('SLO alert gate throttles before building another expensive snapshot and can reset', () => {
    const gate = new RequestSloAlertGate({ evaluationIntervalMs: 15_000, alertIntervalMs: 300_000 });
    let snapshotCalls = 0;
    const unhealthySnapshot = () => {
        snapshotCalls += 1;
        return {
            generatedAt: 100_000,
            windowMs: 15 * 60_000,
            count: 50,
            requestsPerMinute: 3.33,
            serverErrors: 2,
            serverErrorRate: 0.04,
            clientErrors: 0,
            latencyMs: { average: 1_600, p50: 1_200, p95: 2_000, p99: 2_100, max: 2_200, sampled: 50 },
            routes: [],
            slo: {
                healthy: false,
                evaluable: true,
                minimumRequests: 20,
                p95TargetMs: 1_500,
                maxServerErrorRate: 0.02,
                breaches: ['p95 2000ms > 1500ms'],
            },
        };
    };

    assert.match(gate.evaluate(unhealthySnapshot, 100_000) ?? '', /\[request-slo:global\]/);
    assert.equal(snapshotCalls, 1);
    assert.equal(gate.evaluate(unhealthySnapshot, 114_999), null);
    assert.equal(snapshotCalls, 1, 'snapshot provider must stay off the per-request hot path');

    assert.equal(gate.evaluate(unhealthySnapshot, 115_000), null, 'alert delivery remains independently throttled');
    assert.equal(snapshotCalls, 2, 'the rolling window is reevaluated after 15 seconds');

    gate.reset();
    assert.match(gate.evaluate(unhealthySnapshot, 115_001) ?? '', /\[request-slo:global\]/);
    assert.equal(snapshotCalls, 3, 'reset permits an immediate fresh evaluation');
});
