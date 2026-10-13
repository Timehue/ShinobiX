import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAILURE, SLO, stepBreaches, stepFailures } from './probe.mjs';

const row = (label, n, errors, p95) => ({ label, n, errors, p95 });

test('a healthy step has no breaches', () => {
    assert.deepEqual(stepBreaches(
        [row('POST /api/player/heartbeat', 500, 0, 40), row('POST /api/save/:name', 200, 0, 300)],
        { healthMsMax: 20, eluMax: 0.4, poolWaitingMax: 0 },
    ), []);
});

test('saves get the 1 s budget, everything else 500 ms, and tiny samples are ignored', () => {
    const breaches = stepBreaches([
        row('POST /api/save/:name', 200, 0, 900),
        row('GET /api/game-state (edge miss)', 100, 0, 600),
        row('GET /api/messages', 5, 0, 5_000),
    ], {});
    assert.deepEqual(breaches, ['GET /api/game-state (edge miss) p95 600 ms > 500']);
});

test('error rate, server health, a busy event loop and pool waits each break the step', () => {
    const breaches = stepBreaches(
        [row('POST /api/player/heartbeat', 1_000, 20, 50), row('SETUP register', 100, 100, 9_000)],
        { healthMsMax: 400, eluMax: 0.95, poolWaitingMax: 3 },
    );
    assert.equal(breaches.length, 4);
    assert.match(breaches[0], /error rate 2\.00%/, 'SETUP rows never count');
    assert.match(breaches[1], /round trip 400 ms/);
    assert.match(breaches[2], /event loop 95% busy/);
    assert.match(breaches[3], /3 requests waiting/);
    assert.equal(SLO.maxErrorRate, 0.01);
});

test('slow side routes are a comfort breach, not a failure: the run keeps climbing', () => {
    // The 2026-10-12 run stopped at 200 players on exactly this shape.
    const summary = [
        row('GET /api/messages', 1_099, 0, 751),
        row('GET /api/village/intel', 629, 0, 820),
        row('POST /api/player/heartbeat', 1_678, 0, 81),
        row('POST /api/save/:name', 713, 0, 267),
    ];
    const resources = { healthMsMax: 89, eluAvg: 0.1, eluMax: 0.16, poolWaitingMax: 0 };
    assert.equal(stepBreaches(summary, resources).length, 2);
    assert.deepEqual(stepFailures(summary, resources), []);
});

test('failure thresholds: errors, core-route latency, health, sustained loop saturation', () => {
    const failures = stepFailures(
        [row('POST /api/player/heartbeat', 1_000, 20, 2_500), row('GET /api/messages', 500, 0, 9_000), row('SETUP register', 50, 50, 1)],
        { healthMsMax: 2_500, eluAvg: 0.97, poolWaitingMax: 11 },
    );
    assert.equal(failures.length, 4);
    assert.match(failures[0], /heartbeat p95 2500/);
    assert.match(failures[1], /error rate 1\.33%/);
    assert.match(failures[2], /round trip 2500/);
    assert.match(failures[3], /97% busy on average/);
    assert.ok(!failures.some((f) => f.includes('messages')), 'a slow side route alone never fails a step');
    assert.ok(!failures.some((f) => f.includes('waiting')), 'pool waits alone never fail a step');
    assert.equal(FAILURE.maxErrorRate, 0.01);
});