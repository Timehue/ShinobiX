"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const _request_metrics_js_1 = require("./_request-metrics.js");
(0, node_test_1.default)('requestMetricRoute removes player-specific path cardinality', () => {
    strict_1.default.equal((0, _request_metrics_js_1.requestMetricRoute)('/api/save/SecretPlayer?x=1'), '/api/save');
    strict_1.default.equal((0, _request_metrics_js_1.requestMetricRoute)('/pvp/session/abc'), '/api/pvp');
    strict_1.default.equal((0, _request_metrics_js_1.requestMetricRoute)('/health/db'), '/health');
});
(0, node_test_1.default)('rolling request metrics reports latency, errors, and route groups', () => {
    const metrics = new _request_metrics_js_1.RollingRequestMetrics({
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
    strict_1.default.equal(snapshot.count, 3);
    strict_1.default.equal(snapshot.serverErrors, 1);
    strict_1.default.equal(snapshot.clientErrors, 1);
    strict_1.default.equal(snapshot.latencyMs.p50, 40);
    strict_1.default.equal(snapshot.latencyMs.p95, 200);
    strict_1.default.deepEqual(snapshot.slo.breaches, ['p95 200ms > 100ms', '5xx 33.33% > 20.00%']);
    strict_1.default.deepEqual(snapshot.routes.map((route) => route.route), ['GET /api/save', 'POST /api/pvp']);
});
(0, node_test_1.default)('rolling request metrics expires old buckets and caps latency samples', () => {
    const metrics = new _request_metrics_js_1.RollingRequestMetrics({
        windowMs: 60_000,
        bucketMs: 10_000,
        maxLatencySamplesPerBucket: 10,
    });
    for (let i = 0; i < 50; i++) {
        metrics.record({ method: 'GET', path: '/api/game-state', statusCode: 200, durationMs: i, at: 10_000 });
    }
    strict_1.default.equal(metrics.snapshot(10_001).latencyMs.sampled, 10);
    strict_1.default.equal(metrics.snapshot(80_000).count, 0);
});
(0, node_test_1.default)('SLO alert gate throttles before building another expensive snapshot and can reset', () => {
    const gate = new _request_metrics_js_1.RequestSloAlertGate({ evaluationIntervalMs: 15_000, alertIntervalMs: 300_000 });
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
    strict_1.default.match(gate.evaluate(unhealthySnapshot, 100_000) ?? '', /\[request-slo:global\]/);
    strict_1.default.equal(snapshotCalls, 1);
    strict_1.default.equal(gate.evaluate(unhealthySnapshot, 114_999), null);
    strict_1.default.equal(snapshotCalls, 1, 'snapshot provider must stay off the per-request hot path');
    strict_1.default.equal(gate.evaluate(unhealthySnapshot, 115_000), null, 'alert delivery remains independently throttled');
    strict_1.default.equal(snapshotCalls, 2, 'the rolling window is reevaluated after 15 seconds');
    gate.reset();
    strict_1.default.match(gate.evaluate(unhealthySnapshot, 115_001) ?? '', /\[request-slo:global\]/);
    strict_1.default.equal(snapshotCalls, 3, 'reset permits an immediate fresh evaluation');
});
