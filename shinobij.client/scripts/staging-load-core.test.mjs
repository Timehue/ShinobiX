import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateReleaseThresholds,
  memoryGrowthPercent,
  parseEndpointMix,
  percentile,
  validateLoadTarget,
} from './staging-load-core.mjs';

test('nearest-rank percentile handles empty, singleton, and ordered samples', () => {
  assert.equal(percentile([], 0.95), null);
  assert.equal(percentile([17], 0.95), 17);
  assert.equal(percentile([100, 10, 20, 30, 40], 0.8), 40);
  assert.equal(percentile([1, 2, Number.NaN, 3, 4, 5], 0.95), 5);
  assert.throws(() => percentile([1], 1.1), /between 0 and 1/);
});

test('release gates use strict required thresholds and skip absent mutation latency', () => {
  const passing = evaluateReleaseThresholds({
    requestCount: 10_001,
    serverErrorCount: 10,
    requestErrorCount: 0,
    unexpectedStatusCount: 0,
    normalLatenciesMs: [100, 200, 499],
    saveRewardLatenciesMs: [],
    memoryGrowthPercent: 9.99,
    socket: { requested: 0 },
  });
  assert.equal(passing.passed, true);
  assert.equal(passing.checks.saveRewardP95.skipped, true);
  assert.ok(passing.observed.serverErrorRate < 0.001);

  const boundaryFailure = evaluateReleaseThresholds({
    requestCount: 1_000,
    serverErrorCount: 1,
    requestErrorCount: 0,
    unexpectedStatusCount: 0,
    normalLatenciesMs: [500],
    saveRewardLatenciesMs: [1_000],
    memoryGrowthPercent: 10,
    socket: { requested: 0 },
  });
  assert.equal(boundaryFailure.passed, false);
  assert.equal(boundaryFailure.checks.serverErrorRate.passed, false);
  assert.equal(boundaryFailure.checks.normalP95.passed, false);
  assert.equal(boundaryFailure.checks.saveRewardP95.passed, false);
  assert.equal(boundaryFailure.checks.memoryGrowth.passed, false);
});

test('socket gates require initial connections, snapshots, reconnect success, and clean shutdown', () => {
  const result = evaluateReleaseThresholds({
    requestCount: 1,
    serverErrorCount: 0,
    requestErrorCount: 0,
    unexpectedStatusCount: 0,
    normalLatenciesMs: [5],
    memoryGrowthPercent: 0,
    socket: {
      requested: 2,
      initialConnected: 2,
      snapshotClients: 2,
      reconnectAttempts: 2,
      reconnectSuccesses: 1,
      orphanCount: 1,
    },
  });
  assert.equal(result.passed, false);
  assert.equal(result.checks.socketReconnects.passed, false);
  assert.equal(result.checks.socketOrphans.passed, false);
});

test('memory growth reports percentage and target policy fails closed for remote hosts', () => {
  assert.equal(memoryGrowthPercent(100, 109), 9);
  assert.equal(memoryGrowthPercent(0, 100), null);
  assert.equal(validateLoadTarget('http://127.0.0.1:3000').origin, 'http://127.0.0.1:3000');
  assert.throws(() => validateLoadTarget('https://staging.example.test'), /LOAD_CONFIRM_TARGET_HOST/);
  assert.equal(
    validateLoadTarget('https://staging.example.test', { confirmedHost: 'staging.example.test' }).origin,
    'https://staging.example.test',
  );
  assert.throws(
    () => validateLoadTarget('https://game.example.test', {
      confirmedHost: 'game.example.test', deniedHosts: ['game.example.test'],
    }),
    /denylisted production host/,
  );
});

test('endpoint mix is read-only by default and mutations need disposable credentials plus confirmation', () => {
  assert.deepEqual(parseEndpointMix(''), [{
    name: 'health', method: 'GET', path: '/health', kind: 'normal', weight: 1,
    requiresAuth: false, mutation: false, body: undefined,
  }]);
  const mutation = JSON.stringify([{
    name: 'save', method: 'PUT', path: '/api/save/load-test', kind: 'saveReward', body: { test: true },
  }]);
  assert.throws(() => parseEndpointMix(mutation), /LOAD_DISPOSABLE_SCENARIO/);
  assert.throws(() => parseEndpointMix(mutation, {
    disposable: true, playerName: 'load-test', playerToken: 'token', mutationConfirmation: 'wrong',
  }), /LOAD_MUTATION_CONFIRM/);
  assert.equal(parseEndpointMix(mutation, {
    disposable: true,
    playerName: 'load-test',
    playerToken: 'token',
    mutationConfirmation: 'DISPOSABLE:load-test',
  })[0].mutation, true);
});
