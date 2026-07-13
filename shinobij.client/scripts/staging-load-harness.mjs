#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { io } from 'socket.io-client';
import {
  evaluateReleaseThresholds,
  memoryGrowthPercent,
  parseBoundedInteger,
  parseEndpointMix,
  percentile,
  validateLoadTarget,
} from './staging-load-core.mjs';

const env = process.env;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class BoundedSamples {
  constructor(limit) {
    this.limit = limit;
    this.seen = 0;
    this.values = [];
  }

  add(value) {
    if (!Number.isFinite(value)) return;
    this.seen += 1;
    if (this.values.length < this.limit) {
      this.values.push(value);
      return;
    }
    // Uniform reservoir sampling keeps hour-long runs bounded without only
    // representing their beginning or end.
    const replacement = Math.floor(Math.random() * this.seen);
    if (replacement < this.limit) this.values[replacement] = value;
  }
}

function disposableScenario() {
  return {
    disposable: env.LOAD_DISPOSABLE_SCENARIO === '1',
    playerName: String(env.LOAD_PLAYER_NAME ?? '').trim(),
    playerToken: String(env.LOAD_PLAYER_TOKEN ?? '').trim(),
    mutationConfirmation: String(env.LOAD_MUTATION_CONFIRM ?? ''),
  };
}

function requireDisposableSocketScenario(scenario) {
  if (!scenario.disposable) throw new Error('Socket.IO load requires LOAD_DISPOSABLE_SCENARIO=1');
  if (!scenario.playerName || !scenario.playerToken) {
    throw new Error('Socket.IO load requires LOAD_PLAYER_NAME and LOAD_PLAYER_TOKEN');
  }
  if (scenario.mutationConfirmation !== `DISPOSABLE:${scenario.playerName}`) {
    throw new Error(`Socket.IO load requires LOAD_MUTATION_CONFIRM=DISPOSABLE:${scenario.playerName}`);
  }
}

function loadConfig() {
  const rawTarget = process.argv[2] || env.LOAD_TARGET_URL;
  if (!rawTarget) throw new Error('Set LOAD_TARGET_URL or pass the staging origin as the first argument');
  const deniedHosts = [
    ...(env.LOAD_DENY_HOSTS ?? '').split(','),
    env.PRODUCTION_HOST,
    env.PUBLIC_HOST,
    env.CANONICAL_HOST,
    env.CANONICAL_ORIGIN,
  ].filter(Boolean);
  const target = validateLoadTarget(rawTarget, {
    confirmedHost: env.LOAD_CONFIRM_TARGET_HOST,
    deniedHosts,
  });
  const scenario = disposableScenario();
  const endpoints = parseEndpointMix(env.LOAD_ENDPOINTS_JSON, scenario);
  const config = {
    target,
    scenario,
    endpoints,
    durationSeconds: parseBoundedInteger(env.LOAD_DURATION_SECONDS, {
      name: 'LOAD_DURATION_SECONDS', defaultValue: 300, min: 10, max: 3_600,
    }),
    concurrency: parseBoundedInteger(env.LOAD_CONCURRENCY, {
      name: 'LOAD_CONCURRENCY', defaultValue: 5, min: 1, max: 500,
    }),
    requestsPerSecond: parseBoundedInteger(env.LOAD_RPS, {
      name: 'LOAD_RPS', defaultValue: 10, min: 1, max: 2_000,
    }),
    requestTimeoutMs: parseBoundedInteger(env.LOAD_REQUEST_TIMEOUT_MS, {
      name: 'LOAD_REQUEST_TIMEOUT_MS', defaultValue: 10_000, min: 250, max: 60_000,
    }),
    sampleLimit: parseBoundedInteger(env.LOAD_SAMPLE_LIMIT, {
      name: 'LOAD_SAMPLE_LIMIT', defaultValue: 50_000, min: 1_000, max: 100_000,
    }),
    maxResponseBytes: parseBoundedInteger(env.LOAD_MAX_RESPONSE_BYTES, {
      name: 'LOAD_MAX_RESPONSE_BYTES', defaultValue: 1_048_576, min: 1_024, max: 8_388_608,
    }),
    socketClients: parseBoundedInteger(env.LOAD_SOCKET_CLIENTS, {
      name: 'LOAD_SOCKET_CLIENTS', defaultValue: 0, min: 0, max: 200,
    }),
    socketSector: parseBoundedInteger(env.LOAD_SOCKET_SECTOR, {
      name: 'LOAD_SOCKET_SECTOR', defaultValue: 40, min: 0, max: 10_000,
    }),
    socketConnectTimeoutSeconds: parseBoundedInteger(env.LOAD_SOCKET_CONNECT_TIMEOUT_SECONDS, {
      name: 'LOAD_SOCKET_CONNECT_TIMEOUT_SECONDS', defaultValue: 20, min: 2, max: 60,
    }),
    socketReconnectSeconds: parseBoundedInteger(env.LOAD_SOCKET_RECONNECT_SECONDS, {
      name: 'LOAD_SOCKET_RECONNECT_SECONDS', defaultValue: 30, min: 5, max: 300,
    }),
  };
  if (config.socketClients > 0) requireDisposableSocketScenario(scenario);
  return config;
}

async function consumeBounded(response, maxBytes) {
  if (!response.body) return 0;
  const reader = response.body.getReader();
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return bytes;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error(`response exceeded ${maxBytes} bytes`);
    }
  } finally {
    if (bytes > maxBytes) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function endpointUrl(target, path) {
  const url = new URL(path, target);
  if (url.origin !== target.origin) throw new Error(`endpoint escapes target origin: ${path}`);
  return url;
}

function makeMeasurements(config) {
  const endpoint = Object.fromEntries(config.endpoints.map((item) => [item.name, {
    requestCount: 0,
    serverErrorCount: 0,
    requestErrorCount: 0,
    unexpectedStatusCount: 0,
    statuses: {},
    latency: new BoundedSamples(config.sampleLimit),
  }]));
  return {
    requestCount: 0,
    serverErrorCount: 0,
    requestErrorCount: 0,
    unexpectedStatusCount: 0,
    normalLatency: new BoundedSamples(config.sampleLimit),
    saveRewardLatency: new BoundedSamples(config.sampleLimit),
    endpoint,
    socket: {
      requested: config.socketClients,
      initialConnectedIds: new Set(),
      snapshotClientIds: new Set(),
      connectionErrors: 0,
      reconnectAttempts: 0,
      reconnectSuccesses: 0,
      reconnectLatency: new BoundedSamples(config.sampleLimit),
      pendingReconnects: new Map(),
      orphanCount: 0,
    },
  };
}

async function issueRequest(config, measurements, endpoint) {
  const started = performance.now();
  const endpointStats = measurements.endpoint[endpoint.name];
  measurements.requestCount += 1;
  endpointStats.requestCount += 1;
  const headers = {
    accept: 'application/json',
    'user-agent': 'ShinobiX-Staging-Load-Harness/1',
  };
  if (endpoint.mutation || endpoint.requiresAuth || endpoint.kind === 'saveReward') {
    headers['x-player-name'] = config.scenario.playerName;
    headers['x-player-token'] = config.scenario.playerToken;
  }
  const options = {
    method: endpoint.method,
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  };
  if (endpoint.mutation) {
    headers['content-type'] = 'application/json';
    options.body = typeof endpoint.body === 'string' ? endpoint.body : JSON.stringify(endpoint.body);
  }

  try {
    const response = await fetch(endpointUrl(config.target, endpoint.path), options);
    await consumeBounded(response, config.maxResponseBytes);
    const statusKey = String(response.status);
    endpointStats.statuses[statusKey] = (endpointStats.statuses[statusKey] ?? 0) + 1;
    if (response.status >= 500) {
      measurements.serverErrorCount += 1;
      endpointStats.serverErrorCount += 1;
    } else if (response.status >= 400) {
      measurements.unexpectedStatusCount += 1;
      endpointStats.unexpectedStatusCount += 1;
    }
  } catch {
    measurements.requestErrorCount += 1;
    endpointStats.requestErrorCount += 1;
  } finally {
    const elapsed = performance.now() - started;
    endpointStats.latency.add(elapsed);
    if (endpoint.kind === 'saveReward') measurements.saveRewardLatency.add(elapsed);
    else measurements.normalLatency.add(elapsed);
  }
}

async function verifyTarget(config) {
  const response = await fetch(endpointUrl(config.target, '/health'), {
    headers: { accept: 'application/json', 'user-agent': 'ShinobiX-Staging-Load-Harness/1' },
    redirect: 'error',
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  await consumeBounded(response, config.maxResponseBytes);
  if (!response.ok) throw new Error(`staging preflight /health returned HTTP ${response.status}`);
}

function createSocketClients(config, measurements) {
  const sockets = [];
  const presence = {
    sector: config.socketSector,
    character: null,
    displayName: config.scenario.playerName,
  };
  for (let id = 0; id < config.socketClients; id += 1) {
    const socket = io(config.target.origin, {
      autoConnect: false,
      forceNew: true,
      reconnection: true,
      reconnectionDelay: 250,
      reconnectionDelayMax: 2_000,
      timeout: config.socketConnectTimeoutSeconds * 1_000,
      auth: {
        'x-player-name': config.scenario.playerName,
        'x-player-token': config.scenario.playerToken,
        'x-client-fp': `staging-load-${id}`,
        presence,
      },
    });
    socket.on('connect', () => {
      measurements.socket.initialConnectedIds.add(id);
      const pendingAt = measurements.socket.pendingReconnects.get(id);
      if (pendingAt !== undefined) {
        measurements.socket.pendingReconnects.delete(id);
        measurements.socket.reconnectSuccesses += 1;
        measurements.socket.reconnectLatency.add(performance.now() - pendingAt);
      }
      socket.emit('presence', presence);
      socket.emit('presence:request', { sector: config.socketSector });
    });
    socket.on('presence:sector', () => measurements.socket.snapshotClientIds.add(id));
    socket.on('connect_error', () => { measurements.socket.connectionErrors += 1; });
    sockets.push({ id, socket });
  }
  return sockets;
}

async function connectSocketClients(sockets, timeoutMs) {
  await Promise.all(sockets.map(({ socket }) => new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off('connect', finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    socket.on('connect', finish);
    socket.connect();
  })));
}

function forceSocketReconnect(sockets, measurements) {
  for (const { id, socket } of sockets) {
    if (!socket.connected || measurements.socket.pendingReconnects.has(id)) continue;
    measurements.socket.reconnectAttempts += 1;
    measurements.socket.pendingReconnects.set(id, performance.now());
    // Closing the transport emulates a network interruption while leaving the
    // Socket.IO manager's automatic reconnection enabled.
    socket.io.engine?.close();
  }
}

async function settlePendingReconnects(measurements, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (measurements.socket.pendingReconnects.size > 0 && Date.now() < deadline) await delay(100);
}

async function closeSocketClients(sockets, measurements) {
  for (const { socket } of sockets) {
    socket.removeAllListeners();
    socket.io.removeAllListeners();
    socket.disconnect();
  }
  await delay(250);
  measurements.socket.orphanCount = sockets.filter(({ socket }) => socket.connected).length;
}

function endpointSummary(measurements) {
  return Object.fromEntries(Object.entries(measurements.endpoint).map(([name, stats]) => [name, {
    requestCount: stats.requestCount,
    serverErrorCount: stats.serverErrorCount,
    requestErrorCount: stats.requestErrorCount,
    unexpectedStatusCount: stats.unexpectedStatusCount,
    statuses: stats.statuses,
    p95Ms: percentile(stats.latency.values, 0.95),
    retainedLatencySamples: stats.latency.values.length,
    observedLatencySamples: stats.latency.seen,
  }]));
}

async function run() {
  const config = loadConfig();
  const measurements = makeMeasurements(config);
  const endpointWheel = config.endpoints.flatMap((endpoint) => Array(endpoint.weight).fill(endpoint));
  const startedAt = new Date().toISOString();
  let nextEndpoint = 0;
  let stopRequested = false;
  process.once('SIGINT', () => { stopRequested = true; });
  process.once('SIGTERM', () => { stopRequested = true; });

  console.error(`[load] preflight ${config.target.origin} (remote targets require exact confirmation; production denylist enforced)`);
  await verifyTarget(config);

  const sockets = createSocketClients(config, measurements);
  if (sockets.length > 0) {
    console.error(`[load] connecting ${sockets.length} disposable Socket.IO clients`);
    await connectSocketClients(sockets, config.socketConnectTimeoutSeconds * 1_000);
  }

  if (typeof global.gc === 'function') global.gc();
  await delay(50);
  const memoryStart = process.memoryUsage();
  let peakRssBytes = memoryStart.rss;
  const memoryTimer = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }, 1_000);

  const durationMs = config.durationSeconds * 1_000;
  const deadline = Date.now() + durationMs;
  const reconnectCycleMs = Math.min(
    config.socketReconnectSeconds * 1_000,
    Math.max(2_000, Math.floor(durationMs / 2)),
  );
  const reconnectTimer = sockets.length > 0
    ? setInterval(() => forceSocketReconnect(sockets, measurements), reconnectCycleMs)
    : null;
  const progressTimer = setInterval(() => {
    console.error(`[load] progress requests=${measurements.requestCount} 5xx=${measurements.serverErrorCount} errors=${measurements.requestErrorCount}`);
  }, 30_000);

  const perWorkerSpacingMs = (config.concurrency / config.requestsPerSecond) * 1_000;
  console.error(`[load] running ${config.durationSeconds}s at <=${config.requestsPerSecond} req/s with ${config.concurrency} workers`);
  const workers = Array.from({ length: config.concurrency }, async () => {
    while (!stopRequested && Date.now() < deadline) {
      const cycleStarted = performance.now();
      const endpoint = endpointWheel[nextEndpoint % endpointWheel.length];
      nextEndpoint += 1;
      await issueRequest(config, measurements, endpoint);
      const remainingSpacing = perWorkerSpacingMs - (performance.now() - cycleStarted);
      if (remainingSpacing > 0) await delay(Math.min(remainingSpacing, Math.max(0, deadline - Date.now())));
    }
  });
  await Promise.all(workers);
  clearInterval(progressTimer);
  if (reconnectTimer) clearInterval(reconnectTimer);
  await settlePendingReconnects(measurements, config.socketConnectTimeoutSeconds * 1_000);
  await closeSocketClients(sockets, measurements);
  clearInterval(memoryTimer);

  if (typeof global.gc === 'function') global.gc();
  await delay(100);
  const memoryEnd = process.memoryUsage();
  peakRssBytes = Math.max(peakRssBytes, memoryEnd.rss);
  const growthPercent = memoryGrowthPercent(memoryStart.rss, memoryEnd.rss);
  const socketMeasurement = {
    requested: config.socketClients,
    initialConnected: measurements.socket.initialConnectedIds.size,
    snapshotClients: measurements.socket.snapshotClientIds.size,
    connectionErrors: measurements.socket.connectionErrors,
    reconnectAttempts: measurements.socket.reconnectAttempts,
    reconnectSuccesses: measurements.socket.reconnectSuccesses,
    reconnectP95Ms: percentile(measurements.socket.reconnectLatency.values, 0.95),
    orphanCount: measurements.socket.orphanCount,
    serverPresenceOrphans: {
      observable: false,
      reason: 'Public staging APIs do not expose the internal presence-store size; verify expiry in server telemetry.',
    },
  };
  const gate = evaluateReleaseThresholds({
    requestCount: measurements.requestCount,
    serverErrorCount: measurements.serverErrorCount,
    requestErrorCount: measurements.requestErrorCount,
    unexpectedStatusCount: measurements.unexpectedStatusCount,
    normalLatenciesMs: measurements.normalLatency.values,
    saveRewardLatenciesMs: measurements.saveRewardLatency.values,
    memoryGrowthPercent: growthPercent,
    socket: socketMeasurement,
  });
  const finishedAt = new Date().toISOString();
  const result = {
    schemaVersion: 'shinobix.staging-load.v1',
    passed: gate.passed,
    targetOrigin: config.target.origin,
    startedAt,
    finishedAt,
    configuredDurationSeconds: config.durationSeconds,
    actualDurationSeconds: (Date.parse(finishedAt) - Date.parse(startedAt)) / 1_000,
    stoppedBySignal: stopRequested,
    config: {
      concurrency: config.concurrency,
      requestsPerSecond: config.requestsPerSecond,
      requestTimeoutMs: config.requestTimeoutMs,
      socketClients: config.socketClients,
      endpoints: config.endpoints.map(({ name, method, path, kind, weight }) => ({ name, method, path, kind, weight })),
      credentialsIncluded: config.endpoints.some((item) => item.mutation || item.requiresAuth || item.kind === 'saveReward') || config.socketClients > 0,
    },
    http: {
      requestCount: measurements.requestCount,
      serverErrorCount: measurements.serverErrorCount,
      requestErrorCount: measurements.requestErrorCount,
      unexpectedStatusCount: measurements.unexpectedStatusCount,
      retainedNormalLatencySamples: measurements.normalLatency.values.length,
      observedNormalLatencySamples: measurements.normalLatency.seen,
      retainedSaveRewardLatencySamples: measurements.saveRewardLatency.values.length,
      observedSaveRewardLatencySamples: measurements.saveRewardLatency.seen,
      endpoints: endpointSummary(measurements),
    },
    socket: socketMeasurement,
    memory: {
      scope: 'load-generator-steady-state',
      gcExposed: typeof global.gc === 'function',
      startRssBytes: memoryStart.rss,
      endRssBytes: memoryEnd.rss,
      peakRssBytes,
      growthPercent,
      startHeapUsedBytes: memoryStart.heapUsed,
      endHeapUsedBytes: memoryEnd.heapUsed,
      note: 'Release approval must also confirm server/container memory growth in Railway metrics.',
    },
    releaseGate: gate,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.passed ? 0 : 1;
}

run().catch((error) => {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 'shinobix.staging-load.v1',
    passed: false,
    configurationError: true,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2)}\n`);
  process.exitCode = 2;
});
