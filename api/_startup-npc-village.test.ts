import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, beforeEach, it } from 'node:test';
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'startup-npc-test-session-secret-at-least-32-chars';

// Cinderhold's boot seed (api/_startup-initialization.ts initializeNpcVillage).
// It used to be thirty parallel kv.get calls in the scheduler that crossed the
// Supabase pooler's session cap on every deploy and then gave up until 03:00.

let kv: typeof import('./_storage.js').kv;
let init: typeof import('./_startup-initialization.js');
let recoveryMod: typeof import('./_startup-recovery.js');
let roster: typeof import('../shared/npc-village-roster.js');

const POOL_FULL = () => Object.assign(
    new Error('(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 25'),
    { code: 'EMAXCONNSESSION' },
);
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function controller() {
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const recovery = recoveryMod.createStartupRecovery({
        random: () => 0, report: () => undefined,
        schedule(fn, ms) { timers.push({ fn, ms }); return { unref() {} } as ReturnType<typeof setTimeout>; },
        cancel() { timers.length = 0; },
    });
    async function tick() {
        await flush();
        const timer = timers.shift();
        assert.ok(timer, 'recovery remains pending');
        timer.fn();
        await flush();
    }
    return { recovery, timers, tick };
}

before(async () => {
    ({ kv } = await import('./_storage.js'));
    init = await import('./_startup-initialization.js');
    recoveryMod = await import('./_startup-recovery.js');
    roster = await import('../shared/npc-village-roster.js');
});

beforeEach(async () => {
    delete process.env.DISABLE_NPC_VILLAGE;
    delete process.env.DISABLE_SCHEDULED_JOBS;
    for (const key of await kv.keys('*')) await kv.del(key);
});

const authKeys = () => roster.NPC_ACCOUNT_SLUGS.map((slug) => `auth:${slug}`);

it('a full connection pool at boot is retried by startup recovery and the village is seeded', async (t) => {
    t.mock.method(console, 'log', () => undefined);
    const mget = kv.mget.bind(kv);
    let refusals = 1;
    t.mock.method(kv, 'mget', async (...keys: string[]) => {
        if (refusals > 0) { refusals -= 1; throw POOL_FULL(); }
        return mget(...keys);
    });
    const { recovery, tick, timers } = controller();
    const outcome = recovery.start('npc-village', init.initializeNpcVillage);
    await flush();
    assert.equal(timers.length, 1, 'the pool refusal is classified transient and retried, not dropped until 03:00');
    await tick();
    assert.equal(await outcome, 'complete');
    for (const key of authKeys()) assert.ok(await kv.get(key), key);
});

it('reads the thirty account rows in ONE batch and seeds nothing when they all exist', async (t) => {
    t.mock.method(console, 'log', () => undefined);
    for (const key of authKeys()) await kv.set(key, { npcVillage: true });
    const mget = t.mock.method(kv, 'mget');
    const get = t.mock.method(kv, 'get');
    const set = t.mock.method(kv, 'set');
    assert.equal(await init.initializeNpcVillage(), true);
    assert.equal(mget.mock.callCount(), 1);
    assert.deepEqual(mget.mock.calls[0]!.arguments, authKeys());
    assert.equal(get.mock.calls.filter((call) => String(call.arguments[0]).startsWith('auth:')).length, 0, 'no per-account reads');
    assert.equal(set.mock.callCount(), 0, 'no lease and no seed when nothing is missing');
});

it('a partial seed reports incomplete and releases its lease so the retry can run', async (t) => {
    t.mock.method(console, 'log', () => undefined);
    const victim = roster.NPC_ACCOUNT_SLUGS[3]!;
    const get = kv.get.bind(kv);
    let broken = true;
    t.mock.method(kv, 'get', async (...args: Parameters<typeof kv.get>) => {
        if (broken && String(args[0]) === `auth:${victim}`) throw new Error('simulated write-path fault');
        return get(...args);
    });
    assert.equal(await init.initializeNpcVillage(), false);
    assert.equal(await get('cron:lease:npc-village-seed'), null, 'a partial seed must not hold the lease');
    broken = false;
    assert.equal(await init.initializeNpcVillage(), true);
    for (const key of authKeys()) assert.ok(await get(key), key);
});

it('stays off under DISABLE_NPC_VILLAGE and DISABLE_SCHEDULED_JOBS without touching storage', async (t) => {
    const mget = t.mock.method(kv, 'mget');
    process.env.DISABLE_NPC_VILLAGE = '1';
    assert.equal(await init.initializeNpcVillage(), true);
    delete process.env.DISABLE_NPC_VILLAGE;
    process.env.DISABLE_SCHEDULED_JOBS = '1';
    assert.equal(await init.initializeNpcVillage(), true);
    assert.equal(mget.mock.callCount(), 0);
});

it('the scheduler boots Cinderhold through startup recovery, not the old thirty-read burst', () => {
    const src = readFileSync(join(process.cwd(), 'api', 'cron', '_scheduler.ts'), 'utf8');
    assert.match(src, /void startNpcVillageInitialization\(\);/);
    assert.doesNotMatch(src, /NPC_ACCOUNT_SLUGS\.map\(async \(slug\) => !\(await kv\.get/);
    assert.doesNotMatch(src, /Cinderhold boot seed threw/);
});

it('the startup storage probe re-checks a transient refusal before calling storage unreachable', () => {
    const src = readFileSync(join(process.cwd(), 'server.ts'), 'utf8');
    assert.match(src, /startupFailureKind\(err\) === 'transient'/);
    assert.match(src, /STORAGE UNREACHABLE/);
    // The pool-full refusal Railway's container swap produces is one it retries.
    assert.equal(recoveryMod.startupFailureKind(POOL_FULL()), 'transient');
    assert.equal(recoveryMod.startupFailureKind(Object.assign(new Error('password authentication failed'), { code: '28P01' })), 'permanent');
});
