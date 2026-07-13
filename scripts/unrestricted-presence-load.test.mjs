import assert from 'node:assert/strict';
import test from 'node:test';
import {
    assertLoadSafety,
    parseArgs,
    percentile,
    summarizeLatencies,
    validateRunOptions,
} from './unrestricted-load-lib.mjs';

test('percentiles and summaries are deterministic', () => {
    assert.equal(percentile([40, 10, 30, 20], 0.5), 20);
    assert.deepEqual(summarizeLatencies([40, 10, 30, 20]), {
        min: 10,
        p50: 20,
        p95: 40,
        p99: 40,
        max: 40,
    });
});

test('production targets require an explicit opt-in and remain capped', () => {
    assert.throws(() => assertLoadSafety({
        baseUrl: 'https://shinobijourney.com', clients: 1, durationSeconds: 5, env: {},
    }), /ALLOW_PRODUCTION_LOAD/);
    assert.throws(() => assertLoadSafety({
        baseUrl: 'https://shinobijourney.com', clients: 26, durationSeconds: 5,
        env: { ALLOW_PRODUCTION_LOAD: '1' },
    }), /25 clients/);
    assert.doesNotThrow(() => assertLoadSafety({
        baseUrl: 'https://shinobijourney.com', clients: 25, durationSeconds: 60,
        env: { ALLOW_PRODUCTION_LOAD: '1' },
    }));
});

test('remote disposable targets require explicit acknowledgement', () => {
    assert.throws(() => assertLoadSafety({
        baseUrl: 'https://staging.example.com', clients: 25, durationSeconds: 120, env: {},
    }), /ALLOW_REMOTE_LOAD/);
    assert.doesNotThrow(() => assertLoadSafety({
        baseUrl: 'https://staging.example.com', clients: 300, durationSeconds: 600,
        env: { ALLOW_REMOTE_LOAD: '1' },
    }));
});

test('argument parsing retains safe defaults and validates event cadence', () => {
    const parsed = validateRunOptions(parseArgs([
        '--base-url', 'http://127.0.0.1:3000',
        '--accounts', 'accounts.json',
    ]));
    assert.equal(parsed.clients, 25);
    assert.equal(parsed.durationSeconds, 30);
    assert.equal(parsed.emitMs, 2_000);
    assert.throws(() => validateRunOptions({ ...parsed, emitMs: 999 }), /at least 1000/);
});
