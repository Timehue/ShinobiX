#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { io } from 'socket.io-client';
import {
  assertRestarted,
  durableSaveFingerprint,
  loadStagingResilienceConfig,
} from './staging-resilience-core.mjs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(check, timeoutMs, detail, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  throw new Error(`${detail}${lastError instanceof Error ? `: ${lastError.message}` : ''}`);
}

function eventOnce(socket, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`timed out waiting for Socket.IO ${event}`));
    }, timeoutMs);
    const onEvent = (payload) => {
      clearTimeout(timeout);
      socket.off(event, onEvent);
      resolve(payload);
    };
    socket.on(event, onEvent);
  });
}

async function fetchJson(config, path, options = {}) {
  const url = new URL(path, config.target);
  if (url.origin !== config.target.origin) throw new Error(`request escaped the confirmed target: ${path}`);
  const response = await fetch(url, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(Math.min(config.timeoutMs, 30_000)),
    headers: {
      accept: 'application/json',
      'user-agent': 'ShinobiX-Staging-Resilience/1',
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, body };
}

async function health(config) {
  const response = await fetchJson(config, '/health');
  if (!response.ok || response.body?.ok !== true) throw new Error(`health returned HTTP ${response.status}`);
  return response.body;
}

async function deepHealth(config) {
  const response = await fetchJson(config, '/health/db', {
    headers: { 'x-health-token': config.healthToken },
  });
  if (!response.ok || response.body?.ok !== true) throw new Error(`deep health returned HTTP ${response.status}`);
  const failed = Object.entries(response.body?.checks ?? {}).filter(([, passed]) => passed !== true).map(([name]) => name);
  if (failed.length) throw new Error(`deep health failed checks: ${failed.join(', ')}`);
  return {
    latencyMs: Number(response.body.latencyMs ?? 0),
    saveStore: String(response.body.saveStore ?? 'unknown'),
    backupFresh: response.body.backup?.fresh === true,
    checks: Object.keys(response.body.checks ?? {}).sort(),
  };
}

async function readOwnSave(config, account) {
  const response = await fetchJson(config, `/api/save/${encodeURIComponent(account.name)}`, {
    headers: {
      'x-player-name': account.name,
      'x-player-token': account.token,
    },
  });
  if (!response.ok) throw new Error(`authenticated save read returned HTTP ${response.status}`);
  if (String(response.body?.character?.name ?? '').trim().toLowerCase() !== account.name) {
    throw new Error('authenticated save returned the wrong player identity');
  }
  if (Number(response.body?.currentSector ?? 0) !== config.sector) {
    throw new Error(`disposable account is not idle in required sector ${config.sector}`);
  }
  return response.body;
}

function socketAuth(config, account, label, includePresence) {
  return {
    'x-player-name': account.name,
    'x-player-token': account.token,
    'x-client-fp': `resilience-${label}`,
    ...(includePresence ? {
      presence: {
        sector: config.sector,
        displayName: account.name,
        character: { name: account.name, level: 1 },
        tile: 60,
      },
    } : {}),
  };
}

function createSocket(config, account, label) {
  const socket = io(config.target.origin, {
    autoConnect: false,
    forceNew: true,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 250,
    reconnectionDelayMax: 2_000,
    timeout: 15_000,
    auth: socketAuth(config, account, label, true),
  });
  const errors = [];
  const disconnects = [];
  socket.on('connect_error', (error) => errors.push(String(error?.message ?? error).slice(0, 160)));
  socket.on('disconnect', (reason) => disconnects.push(String(reason).slice(0, 80)));
  return { socket, account, label, errors, disconnects };
}

async function connect(entry, timeoutMs) {
  const connected = eventOnce(entry.socket, 'connect', timeoutMs);
  const snapshot = eventOnce(entry.socket, 'presence:sector', timeoutMs);
  entry.socket.connect();
  await connected;
  await snapshot;
}

async function rosterNames(entry, sector, timeoutMs) {
  const snapshot = eventOnce(entry.socket, 'presence:sector', timeoutMs);
  entry.socket.emit('presence:request', { sector });
  const payload = await snapshot;
  return (payload?.players ?? []).map((player) => String(player?.name ?? player?.displayName ?? '').trim().toLowerCase());
}

async function assertCrossVisible(entries, config, detail) {
  const expected = entries.map((entry) => entry.account.name).sort();
  await waitUntil(async () => {
    if (!entries.every((entry) => entry.socket.connected)) return false;
    const snapshots = await Promise.all(entries.map((entry) => rosterNames(entry, config.sector, 5_000)));
    return snapshots.every((names) => expected.every((name) => names.includes(name)));
  }, config.timeoutMs, detail, 350);
}

async function forceTransportReconnect(entry, config) {
  const started = performance.now();
  const disconnected = eventOnce(entry.socket, 'disconnect', 15_000);
  const connected = eventOnce(entry.socket, 'connect', config.timeoutMs);
  entry.socket.io.engine?.close();
  await disconnected;
  await connected;
  return performance.now() - started;
}

async function run(config) {
  const startedAt = new Date().toISOString();
  const beforeHealth = await health(config);
  const beforeDeep = await deepHealth(config);
  const beforeSaves = await Promise.all(config.players.map((account) => readOwnSave(config, account)));
  const beforeFingerprints = beforeSaves.map(durableSaveFingerprint);
  const beforeVersions = beforeSaves.map((save) => Number(save?._saveVersion ?? 0));
  if (beforeVersions.some((version) => version <= 0)) throw new Error('disposable saves must have positive optimistic-concurrency versions');

  const entries = config.players.map((account, index) => createSocket(config, account, config.playerLabels[index]));
  let reconnectMs = null;
  let afterHealth = beforeHealth;
  let afterDeep = beforeDeep;
  let presenceSnapshotRecovered = false;
  let restartConnectionErrors = 0;
  try {
    await Promise.all(entries.map((entry) => connect(entry, config.timeoutMs)));
    await assertCrossVisible(entries, config, 'both disposable accounts never became cross-visible');

    reconnectMs = await forceTransportReconnect(entries[0], config);
    await assertCrossVisible(entries, config, 'cross-visible presence did not recover after a transport interruption');
    const preRestartConnectionErrors = entries.reduce((sum, entry) => sum + entry.errors.length, 0);
    if (preRestartConnectionErrors > 0) {
      throw new Error(`Socket.IO connection errors were observed before restart (${preRestartConnectionErrors})`);
    }

    if (config.runRestart) {
      // Remove the ordinary handshake-presence payload before the operator
      // restart. Cross-visibility after the new worker boots must therefore
      // come from the persisted presence snapshot, not an eager client beat.
      entries.forEach((entry, index) => {
        entry.socket.auth = socketAuth(config, entry.account, config.playerLabels[index], false);
      });
      const disconnectBaselines = entries.map((entry) => entry.disconnects.length);
      const restart = await fetchJson(config, '/api/restart', {
        method: 'POST',
        headers: { 'x-restart-token': config.restartToken },
      });
      if (!restart.ok || restart.body?.restarting !== true) {
        throw new Error(`restart endpoint returned HTTP ${restart.status}`);
      }

      afterHealth = await waitUntil(async () => {
        const candidate = await health(config);
        return candidate.startedAt && candidate.startedAt !== beforeHealth.startedAt ? candidate : false;
      }, config.timeoutMs, 'a replacement worker was not observed', 500);
      assertRestarted(beforeHealth, afterHealth);
      await waitUntil(
        () => entries.every((entry, index) => entry.disconnects.length > disconnectBaselines[index] && entry.socket.connected),
        config.timeoutMs,
        'both sockets did not disconnect and reconnect to the replacement worker',
      );
      await assertCrossVisible(entries, config, 'persisted presence snapshot did not restore both accounts');
      presenceSnapshotRecovered = true;
      restartConnectionErrors = entries.reduce((sum, entry) => sum + entry.errors.length, 0)
        - preRestartConnectionErrors;

      // Resume ordinary heartbeats only after the snapshot assertion.
      entries.forEach((entry) => {
        entry.socket.emit('presence', {
          sector: config.sector,
          displayName: entry.account.name,
          character: { name: entry.account.name, level: 1 },
          tile: 60,
        });
      });
      afterDeep = await deepHealth(config);
    }

    const afterSaves = await Promise.all(config.players.map((account) => readOwnSave(config, account)));
    const afterFingerprints = afterSaves.map(durableSaveFingerprint);
    const afterVersions = afterSaves.map((save) => Number(save?._saveVersion ?? 0));
    if (JSON.stringify(afterFingerprints) !== JSON.stringify(beforeFingerprints)) {
      throw new Error('durable save fingerprint changed during the resilience drill');
    }
    if (JSON.stringify(afterVersions) !== JSON.stringify(beforeVersions)) {
      throw new Error('save version changed during the resilience drill');
    }
    return {
      schemaVersion: 'shinobix.staging-resilience.v1',
      passed: true,
      targetOrigin: config.target.origin,
      targetFingerprint: config.targetFingerprint,
      startedAt,
      finishedAt: new Date().toISOString(),
      disposablePlayerLabels: config.playerLabels,
      sector: config.sector,
      checks: {
        plainHealth: true,
        deepStorageHealth: true,
        authenticatedSaveReads: 2,
        independentRealtimeConnections: 2,
        crossVisiblePresence: true,
        transportReconnect: true,
        transportReconnectMs: Math.round(reconnectMs),
        workerRestart: config.runRestart,
        workerStartedAtChanged: config.runRestart,
        restartWindowConnectionErrors: restartConnectionErrors,
        presenceSnapshotRecovered,
        durableSaveFingerprintsStable: true,
        saveVersionsStable: true,
      },
      health: {
        commit: String(afterHealth.commit ?? 'unknown'),
        beforeStartedAt: beforeHealth.startedAt ?? null,
        afterStartedAt: afterHealth.startedAt ?? null,
        saveStore: afterDeep.saveStore,
        backupFresh: afterDeep.backupFresh,
        deepChecks: afterDeep.checks,
      },
      scope: config.runRestart
        ? 'credentialed staging realtime + process restart + persistent storage observation'
        : 'credentialed staging realtime + storage health; process restart intentionally skipped',
    };
  } finally {
    for (const entry of entries) {
      entry.socket.removeAllListeners();
      entry.socket.io.removeAllListeners();
      entry.socket.disconnect();
    }
  }
}

let config;
try {
  config = loadStagingResilienceConfig();
} catch (error) {
  console.error(`staging-resilience: unsafe or invalid configuration: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}

if (config) {
  run(config).then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => {
    console.error(`staging-resilience: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
