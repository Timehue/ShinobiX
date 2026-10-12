import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SLO, stepBreaches } from './probe.mjs';

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
