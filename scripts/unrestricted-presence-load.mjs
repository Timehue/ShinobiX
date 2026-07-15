import { writeFile } from 'node:fs/promises';
import { io } from 'socket.io-client';
import {
    assertLoadSafety,
    MAX_LOAD_DURATION_SECONDS,
    parseArgs,
    readAccountManifest,
    summarizeLatencies,
    validateRunOptions,
} from './unrestricted-load-lib.mjs';

const options = validateRunOptions(parseArgs(process.argv.slice(2)));
const safety = assertLoadSafety(options);
const accounts = await readAccountManifest(options.accountsFile, options.clients);
const startedAt = new Date();
const connectLatencies = [];
const reconnectLatencies = [];
const errors = [];
let sectorSnapshots = 0;
let maxSnapshotPlayers = 0;
let presenceEmits = 0;
let reconnectSuccesses = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sockets = accounts.map((account, index) => {
    const presence = {
        displayName: account.name,
        sector: options.sector,
        tile: index,
        character: { name: account.name, level: 1, rank: 'Academy Student' },
    };
    const socket = io(safety.url.origin, {
        autoConnect: false,
        reconnection: true,
        reconnectionDelay: 250,
        reconnectionDelayMax: 2_000,
        timeout: 10_000,
        auth: {
            'x-player-name': account.name,
            'x-player-token': account.token,
            presence,
        },
    });
    socket.on('presence:sector', (payload) => {
        sectorSnapshots += 1;
        const count = Array.isArray(payload?.players) ? payload.players.length : 0;
        maxSnapshotPlayers = Math.max(maxSnapshotPlayers, count);
    });
    socket.on('connect_error', (error) => errors.push(`connect_error:${error?.message ?? 'unknown'}`));
    socket.on('error', (error) => errors.push(`socket_error:${error?.message ?? String(error)}`));
    return { account, presence, socket };
});

function connectOne(entry, latencyTarget) {
    return new Promise((resolve, reject) => {
        const before = Date.now();
        const timer = setTimeout(() => reject(new Error('Socket connect timed out.')), 12_000);
        entry.socket.once('connect', () => {
            clearTimeout(timer);
            latencyTarget.push(Date.now() - before);
            entry.socket.emit('presence:request', { sector: options.sector });
            resolve();
        });
        entry.socket.connect();
    });
}

async function disconnectAll() {
    for (const entry of sockets) entry.socket.disconnect();
    await sleep(50);
}

let emitTimer;
try {
    await Promise.all(sockets.map((entry) => connectOne(entry, connectLatencies)));
    emitTimer = setInterval(() => {
        for (const entry of sockets) {
            entry.socket.emit('presence', entry.presence);
            presenceEmits += 1;
        }
    }, options.emitMs);

    const reconnectCount = Math.ceil(sockets.length * options.reconnectFraction);
    const firstWindowMs = Math.max(2_000, Math.floor(options.durationSeconds * 500));
    await sleep(firstWindowMs);
    const reconnecting = sockets.slice(0, reconnectCount);
    for (const entry of reconnecting) entry.socket.disconnect();
    await sleep(250);
    const reconnectResults = await Promise.allSettled(reconnecting.map((entry) => connectOne(entry, reconnectLatencies)));
    reconnectSuccesses = reconnectResults.filter((result) => result.status === 'fulfilled').length;
    for (const result of reconnectResults) {
        if (result.status === 'rejected') errors.push(`reconnect:${result.reason?.message ?? String(result.reason)}`);
    }
    const remainingMs = Math.min(
        MAX_LOAD_DURATION_SECONDS * 1_000,
        Math.max(0, options.durationSeconds * 1_000 - firstWindowMs),
    );
    await sleep(remainingMs);

    const completedAt = new Date();
    const evidence = {
        format: 'shinobix-presence-load-v1',
        ok: errors.length === 0
            && connectLatencies.length === sockets.length
            && reconnectSuccesses === reconnectCount
            && sectorSnapshots >= sockets.length,
        target: { origin: safety.url.origin, production: safety.production },
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
        clients: sockets.length,
        reconnectAttempts: reconnectCount,
        reconnectSuccesses,
        presenceEmits,
        sectorSnapshots,
        maxSnapshotPlayers,
        connectLatencyMs: summarizeLatencies(connectLatencies),
        reconnectLatencyMs: summarizeLatencies(reconnectLatencies),
        errorCount: errors.length,
        errors: errors.slice(0, 20),
    };
    if (options.evidenceOut) await writeFile(options.evidenceOut, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(evidence));
    if (!evidence.ok) process.exitCode = 1;
} finally {
    if (emitTimer) clearInterval(emitTimer);
    await disconnectAll();
}
