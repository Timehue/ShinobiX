import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

/*
 * Mentor settlement across a REAL process restart.
 *
 * Each worker is a separate `node` process with nothing in common but a
 * persisted store file (the stand-in for Postgres): every committed write is
 * flushed to it with its expiry, and a new process loads only what is still
 * live. Worker A is killed mid-claim, between the teacher credit and the
 * student credit. Worker B is a fresh server process that never sees the
 * original request — it runs the scheduler's settlement-reconciliation tick.
 *
 * This file is its own worker: MENTOR_RESTART_ROLE selects the role.
 */

type Json = Record<string, any>;
type StoreFile = { entries: Record<string, unknown>; expiries: Record<string, number | null> };

const SELF = join(process.cwd(), 'api', 'clan', '_mentor-restart.test.ts');
const SENSEI = 'restartsensei';
const STUDENT = 'restartstudent';
const START = Date.UTC(2026, 8, 16, 12, 0, 0);
const KILLED_EXIT = 97;

async function runWorker(role: string, storePath: string, now: number): Promise<never> {
    Date.now = () => now;
    const { kv } = await import('../_storage.js');
    const store = JSON.parse(readFileSync(storePath, 'utf8')) as StoreFile;
    const expiries = new Map<string, number | null>();
    for (const [key, value] of Object.entries(store.entries)) {
        const expiry = store.expiries[key] ?? null;
        if (expiry !== null && expiry <= now) continue; // e.g. the dead worker's lock leases
        await kv.set(key, value, expiry === null ? undefined : { ex: Math.ceil((expiry - now) / 1000) });
        expiries.set(key, expiry);
    }

    const base = {
        set: kv.set.bind(kv), compareSet: kv.compareSet.bind(kv), del: kv.del.bind(kv),
        delIfEqual: kv.delIfEqual.bind(kv), hset: kv.hset.bind(kv), hdel: kv.hdel.bind(kv),
        incr: kv.incr.bind(kv), keys: kv.keys.bind(kv), get: kv.get.bind(kv),
    };
    const flush = async () => {
        const out: StoreFile = { entries: {}, expiries: {} };
        for (const key of await base.keys('*')) {
            out.entries[key] = await base.get(key);
            out.expiries[key] = expiries.get(key) ?? null;
        }
        writeFileSync(storePath, JSON.stringify(out));
    };
    const expiryFor = (options?: { ex?: number }) => (options?.ex ? now + options.ex * 1000 : null);
    kv.set = async (key, value, options) => {
        const result = await base.set(key, value, options);
        if (result) expiries.set(key, expiryFor(options));
        await flush();
        return result;
    };
    kv.compareSet = async (key, expected, value, options) => {
        if (role === 'claim' && key === `save:${STUDENT}`) {
            // The process dies here: the teacher credit is durable, the
            // student credit has not been written. No cleanup runs.
            process.exit(KILLED_EXIT);
        }
        const result = await base.compareSet(key, expected, value, options);
        if (result) expiries.set(key, expiryFor(options));
        await flush();
        return result;
    };
    for (const method of ['del', 'delIfEqual', 'hset', 'hdel', 'incr'] as const) {
        (kv as unknown as Record<string, unknown>)[method] = async (...args: unknown[]) => {
            const result = await (base[method] as (...a: unknown[]) => Promise<unknown>)(...args);
            await flush();
            return result;
        };
    }

    if (role === 'claim') {
        const mentor = (await import('./mentor.js')).default as unknown as (req: never, res: never) => Promise<unknown>;
        const res = { setHeader() { return res; }, status() { return res; }, json() { return res; }, end() { return res; } };
        await mentor({ method: 'POST', body: { action: 'claim', playerName: SENSEI, studentName: STUDENT }, query: {}, headers: { 'x-admin-password': process.env.ADMIN_PASSWORD }, socket: { remoteAddress: '127.0.0.80' } } as never, res as never);
        process.exit(3); // unreachable: the claim must have been killed mid-flight
    }
    const { fireSettlementReconciliation } = await import('../cron/_scheduler.js');
    await fireSettlementReconciliation(false);
    await flush();
    process.exit(0);
}

function spawnWorker(role: 'claim' | 'recover', storePath: string, now: number) {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.SESSION_SECRET;
    const run = spawnSync(process.execPath, ['--import', 'tsx', SELF], {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 180_000,
        env: {
            ...env,
            NODE_ENV: 'test',
            SHINOBIX_QA_MEMORY_KV: '1',
            ADMIN_PASSWORD: 'mentor-restart-memory-only',
            MENTOR_RESTART_ROLE: role,
            MENTOR_RESTART_STORE: storePath,
            MENTOR_RESTART_NOW: String(now),
        },
    });
    return { status: run.status, output: `${run.stdout}\n${run.stderr}` };
}

function load(storePath: string): Record<string, Json> {
    return (JSON.parse(readFileSync(storePath, 'utf8')) as StoreFile).entries as Record<string, Json>;
}

const role = process.env.MENTOR_RESTART_ROLE;
if (role) {
    void runWorker(role, process.env.MENTOR_RESTART_STORE!, Number(process.env.MENTOR_RESTART_NOW)).catch((error) => {
        console.error(error);
        process.exit(2);
    });
} else {
    test('Teacher credited; process interrupted before student credit; fresh worker resumes from persistent state; student credited once; teacher\'s Honor Seals, clanEventContrib, and clan points are not credited again.', { timeout: 600_000 }, () => {
        const dir = mkdtempSync(join(tmpdir(), 'mentor-restart-'));
        const storePath = join(dir, 'store.json');
        try {
            const seed: StoreFile = { entries: {
                [`save:${SENSEI}`]: { _saveVersion: 4, character: { name: SENSEI, clan: 'Restart Hall', honorSeals: 10, clanEventContrib: 2, clanPoints: 40, lifetimeClanPoints: 40, createdAt: START - 400 * 86_400_000 } },
                [`save:${STUDENT}`]: { _saveVersion: 2, character: { name: STUDENT, clan: 'Restart Hall', onboardingStep: 'done', level: 1, ryo: 100, createdAt: START - 86_400_000 } },
                [`clan-mentor:${SENSEI}`]: { students: [{ studentSlug: STUDENT, studentName: 'RestartStudent', startedAt: START - 1_000, claimed: {} }] },
            }, expiries: {} };
            writeFileSync(storePath, JSON.stringify(seed));

            // Worker A: the browser's claim. Killed after the teacher credit.
            const a = spawnWorker('claim', storePath, START);
            assert.equal(a.status, KILLED_EXIT, `worker A must die mid-claim:\n${a.output}`);
            const crashed = load(storePath);
            const teacherAfterCrash = crashed[`save:${SENSEI}`].character;
            assert.equal(teacherAfterCrash.honorSeals, 60, 'the teacher credit committed before the crash');
            assert.equal(crashed[`save:${STUDENT}`].character.ryo, 100, 'the student credit never happened');
            assert.equal(crashed[`clan-mentor:${SENSEI}`].settlements.length, 1, 'the admitted claim is durable');
            assert.ok(crashed[`clan-mentor-pending:${SENSEI}`], 'and discoverable');
            assert.ok(Object.keys(crashed).some((key) => key.startsWith('lock:')), 'the dead worker left its leases behind');

            // Worker B: a fresh server process after the restart, 10 s later
            // (the dead worker's 5 s leases have lapsed). No browser involved.
            const b = spawnWorker('recover', storePath, START + 10_000);
            assert.equal(b.status, 0, b.output);
            const recovered = load(storePath);
            const teacher = recovered[`save:${SENSEI}`].character;
            assert.equal(recovered[`save:${STUDENT}`].character.ryo, 1_100, 'student credited once');
            for (const field of ['honorSeals', 'clanEventContrib', 'clanPoints', 'weeklyClanPoints', 'lifetimeClanPoints']) {
                assert.equal(teacher[field], teacherAfterCrash[field], `${field} is not credited again`);
            }
            assert.equal(recovered[`save:${SENSEI}`]._saveVersion, crashed[`save:${SENSEI}`]._saveVersion, 'the teacher save is not rewritten');
            assert.deepEqual(recovered[`clan-mentor:${SENSEI}`].settlements, []);
            assert.equal(recovered[`clan-mentor-pending:${SENSEI}`], undefined, 'nothing left to discover');

            // Worker C: yet another restart, after the job lease. A no-op.
            const c = spawnWorker('recover', storePath, START + 10 * 60_000);
            assert.equal(c.status, 0, c.output);
            const again = load(storePath);
            for (const key of [`save:${SENSEI}`, `save:${STUDENT}`, `clan-mentor:${SENSEI}`]) {
                assert.deepEqual(again[key], recovered[key], `${key} is unchanged by a later recovery pass`);
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
}
