/*
 * Local end-to-end smoke of the capacity probe: boots the BUILT server
 * (dist/server.js, run `npm run build:server` first) on a free port with the
 * isolated in-memory store, then runs probe.mjs against it with a tiny plan.
 * It touches no real database. Proves the harness wiring, not capacity.
 *
 *   node scripts/capacity-probe/local-smoke.mjs [steps]   # default "6:20,12:20"
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freePort } from '../lib/free-port.mjs';

if (!existsSync('dist/server.js')) {
    console.error('dist/server.js is missing: run `npm run build:server` first.');
    process.exit(2);
}
const port = await freePort();
const target = `http://127.0.0.1:${port}`;
const healthToken = randomBytes(12).toString('hex');
const adminPassword = randomBytes(16).toString('hex');
const server = spawn(process.execPath, ['dist/server.js'], {
    env: {
        ...process.env,
        NODE_ENV: 'test', SHINOBIX_QA_MEMORY_KV: '1', PORT: String(port),
        SESSION_SECRET: randomBytes(32).toString('hex'), ADMIN_PASSWORD: adminPassword,
        HEALTH_DEEP_TOKEN: healthToken, DISABLE_SCHEDULED_JOBS: '1', DISABLE_SNAPSHOT_CRON: '1', SENTRY_DSN: '',
        DATABASE_URL: '', SUPABASE_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
});
const serverLog = [];
server.stdout.on('data', (d) => serverLog.push(String(d)));
server.stderr.on('data', (d) => serverLog.push(String(d)));

const deadline = Date.now() + 60_000;
let up = false;
while (Date.now() < deadline && server.exitCode === null) {
    try { if ((await fetch(`${target}/health`, { signal: AbortSignal.timeout(2_000) })).ok) { up = true; break; } } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 400));
}
if (!up) {
    console.error(`[smoke] server never became healthy:\n${serverLog.join('').slice(-4_000)}`);
    server.kill();
    process.exit(1);
}

const out = join(tmpdir(), `capacity-smoke-${process.pid}.json`);
const probe = spawn(process.execPath, ['scripts/capacity-probe/probe.mjs'], {
    env: {
        ...process.env,
        CAPACITY_TARGET: target, CAPACITY_STEPS: process.argv[2] ?? '6:20,12:20', CAPACITY_WORKERS: '2',
        CAPACITY_PROVISION_PER_SEC: '6', CAPACITY_SAMPLE_MS: '5000', CAPACITY_OUT: out,
        HEALTH_DEEP_TOKEN: healthToken, DATABASE_URL: '', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '',
        CAPACITY_CLEANUP: '1', ADMIN_PASSWORD: adminPassword, CAPACITY_CLEANUP_GAP_MS: '20',
    },
    stdio: 'inherit',
});
const code = await new Promise((resolve) => probe.on('exit', resolve));
server.kill();
if (code !== 0 || !existsSync(out)) {
    console.error(`[smoke] probe failed (exit ${code}). Server log tail:\n${serverLog.join('').slice(-4_000)}`);
    process.exit(1);
}
const result = JSON.parse(readFileSync(out, 'utf8'));
rmSync(out, { force: true });
console.log(`[smoke] ${result.steps.length} step(s); comfortable ${result.lastComfortablePlayers}, stable ${result.lastStablePlayers}; stopped: ${result.stoppedBecause}; cleanup ${JSON.stringify(result.cleanup)}`);
if (!result.cleanup || result.cleanup.deleted !== result.accounts.provisioned) process.exitCode = 1;
for (const step of result.steps) {
    console.log(`[smoke] ${step.players} players: ${step.requestsPerSec} req/s, edge ${step.edge.hits}/${step.edge.hits + step.edge.misses} hits, breaches: ${step.breaches.join('; ') || 'none'}; failures: ${step.failures.join('; ') || 'none'}`);
    for (const e of step.endpoints) console.log(`         ${e.label.padEnd(40)} n=${String(e.n).padStart(5)} err=${e.errors} p95=${e.p95} ${JSON.stringify(e.statuses)}`);
}
