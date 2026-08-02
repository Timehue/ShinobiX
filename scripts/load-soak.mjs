/*
 * Concurrent-player load soak (launch capacity).
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * ShinobiX is deliberately a SINGLE-INSTANCE server: presence lives in process
 * memory (api/_realtime/online-store.ts) and Socket.IO has no cross-process
 * adapter, so railway.json pins numReplicas:1 and scripts/check-deployment-
 * config.mjs fails CI if that changes. Capacity therefore cannot be bought with
 * replicas — it has to come from one container. This answers, with numbers,
 * "how many concurrent players does one container actually carry?"
 *
 *   npm run soak                          # 100 players, 60s, local server
 *   npm run soak -- --players=500 --seconds=120
 *   npm run soak -- --url=https://staging.example --players=300
 *
 * ── Read the results honestly ───────────────────────────────────────────────
 * Against a LOCAL server this uses the in-memory storage backend, so it
 * measures the Node event loop, the handler code, auth CPU, and lock
 * contention — NOT Postgres. That is genuinely useful (the scrypt password
 * path is ~100ms of BLOCKING single-threaded work, and lock contention is
 * storage-independent), but the database is the other half of the picture.
 * Run it with --url against staging for the full-stack answer.
 *
 * The load generator shares a CPU with the server on a local run, so local
 * numbers are pessimistic. Treat them as a floor.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const numArg = (name, fallback) => {
    const raw = argv.find((a) => a.startsWith(`--${name}=`));
    return raw ? Number(raw.slice(name.length + 3)) : fallback;
};
const EXTERNAL_URL = argv.find((a) => a.startsWith('--url='))?.slice('--url='.length) ?? '';
const PLAYERS = numArg('players', 100);
const SECONDS = numArg('seconds', 60);
const RAMP_SECONDS = numArg('ramp', Math.min(30, Math.max(5, Math.round(PLAYERS / 20))));
const PORT = numArg('port', 41_988);
// How many distinct sectors the population occupies (1 = worst-case hub crush).
const SECTORS = numArg('sectors', 40);
const BASE = EXTERNAL_URL || `http://127.0.0.1:${PORT}`;

// A real client autosaves on a debounce and the server enforces one save per
// 3s per player (save-burst). Heartbeats are much more frequent. These mirror
// the live client's cadence so the mix is representative rather than a
// synthetic hammer.
const SAVE_INTERVAL_MS = 3_500;
const HEARTBEAT_INTERVAL_MS = 5_000;
const READ_INTERVAL_MS = 11_000;

const stats = new Map();

function record(label, ms, ok, status) {
    let s = stats.get(label);
    if (!s) { s = { label, n: 0, errors: 0, samples: [], statuses: new Map() }; stats.set(label, s); }
    s.n += 1;
    if (!ok) s.errors += 1;
    if (status !== undefined) s.statuses.set(status, (s.statuses.get(status) ?? 0) + 1);
    // Reservoir-free: keep every sample but cap memory on very long runs.
    if (s.samples.length < 50_000) s.samples.push(ms);
}

function percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
}

async function timed(label, fn) {
    const started = performance.now();
    let ok = false;
    let status;
    try {
        const res = await fn();
        ok = res.ok;
        status = res.status;
        return res;
    } finally {
        record(label, performance.now() - started, ok, status);
    }
}

async function api(path, { method = 'GET', body, token, asName, ip } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['x-player-token'] = token;
    if (asName) headers['x-player-name'] = asName;
    // Each virtual player carries its own source address. Registration is
    // limited to 25 per IP per 15 minutes (api/player-auth.ts) — a deliberate
    // anti-abuse rule sized for households behind one NAT. 500 REAL players
    // arrive from 500 addresses, so a load generator that sent them all from
    // one IP would be measuring the abuse limiter instead of the game. Behind
    // Cloudflare production trusts CF-Connecting-IP (validated against CF
    // ranges); locally clientIp() falls back to X-Forwarded-For, so this
    // represents reality rather than bypassing anything.
    if (ip) headers['x-forwarded-for'] = ip;
    const res = await fetch(`${BASE}${path}`, {
        method, headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch { /* empty */ }
    // 409 (version conflict) and 429 (burst limit) are DESIGNED responses under
    // concurrency, not failures — counting them as errors would misreport a
    // healthy server as broken.
    const ok = res.status < 400 || res.status === 409 || res.status === 429;
    return { ok, status: res.status, body: json ?? {} };
}

const STARTER_STATS = {
    strength: 10, speed: 10, intelligence: 10, willpower: 10,
    bukijutsuOffense: 10, bukijutsuDefense: 10, taijutsuOffense: 10, taijutsuDefense: 10,
    genjutsuOffense: 10, genjutsuDefense: 10, ninjutsuOffense: 10, ninjutsuDefense: 10,
};

function character(name) {
    return {
        name, village: 'Ember', specialty: 'Ninjutsu', bloodline: 'None',
        level: 1, ryo: 100, stats: { ...STARTER_STATS }, unspentStats: 20,
        hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        inventory: ['rustfang-kunai'], itemStacks: [], equipment: {},
        pets: [], jutsuMastery: [], equippedJutsuIds: [],
    };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 * SETUP (not measured): create the account.
 *
 * Every virtual player shares this machine's IP, so account creation trips the
 * per-IP registration limit — an artifact of load-testing from one host, not a
 * production condition (500 real players arrive from 500 addresses). Setup
 * therefore retries through 429s and is reported separately, so the soak
 * measures STEADY-STATE play rather than a synthetic signup stampede.
 */
function syntheticIp(index) {
    return `10.${(index >> 16) & 0xff}.${(index >> 8) & 0xff}.${(index % 254) + 1}`;
}

async function provisionPlayer(index) {
    const name = `soak${randomBytes(3).toString('hex')}${index}`;
    // Spread players across sectors. Presence lookups are sector-scoped
    // (onlineStore.listSector), so parking every virtual player in ONE sector
    // measures a worst-case hub crush rather than normal play. Use --sectors=1
    // deliberately to measure that hub case.
    const sector = SECTORS <= 1 ? 12 : 1 + (index % SECTORS);
    const password = `Soak-${randomBytes(6).toString('hex')}A1!`;
    const ip = syntheticIp(index);
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const reg = await api('/api/player-auth', { method: 'POST', body: { action: 'register', name, password }, ip });
        if (reg.status === 200 && reg.body.token) {
            const created = await api(`/api/save/${name}`, {
                method: 'POST', token: reg.body.token, ip,
                body: { character: character(name), _baseSaveVersion: 0 },
            });
            if (created.status !== 200) { await sleep(400); continue; }
            return { name, token: reg.body.token, ip, sector, version: Number(created.body._saveVersion ?? 0) };
        }
        await sleep(300 + attempt * 300 + Math.random() * 200);
    }
    return null;
}

/** STEADY STATE (measured): behave like a live client until the clock runs out. */
async function virtualPlayer(session, stopAt) {
    const { name, token, ip, sector } = session;
    // Mirror the live client: authFetch.observeSaveVersion adopts `_saveVersion`
    // out of ANY response body and advances monotonically. A harness that only
    // read it from autosave replies would manufacture 409s the real client
    // never sees — measuring its own gap instead of the server's behaviour.
    const state = { version: session.version };
    const adopt = (res) => {
        const v = Number(res?.body?._saveVersion);
        if (Number.isFinite(v) && v > state.version) state.version = v;
        return res;
    };

    // Claim the daily reward once, like a real session start.
    adopt(await timed('reward claim', () =>
        api('/api/player/daily-login', { method: 'POST', token, ip, body: { playerName: name } })));

    // Stagger the loops so virtual players don't move in lockstep.
    await sleep(Math.random() * SAVE_INTERVAL_MS);

    const char = character(name);
    const loops = [
        (async () => {
            while (Date.now() < stopAt) {
                const res = adopt(await timed('autosave', () =>
                    api(`/api/save/${name}`, {
                        method: 'POST', token, ip,
                        body: { character: { ...char, hp: 90 + Math.floor(Math.random() * 10) }, _baseSaveVersion: state.version },
                    })));
                if (res.status === 409) {
                    // Exactly what a real client does: refetch and adopt.
                    adopt(await timed('conflict refetch', () => api(`/api/save/${name}`, { token, asName: name, ip })));
                }
                await sleep(SAVE_INTERVAL_MS + Math.random() * 500);
            }
        })(),
        (async () => {
            while (Date.now() < stopAt) {
                adopt(await timed('heartbeat', () => api('/api/player/heartbeat', {
                    method: 'POST', token, asName: name, ip,
                    body: { name, sector, character: { name, hp: 100, maxHp: 100 } },
                })));
                await sleep(HEARTBEAT_INTERVAL_MS + Math.random() * 500);
            }
        })(),
        (async () => {
            while (Date.now() < stopAt) {
                adopt(await timed('save read', () => api(`/api/save/${name}`, { token, asName: name, ip })));
                await sleep(READ_INTERVAL_MS + Math.random() * 1_000);
            }
        })(),
    ];
    await Promise.all(loops);
}

function bootServer() {
    const entry = existsSync(join(process.cwd(), 'dist', 'server.js')) ? ['dist/server.js'] : ['--import', 'tsx', 'server.ts'];
    console.log(`[soak] booting the real server (${entry.join(' ')}) on port ${PORT}`);
    const child = spawn(process.execPath, entry, {
        env: {
            ...process.env,
            NODE_ENV: 'test',
            SHINOBIX_QA_MEMORY_KV: '1',
            PORT: String(PORT),
            SESSION_SECRET: randomBytes(32).toString('hex'),
            ADMIN_PASSWORD: randomBytes(16).toString('hex'),
            DISABLE_SCHEDULED_JOBS: '1',
            DISABLE_SNAPSHOT_CRON: '1',
            SENTRY_DSN: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const log = [];
    child.stdout.on('data', (d) => log.push(String(d)));
    child.stderr.on('data', (d) => log.push(String(d)));
    return { child, log };
}

async function waitForHealth(timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try { if ((await fetch(`${BASE}/health`)).ok) return true; } catch { /* not up */ }
        await sleep(400);
    }
    return false;
}

/** Event-loop lag: the truest signal that a single-threaded server is saturating. */
function watchEventLoopLag() {
    const samples = [];
    let last = performance.now();
    const timer = setInterval(() => {
        const now = performance.now();
        samples.push(Math.max(0, now - last - 100));
        last = now;
    }, 100);
    return { samples, stop: () => clearInterval(timer) };
}

async function main() {
    const server = EXTERNAL_URL ? null : bootServer();
    if (!(await waitForHealth())) {
        console.error('[soak] server never became healthy');
        if (server) server.child.kill();
        process.exitCode = 2;
        return;
    }

    console.log(`[soak] ${PLAYERS} virtual players, ${SECONDS}s soak, ${RAMP_SECONDS}s ramp → ${BASE}`);
    if (!EXTERNAL_URL) console.log('[soak] NOTE: local run uses the in-memory backend — this measures the event loop and handler cost, not Postgres.');

    const lag = watchEventLoopLag();
    const stopAt = Date.now() + RAMP_SECONDS * 1_000 + SECONDS * 1_000;
    const rampStepMs = (RAMP_SECONDS * 1_000) / Math.max(1, PLAYERS);

    // ── Setup: provision accounts (measured separately) ─────────────────────
    const setupStarted = performance.now();
    const sessions = [];
    const PROVISION_CONCURRENCY = 8;
    for (let i = 0; i < PLAYERS; i += PROVISION_CONCURRENCY) {
        const batch = await Promise.all(
            Array.from({ length: Math.min(PROVISION_CONCURRENCY, PLAYERS - i) }, (_, j) => provisionPlayer(i + j).catch(() => null)),
        );
        for (const session of batch) if (session) sessions.push(session);
    }
    const setupS = (performance.now() - setupStarted) / 1_000;
    console.log(`[soak] provisioned ${sessions.length}/${PLAYERS} accounts in ${setupS.toFixed(0)}s`);
    if (sessions.length < PLAYERS) {
        console.log(`[soak] NOTE: ${PLAYERS - sessions.length} account(s) could not be created (per-IP signup limit — a load-generator artifact, not a server fault).`);
    }

    const started = performance.now();
    const players = [];
    for (const session of sessions) {
        players.push(virtualPlayer(session, stopAt).catch(() => undefined));
        await sleep(rampStepMs);
    }
    await Promise.all(players);
    const elapsedS = (performance.now() - started) / 1_000;
    lag.stop();

    // ── Report ──────────────────────────────────────────────────────────────
    console.log(`\n[soak] ${PLAYERS} players over ${elapsedS.toFixed(0)}s\n`);
    const rows = [...stats.values()].sort((a, b) => b.n - a.n);
    const pad = (s, n) => String(s).padEnd(n);
    const padL = (s, n) => String(s).padStart(n);
    console.log(`${pad('endpoint', 22)}${padL('calls', 8)}${padL('err', 6)}${padL('p50', 8)}${padL('p95', 8)}${padL('p99', 9)}${padL('max', 9)}`);
    console.log('-'.repeat(70));
    let worstP99 = 0;
    let totalErrors = 0;
    let totalCalls = 0;
    for (const s of rows) {
        const sorted = [...s.samples].sort((a, b) => a - b);
        const p99 = percentile(sorted, 99);
        worstP99 = Math.max(worstP99, p99);
        totalErrors += s.errors;
        totalCalls += s.n;
        console.log(
            pad(s.label, 22) + padL(s.n, 8) + padL(s.errors, 6)
            + padL(percentile(sorted, 50).toFixed(0) + 'ms', 8)
            + padL(percentile(sorted, 95).toFixed(0) + 'ms', 8)
            + padL(p99.toFixed(0) + 'ms', 9)
            + padL((sorted[sorted.length - 1] ?? 0).toFixed(0) + 'ms', 9),
        );
    }

    console.log('');
    console.log('[soak] status codes per endpoint:');
    for (const s of rows) {
        const dist = [...s.statuses.entries()].sort((a, b) => b[1] - a[1]).map(([code, n]) => `${code}:${n}`).join('  ');
        console.log(`  ${pad(s.label, 22)} ${dist}`);
    }

    const lagSorted = [...lag.samples].sort((a, b) => a - b);
    const lagP99 = percentile(lagSorted, 99);
    console.log(`\n[soak] event-loop lag  p50 ${percentile(lagSorted, 50).toFixed(0)}ms  p95 ${percentile(lagSorted, 95).toFixed(0)}ms  p99 ${lagP99.toFixed(0)}ms`);
    console.log(`[soak] ${totalCalls} calls, ${totalErrors} errors, ${(totalCalls / elapsedS).toFixed(1)} req/s`);

    // ── Verdict ─────────────────────────────────────────────────────────────
    // Event-loop lag is the metric that matters for a single-threaded,
    // single-instance server: once the loop is behind, EVERY player feels it.
    const verdict = [];
    if (totalErrors > 0) verdict.push(`${totalErrors} unexpected errors`);
    if (lagP99 > 250) verdict.push(`event-loop p99 lag ${lagP99.toFixed(0)}ms (saturating)`);
    if (worstP99 > 2_000) verdict.push(`worst endpoint p99 ${worstP99.toFixed(0)}ms`);
    if (verdict.length === 0) {
        console.log(`\n[soak] PASS — ${PLAYERS} concurrent players carried with headroom.`);
    } else {
        console.log(`\n[soak] ATTENTION — ${verdict.join('; ')}`);
    }
    if (server) {
        const errors = server.log.join('').split('\n').filter((l) => /error|ERR|unhandled/i.test(l));
        if (errors.length) {
            console.log(`\n[soak] server-side error lines (${errors.length}), first 10:`);
            console.log(errors.slice(0, 10).join('\n'));
        }
        server.child.kill();
    }
    process.exitCode = totalErrors > 0 ? 1 : 0;
}

await main();
