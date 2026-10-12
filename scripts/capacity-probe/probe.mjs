/*
 * Capacity probe orchestrator (scripts/capacity-probe/README.md).
 *
 * Steps the number of concurrently active virtual players up a plan, measures
 * each step from the client side (per-endpoint latency/status) and the server
 * side (ResourceSampler), and stops at the first step that breaks an SLO twice
 * in a row, or at once when a safety guard trips. Prints one
 * `[capacity-step] {json}` line per step and a final `[capacity-result] {json}`,
 * and writes the full result to CAPACITY_OUT.
 *
 * Configuration (environment):
 *   CAPACITY_TARGET            origin to drive, e.g. http://shinobix.railway.internal:8080
 *   CAPACITY_CONFIRM_HOST      must equal the target host (loopback exempt)
 *   CAPACITY_ALLOW_PRODUCTION  =1 for an owner-approved production run
 *   CAPACITY_PRODUCTION_HOSTS  comma list (default: the live hosts)
 *   CAPACITY_STEPS             "100-1000/100@180" or "50:120,100:120"
 *   CAPACITY_WORKERS           simulated Cloudflare POPs = worker processes (6)
 *   CAPACITY_ACTIVE_FRACTION   share of players that autosave and travel (0.5)
 *   CAPACITY_PROVISION_PER_SEC registrations per second during setup (4)
 *   CAPACITY_RAMP_SECONDS      spread each step's new arrivals over this long (60)
 *   CAPACITY_SETTLE_SECONDS    wait after arrivals before measuring (30)
 *   CAPACITY_MAX_DB_GROWTH_MB  abort when the database grows this much (600)
 *   CAPACITY_MAX_WAL_MB        abort when this much WAL is generated (2500)
 *   CAPACITY_RUN_ID            account-name tag (random)
 *   CAPACITY_CLEANUP           =1 deletes this run's accounts at the end (needs ADMIN_PASSWORD)
 *   HEALTH_DEEP_TOKEN, DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { assertTargetAllowed, isProbeAccountName, parseStepPlan, probeAccountName, StatsBook, sleep, syntheticIp } from './lib.mjs';
import { ResourceSampler, summarizeSamples } from './sampler.mjs';

const env = process.env;
const TARGET = String(env.CAPACITY_TARGET ?? '').replace(/\/$/, '');
const RUN_ID = env.CAPACITY_RUN_ID || randomBytes(2).toString('hex');
const WORKERS = Math.max(1, Number(env.CAPACITY_WORKERS ?? 6));
const STEPS = parseStepPlan(env.CAPACITY_STEPS ?? '50-500/50@180');
const PROVISION_PER_SEC = Math.max(0.5, Number(env.CAPACITY_PROVISION_PER_SEC ?? 4));
// New players arrive spread over this many seconds, then the step waits SETTLE
// seconds before measuring steady state.
const RAMP_SECONDS = Math.max(0, Number(env.CAPACITY_RAMP_SECONDS ?? 60));
const SETTLE_SECONDS = Math.max(0, Number(env.CAPACITY_SETTLE_SECONDS ?? 30));
const MAX_DB_GROWTH = Number(env.CAPACITY_MAX_DB_GROWTH_MB ?? 600) * 1024 * 1024;
const MAX_WAL = Number(env.CAPACITY_MAX_WAL_MB ?? 2500) * 1024 * 1024;
const OUT = env.CAPACITY_OUT ?? `capacity-result-${RUN_ID}.json`;
const PRODUCTION_HOSTS = (env.CAPACITY_PRODUCTION_HOSTS ?? 'shinobijourney.com,www.shinobijourney.com,shinobix.railway.internal')
    .split(',').map((h) => h.trim()).filter(Boolean);

/** SLOs (docs/staging-load-and-reconnect-runbook.md, plus server-side signals). */
export const SLO = {
    maxErrorRate: 0.01,
    maxNormalP95: 500,
    maxSaveP95: 1_000,
    maxHealthMs: 250,
    maxEventLoopUtilization: 0.9,
    maxPoolWaiting: 0,
};

/** Which SLOs a step broke (empty = healthy). Pure, exported for tests. */
export function stepBreaches(summary, resources) {
    const breaches = [];
    let calls = 0;
    let errors = 0;
    for (const row of summary) {
        if (row.label.startsWith('SETUP')) continue;
        calls += row.n;
        errors += row.errors;
        const isSave = /\/api\/save\/|player\/travel/.test(row.label);
        const limit = isSave ? SLO.maxSaveP95 : SLO.maxNormalP95;
        if (row.n >= 20 && row.p95 > limit && !row.label.startsWith('SOCKET')) breaches.push(`${row.label} p95 ${row.p95} ms > ${limit}`);
    }
    if (calls > 0 && errors / calls > SLO.maxErrorRate) breaches.push(`error rate ${(100 * errors / calls).toFixed(2)}% > ${SLO.maxErrorRate * 100}%`);
    if (resources.healthMsMax != null && resources.healthMsMax > SLO.maxHealthMs) breaches.push(`/health/runtime round trip ${resources.healthMsMax} ms > ${SLO.maxHealthMs}`);
    if (resources.eluMax != null && resources.eluMax > SLO.maxEventLoopUtilization) breaches.push(`event loop ${Math.round(resources.eluMax * 100)}% busy`);
    if (resources.poolWaitingMax != null && resources.poolWaitingMax > SLO.maxPoolWaiting) breaches.push(`${resources.poolWaitingMax} requests waiting for a DB connection`);
    return breaches;
}

/**
 * Failure thresholds: the game no longer works for players, as opposed to the
 * comfort SLOs above. The comfort SLOs mark the size to PLAN for; failures mark
 * the ceiling. The run continues through comfort breaches and stops only after
 * two consecutive failed steps. (2026-10-12: the first production run stopped at
 * 200 players on two slow mail/intel routes while the server was 90% idle.)
 */
export const FAILURE = {
    maxErrorRate: 0.01,
    maxCoreP95: 2_000,
    maxHealthMs: 2_000,
    maxEventLoopUtilizationAvg: 0.95,
    maxPoolWaiting: 10,
};
const CORE_ROUTE = /player\/heartbeat|\/api\/save\/|SOCKET connect/;

/** Which failure thresholds a step crossed (empty = still working). Pure, exported for tests. */
export function stepFailures(summary, resources) {
    const failures = [];
    let calls = 0;
    let errors = 0;
    for (const row of summary) {
        if (row.label.startsWith('SETUP')) continue;
        calls += row.n;
        errors += row.errors;
        if (CORE_ROUTE.test(row.label) && row.n >= 20 && row.p95 > FAILURE.maxCoreP95) failures.push(`${row.label} p95 ${row.p95} ms > ${FAILURE.maxCoreP95}`);
    }
    if (calls > 0 && errors / calls > FAILURE.maxErrorRate) failures.push(`error rate ${(100 * errors / calls).toFixed(2)}% > ${FAILURE.maxErrorRate * 100}%`);
    if (resources.healthMsMax != null && resources.healthMsMax > FAILURE.maxHealthMs) failures.push(`/health/runtime round trip ${resources.healthMsMax} ms > ${FAILURE.maxHealthMs}`);
    if (resources.eluAvg != null && resources.eluAvg > FAILURE.maxEventLoopUtilizationAvg) failures.push(`event loop ${Math.round(resources.eluAvg * 100)}% busy on average`);
    if (resources.poolWaitingMax != null && resources.poolWaitingMax > FAILURE.maxPoolWaiting) failures.push(`${resources.poolWaitingMax} requests waiting for a DB connection`);
    return failures;
}

function startWorkers() {
    const workers = [];
    for (let pop = 0; pop < WORKERS; pop += 1) {
        const child = fork(new URL('./worker.mjs', import.meta.url), [], {
            env: { ...env, CAPACITY_TARGET: TARGET, CAPACITY_RUN_ID: RUN_ID, CAPACITY_POP: String(pop) },
            stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        });
        let markReady;
        const ready = new Promise((resolve) => { markReady = resolve; });
        const waiters = [];
        child.on('message', (msg) => {
            if (msg.type === 'ready') { markReady(); return; }
            const i = waiters.findIndex((w) => w.type === msg.type || msg.type === 'error');
            if (msg.type === 'error') console.error(`[capacity] worker ${pop}: ${msg.message}`);
            if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
        });
        const ask = (message, replyType) => ready.then(() => new Promise((resolve) => {
            waiters.push({ type: replyType, resolve });
            child.send(message);
        }));
        workers.push({ pop, child, ask });
    }
    return workers;
}

/**
 * Delete this run's `lt<run><n>` accounts through the game's own admin path
 * (DELETE /api/save/<name>, then player-auth `delete`), which also detaches the
 * registry entry and per-player keys. Needs ADMIN_PASSWORD (a full admin skips
 * the 24 h self-deletion wait). Paced: each deletion rewrites the shared player
 * registry row, so a burst would be a burst of WAL on a spend-capped disk.
 */
async function cleanupAccounts(runId, count) {
    const admin = env.ADMIN_PASSWORD;
    if (!admin) return { skipped: 'ADMIN_PASSWORD not set; accounts are left for the server reset' };
    let deleted = 0;
    const failed = [];
    for (let i = 0; i < count; i += 1) {
        const name = probeAccountName(runId, i);
        if (!isProbeAccountName(name, runId)) continue; // never anything but this run's accounts
        // Each account deletes from its own test address, as it registered:
        // player-auth `delete` allows 10 per 15 min per IP, which left 166
        // logins behind on 2026-10-12 when the whole cleanup shared one.
        const ip = syntheticIp(i);
        const headers = { 'content-type': 'application/json', 'x-admin-password': admin, 'x-real-ip': ip, 'x-forwarded-for': ip };
        try {
            const save = await fetch(`${TARGET}/api/save/${name}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(15_000) });
            const auth = await fetch(`${TARGET}/api/player-auth`, {
                method: 'POST', headers, signal: AbortSignal.timeout(15_000),
                body: JSON.stringify({ action: 'delete', name }),
            });
            if ((save.ok || save.status === 404) && (auth.ok || auth.status === 404)) deleted += 1;
            else failed.push(`${name}:${save.status}/${auth.status}`);
        } catch (err) {
            failed.push(`${name}:${err instanceof Error ? err.name : 'error'}`);
        }
        await sleep(Number(env.CAPACITY_CLEANUP_GAP_MS ?? 250));
    }
    console.log(`[capacity] cleanup lt${runId}: deleted ${deleted}/${count} accounts${failed.length ? `, ${failed.length} failed (first: ${failed.slice(0, 5).join(', ')})` : ''}`);
    return { deleted, failed: failed.length, sample: failed.slice(0, 10) };
}

/** Player i belongs to worker i % WORKERS: each POP gets an even share. */
const ownerOf = (index) => index % WORKERS;
const indicesFor = (pop, from, to) => {
    const out = [];
    for (let i = from; i < to; i += 1) if (ownerOf(i) === pop) out.push(i);
    return out;
};

async function main() {
    const safety = assertTargetAllowed({
        targetUrl: TARGET,
        confirmHost: env.CAPACITY_CONFIRM_HOST,
        allowProduction: env.CAPACITY_ALLOW_PRODUCTION === '1',
        productionHosts: PRODUCTION_HOSTS,
    });
    console.log(`[capacity] run ${RUN_ID} → ${TARGET} (${safety.production ? 'PRODUCTION' : safety.loopback ? 'loopback' : 'non-production'}), ${WORKERS} POPs, steps ${STEPS.map((s) => s.players).join('→')}`);

    const sampler = new ResourceSampler({
        targetUrl: TARGET,
        healthToken: env.HEALTH_DEEP_TOKEN,
        databaseUrl: env.DATABASE_URL,
        supabaseUrl: env.SUPABASE_URL,
        serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
        sampleMs: Number(env.CAPACITY_SAMPLE_MS ?? 15_000),
    });
    await sampler.start();
    const baseline = sampler.samples[0]?.db;
    if (baseline?.dbBytes) sampler.maxDbBytes = baseline.dbBytes + MAX_DB_GROWTH;
    const walStart = baseline?.walPos ?? null;

    const workers = startWorkers();
    const result = { runId: RUN_ID, target: TARGET, startedAt: new Date().toISOString(), workers: WORKERS, slo: SLO, failure: FAILURE, steps: [], stoppedBecause: null };
    let provisioned = 0;
    let active = 0;
    let consecutiveFailures = 0;
    let walGenerated = 0;

    try {
        for (const step of STEPS) {
            if (sampler.abortReason) { result.stoppedBecause = `abort: ${sampler.abortReason}`; break; }

            // Setup (not measured): register + first save up to this step's size.
            if (step.players > provisioned) {
                const gapMs = Math.round((1_000 * WORKERS) / PROVISION_PER_SEC);
                const replies = await Promise.all(workers.map((w) =>
                    w.ask({ type: 'provision', indices: indicesFor(w.pop, provisioned, step.players), gapMs }, 'provisioned')));
                const ok = replies.reduce((n, r) => n + (r.ok ?? 0), 0);
                console.log(`[capacity] provisioned ${ok}/${step.players - provisioned} accounts`);
                provisioned = step.players;
            }
            // Arrivals are spread over RAMP_SECONDS. Each login fires ~15 requests
            // at once (polls, image lists, socket, save read); on 2026-10-12 a
            // 200-player step arriving within ~1.3 s queued ~2,000 requests for the
            // 15 DB connections, so a burst step measured a login stampede, not
            // steady capacity. The arrival window is recorded separately below.
            let arrival = null;
            if (step.players > active) {
                const perPop = Math.max(1, Math.ceil((step.players - active) / WORKERS));
                const gapMs = Math.max(10, Math.round((RAMP_SECONDS * 1_000) / perPop));
                await Promise.all(workers.map((w) => w.ask({ type: 'activate', indices: indicesFor(w.pop, active, step.players), gapMs }, 'activated')));
                active = step.players;
                await sleep(SETTLE_SECONDS * 1_000);
                const arrivalBook = new StatsBook();
                for (const reply of await Promise.all(workers.map((w) => w.ask({ type: 'flush' }, 'stats')))) arrivalBook.merge(reply.stats);
                arrival = arrivalBook.summary()
                    .filter((r) => CORE_ROUTE.test(r.label) || r.errors > 0)
                    .map(({ label, n, errors, p50, p95, p99 }) => ({ label, n, errors, p50, p95, p99 }));
            } else {
                await Promise.all(workers.map((w) => w.ask({ type: 'flush' }, 'stats')));
            }
            const from = Date.now();
            await sleep(step.seconds * 1_000);
            const to = Date.now();

            const book = new StatsBook();
            let edgeHits = 0;
            let edgeMisses = 0;
            let socketEvents = 0;
            for (const reply of await Promise.all(workers.map((w) => w.ask({ type: 'flush' }, 'stats')))) {
                book.merge(reply.stats);
                edgeHits += reply.edge?.hits ?? 0;
                edgeMisses += reply.edge?.misses ?? 0;
                socketEvents += reply.socketEvents ?? 0;
            }
            const summary = book.summary();
            const resources = summarizeSamples(sampler.window(from, to));
            const walNow = sampler.samples.at(-1)?.db?.walPos;
            if (walStart != null && walNow != null) walGenerated = walNow - walStart;
            const breaches = stepBreaches(summary, resources);
            const failures = stepFailures(summary, resources);
            const totalCalls = summary.filter((r) => !r.label.startsWith('SETUP')).reduce((n, r) => n + r.n, 0);
            const record = {
                players: step.players,
                seconds: step.seconds,
                requestsPerSec: Math.round((totalCalls / step.seconds) * 10) / 10,
                edge: { hits: edgeHits, misses: edgeMisses },
                socketEventsPerSec: Math.round(socketEvents / step.seconds),
                resources,
                walGeneratedMb: Math.round(walGenerated / 1024 / 1024),
                endpoints: summary,
                arrival,
                breaches,
                failures,
            };
            result.steps.push(record);
            console.log(`[capacity-step] ${JSON.stringify({ ...record, endpoints: summary.slice(0, 12).map(({ label, n, errors, p50, p95, p99 }) => ({ label, n, errors, p50, p95, p99 })) })}`);

            if (MAX_WAL && walGenerated > MAX_WAL) { result.stoppedBecause = `abort: ${Math.round(walGenerated / 1048576)} MB of WAL generated`; break; }
            consecutiveFailures = failures.length ? consecutiveFailures + 1 : 0;
            if (consecutiveFailures >= 2) { result.stoppedBecause = `failed at two consecutive steps (${failures.join('; ')})`; break; }
        }
    } finally {
        await Promise.all(workers.map((w) => w.ask({ type: 'shutdown' }, 'bye').catch(() => undefined)));
        await sampler.stop();
    }

    if (env.CAPACITY_CLEANUP === '1') {
        result.cleanup = await cleanupAccounts(RUN_ID, provisioned);
        // Leftovers of earlier runs, e.g. CAPACITY_CLEANUP_ALSO="cp:200".
        for (const spec of String(env.CAPACITY_CLEANUP_ALSO ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
            const [runId, count] = spec.split(':');
            if (runId && Number(count) > 0) result[`cleanup_${runId}`] = await cleanupAccounts(runId, Number(count));
        }
    }

    const largest = (steps) => (steps.length ? Math.max(...steps.map((s) => s.players)) : 0);
    // Comfortable: every comfort SLO met. Stable: no failure threshold crossed.
    result.lastComfortablePlayers = largest(result.steps.filter((s) => s.breaches.length === 0));
    result.lastStablePlayers = largest(result.steps.filter((s) => s.failures.length === 0));
    result.firstFailedPlayers = result.steps.find((s) => s.failures.length > 0)?.players ?? null;
    result.stoppedBecause ??= 'plan completed';
    result.finishedAt = new Date().toISOString();
    result.accounts = { prefix: `lt${RUN_ID}`, provisioned };
    writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`[capacity-result] ${JSON.stringify({ runId: RUN_ID, lastComfortablePlayers: result.lastComfortablePlayers, lastStablePlayers: result.lastStablePlayers, firstFailedPlayers: result.firstFailedPlayers, stoppedBecause: result.stoppedBecause, accounts: result.accounts, out: OUT })}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((err) => {
        console.error(`[capacity] ${err instanceof Error ? err.stack : String(err)}`);
        process.exitCode = 1;
    });
}
