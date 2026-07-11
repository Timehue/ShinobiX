export const RELEASE_LOAD_THRESHOLDS = Object.freeze({
  maxServerErrorRate: 0.001,
  maxNormalP95Ms: 500,
  maxSaveRewardP95Ms: 1_000,
  maxMemoryGrowthPercent: 10,
});

const SAFE_METHODS = new Set(['GET', 'HEAD']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

function finiteValues(values) {
  return values.filter((value) => Number.isFinite(value)).map(Number);
}

/** Nearest-rank percentile. Returns null when no observations were recorded. */
export function percentile(values, quantile) {
  if (!Number.isFinite(quantile) || quantile < 0 || quantile > 1) {
    throw new RangeError('quantile must be between 0 and 1');
  }
  const sorted = finiteValues(values).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const rank = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return sorted[rank];
}

export function memoryGrowthPercent(startBytes, endBytes) {
  if (!Number.isFinite(startBytes) || startBytes <= 0 || !Number.isFinite(endBytes)) return null;
  return ((endBytes - startBytes) / startBytes) * 100;
}

function comparisonCheck({ id, observed, limit, operator, skipped = false, detail }) {
  let passed = true;
  if (!skipped) {
    if (!Number.isFinite(observed)) passed = false;
    else if (operator === '<') passed = observed < limit;
    else if (operator === '===') passed = observed === limit;
    else if (operator === '>=') passed = observed >= limit;
    else throw new Error(`unsupported operator: ${operator}`);
  }
  return { id, passed, skipped, observed, operator, limit, ...(detail ? { detail } : {}) };
}

/**
 * Turn raw measurements into a stable, machine-readable release gate.
 * Thresholds are intentionally strict comparisons: 0.1%, 500 ms, 1,000 ms,
 * and 10% are failures rather than passes.
 */
export function evaluateReleaseThresholds(measurements, thresholds = RELEASE_LOAD_THRESHOLDS) {
  const requestCount = Number(measurements.requestCount ?? 0);
  const serverErrorCount = Number(measurements.serverErrorCount ?? 0);
  const requestErrorCount = Number(measurements.requestErrorCount ?? 0);
  const unexpectedStatusCount = Number(measurements.unexpectedStatusCount ?? 0);
  const normalP95Ms = percentile(measurements.normalLatenciesMs ?? [], 0.95);
  const saveRewardP95Ms = percentile(measurements.saveRewardLatenciesMs ?? [], 0.95);
  const serverErrorRate = requestCount > 0 ? serverErrorCount / requestCount : null;
  const memoryGrowth = Number.isFinite(measurements.memoryGrowthPercent)
    ? Number(measurements.memoryGrowthPercent)
    : null;
  const socket = measurements.socket ?? {};
  const socketRequested = Number(socket.requested ?? 0);
  const socketEnabled = socketRequested > 0;
  const reconnectAttempts = Number(socket.reconnectAttempts ?? 0);
  const reconnectRate = reconnectAttempts > 0
    ? Number(socket.reconnectSuccesses ?? 0) / reconnectAttempts
    : null;

  const checks = {
    serverErrorRate: comparisonCheck({
      id: 'server-error-rate', observed: serverErrorRate,
      operator: '<', limit: thresholds.maxServerErrorRate,
    }),
    normalP95: comparisonCheck({
      id: 'normal-p95-ms', observed: normalP95Ms,
      operator: '<', limit: thresholds.maxNormalP95Ms,
    }),
    saveRewardP95: comparisonCheck({
      id: 'save-reward-p95-ms', observed: saveRewardP95Ms,
      operator: '<', limit: thresholds.maxSaveRewardP95Ms,
      skipped: saveRewardP95Ms === null,
      detail: saveRewardP95Ms === null ? 'No explicit disposable save/reward scenario was run.' : undefined,
    }),
    memoryGrowth: comparisonCheck({
      id: 'load-generator-memory-growth-percent', observed: memoryGrowth,
      operator: '<', limit: thresholds.maxMemoryGrowthPercent,
      detail: 'Measures the load-generator process after socket cleanup; verify server RSS in Railway metrics too.',
    }),
    requestErrors: comparisonCheck({
      id: 'request-errors', observed: requestErrorCount,
      operator: '===', limit: 0,
    }),
    unexpectedStatuses: comparisonCheck({
      id: 'unexpected-http-statuses', observed: unexpectedStatusCount,
      operator: '===', limit: 0,
    }),
    socketInitialConnections: comparisonCheck({
      id: 'socket-initial-connections', observed: Number(socket.initialConnected ?? 0),
      operator: '===', limit: socketRequested, skipped: !socketEnabled,
    }),
    socketSnapshots: comparisonCheck({
      id: 'socket-presence-snapshots', observed: Number(socket.snapshotClients ?? 0),
      operator: '===', limit: socketRequested, skipped: !socketEnabled,
    }),
    socketReconnects: comparisonCheck({
      id: 'socket-reconnect-success-rate', observed: reconnectRate,
      operator: '===', limit: 1, skipped: !socketEnabled,
      detail: socketEnabled && reconnectAttempts === 0 ? 'No reconnect cycle completed.' : undefined,
    }),
    socketOrphans: comparisonCheck({
      id: 'socket-local-orphans-after-cleanup', observed: Number(socket.orphanCount ?? 0),
      operator: '===', limit: 0, skipped: !socketEnabled,
      detail: socketEnabled ? 'Server-side presence expiry is not observable from the public staging API.' : undefined,
    }),
  };

  return {
    passed: Object.values(checks).every((check) => check.skipped || check.passed),
    thresholds: {
      serverErrorRate: { operator: '<', value: thresholds.maxServerErrorRate, display: '<0.1%' },
      normalP95Ms: { operator: '<', value: thresholds.maxNormalP95Ms },
      saveRewardP95Ms: { operator: '<', value: thresholds.maxSaveRewardP95Ms },
      memoryGrowthPercent: { operator: '<', value: thresholds.maxMemoryGrowthPercent },
    },
    observed: { serverErrorRate, normalP95Ms, saveRewardP95Ms, memoryGrowthPercent: memoryGrowth },
    checks,
  };
}

function normalizedHost(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return '';
  try {
    return new URL(text.includes('://') ? text : `https://${text}`).host.toLowerCase();
  } catch {
    return text.replace(/^\[|\]$/g, '');
  }
}

/** Remote targets require an exact host acknowledgement and can be denylisted. */
export function validateLoadTarget(rawTarget, { confirmedHost = '', deniedHosts = [] } = {}) {
  let url;
  try {
    url = new URL(String(rawTarget ?? ''));
  } catch {
    throw new Error('LOAD_TARGET_URL must be an absolute http(s) URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('LOAD_TARGET_URL must use http or https');
  if (url.username || url.password) throw new Error('LOAD_TARGET_URL must not contain credentials');
  if (url.search || url.hash) throw new Error('LOAD_TARGET_URL must not contain a query string or hash');
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('LOAD_TARGET_URL must be an origin without a path');

  const targetHost = url.host.toLowerCase();
  const denied = new Set(deniedHosts.map(normalizedHost).filter(Boolean));
  if (denied.has(targetHost) || denied.has(url.hostname.toLowerCase())) {
    throw new Error(`refusing denylisted production host: ${targetHost}`);
  }

  if (!LOCAL_HOSTS.has(url.hostname.toLowerCase())) {
    const confirmation = normalizedHost(confirmedHost);
    if (!confirmation || confirmation !== targetHost) {
      throw new Error(`remote load target requires LOAD_CONFIRM_TARGET_HOST=${targetHost}`);
    }
  }
  return new URL(url.origin);
}

export function parseBoundedInteger(value, { name, defaultValue, min, max }) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

/** Parse and policy-check the endpoint mix without exposing arbitrary headers. */
export function parseEndpointMix(rawJson, scenario = {}) {
  const raw = rawJson ? JSON.parse(rawJson) : [
    { name: 'health', method: 'GET', path: '/health', kind: 'normal', weight: 1 },
  ];
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 20) {
    throw new Error('LOAD_ENDPOINTS_JSON must contain 1 to 20 endpoint objects');
  }

  const endpoints = raw.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`endpoint ${index} must be an object`);
    }
    const method = String(entry.method ?? 'GET').trim().toUpperCase();
    const path = String(entry.path ?? '').trim();
    const kind = entry.kind === 'saveReward' ? 'saveReward' : 'normal';
    const name = String(entry.name ?? `endpoint-${index + 1}`).trim().slice(0, 80);
    const weight = parseBoundedInteger(entry.weight, {
      name: `endpoint ${index} weight`, defaultValue: 1, min: 1, max: 20,
    });
    const requiresAuth = entry.requiresAuth === true;
    if (!name) throw new Error(`endpoint ${index} requires a name`);
    if (!/^[A-Z]+$/.test(method)) throw new Error(`endpoint ${name} has an invalid method`);
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error(`endpoint ${name} path must start with one /`);
    const mutation = !SAFE_METHODS.has(method);
    if (mutation && entry.body === undefined) throw new Error(`mutating endpoint ${name} requires an explicit body`);
    return { name, method, path, kind, weight, requiresAuth, mutation, body: entry.body };
  });

  const protectedScenario = endpoints.some((endpoint) => endpoint.mutation || endpoint.requiresAuth || endpoint.kind === 'saveReward');
  if (protectedScenario) {
    const playerName = String(scenario.playerName ?? '').trim();
    const token = String(scenario.playerToken ?? '').trim();
    if (scenario.disposable !== true) {
      throw new Error('save/reward, authenticated, and mutating endpoints require LOAD_DISPOSABLE_SCENARIO=1');
    }
    if (!playerName || !token) throw new Error('disposable scenarios require LOAD_PLAYER_NAME and LOAD_PLAYER_TOKEN');
    if (scenario.mutationConfirmation !== `DISPOSABLE:${playerName}`) {
      throw new Error(`disposable scenarios require LOAD_MUTATION_CONFIRM=DISPOSABLE:${playerName}`);
    }
  }
  return endpoints;
}
