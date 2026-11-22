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

it('reads every account AND save row in ONE batch and seeds nothing when they all exist', async (t) => {
    t.mock.method(console, 'log', () => undefined);
    assert.equal(await init.initializeNpcVillage(), true, 'a real seeded village');
    const mget = t.mock.method(kv, 'mget');
    const get = t.mock.method(kv, 'get');
    const set = t.mock.method(kv, 'set');
    assert.equal(await init.initializeNpcVillage(), true);
    assert.equal(mget.mock.callCount(), 1);
    assert.deepEqual(mget.mock.calls[0]!.arguments, roster.NPC_ACCOUNT_SLUGS.flatMap((slug) => [`auth:${slug}`, `save:${slug}`]));
    assert.equal(get.mock.calls.filter((call) => /^(auth|save):/.test(String(call.arguments[0]))).length, 0, 'no per-account reads');
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

// The seed stamps `auth:` BEFORE it commits `save:`, so a save commit that
// fails leaves an account with no character. Readiness must not count it.
function faultSaveCommit(t: import('node:test').TestContext, saveKey: string) {
    const compareSet = kv.compareSet.bind(kv);
    let broken = true;
    t.mock.method(kv, 'compareSet', async (...args: Parameters<typeof kv.compareSet>) => {
        if (broken && args[0] === saveKey) throw new Error('simulated save commit failure');
        return compareSet(...args);
    });
    // The ledger path commits through compareSetMany (optional on the store type).
    type Many = NonNullable<typeof kv.compareSetMany>;
    const compareSetMany = kv.compareSetMany?.bind(kv) as Many | undefined;
    if (compareSetMany) {
        t.mock.method(kv as { compareSetMany: Many }, 'compareSetMany', async (...args: Parameters<Many>) => {
            if (broken && JSON.stringify(args[0]).includes(`"${saveKey}"`)) throw new Error('simulated save commit failure');
            return compareSetMany(...args);
        });
    }
    return () => { broken = false; };
}

it('a save that fails AFTER its account was stamped is restored by the retry', async (t) => {
    t.mock.method(console, 'log', () => undefined);
    const victim = roster.NPC_ACCOUNT_SLUGS[5]!;
    const heal = faultSaveCommit(t, `save:${victim}`);
    assert.equal(await init.initializeNpcVillage(), false, 'the failed save makes the seed incomplete');
    assert.ok(await kv.get(`auth:${victim}`), 'the account row was written first');
    assert.equal(await kv.get(`save:${victim}`), null, 'and the save is missing');
    heal();
    assert.equal(await init.initializeNpcVillage(), true);
    assert.ok(await kv.get(`save:${victim}`), 'the retry restored the missing save');
    for (const slug of roster.NPC_ACCOUNT_SLUGS) {
        assert.ok(await kv.get(`auth:${slug}`), `auth:${slug}`);
        assert.ok(await kv.get(`save:${slug}`), `save:${slug}`);
    }
});

it('an account without its save is not counted as seeded, even on a fresh process', async (t) => {
    t.mock.method(console, 'log', () => undefined);
    // A clean village first, then lose one save as a crash between the two writes would.
    assert.equal(await init.initializeNpcVillage(), true);
    const victim = roster.NPC_ACCOUNT_SLUGS[9]!;
    await kv.del(`save:${victim}`);
    assert.ok(await kv.get(`auth:${victim}`));
    // A clean seed holds its lease for ten minutes against a second container;
    // a later boot finds it expired.
    await kv.del('cron:lease:npc-village-seed');
    assert.equal(await init.initializeNpcVillage(), true);
    assert.ok(await kv.get(`save:${victim}`), 'the missing save was rebuilt');
});

it('after an incomplete seed the retry re-runs the seed even when every row is present', async (t) => {
    const lines: string[] = [];
    t.mock.method(console, 'log', (...args: unknown[]) => { lines.push(args.map(String).join(' ')); });
    // The village registry write fails once, after all thirty accounts and
    // saves were committed.
    const hset = kv.hset.bind(kv);
    let broken = true;
    t.mock.method(kv, 'hset', async (...args: Parameters<typeof kv.hset>) => {
        if (broken) { broken = false; throw new Error('simulated registry write failure'); }
        return hset(...args);
    });
    assert.equal(await init.initializeNpcVillage(), false, 'a failed registry step makes the seed incomplete');
    // Every row exists, so the presence check alone would stop here.
    for (const slug of roster.NPC_ACCOUNT_SLUGS) {
        assert.ok(await kv.get(`auth:${slug}`), `auth:${slug}`);
        assert.ok(await kv.get(`save:${slug}`), `save:${slug}`);
    }
    const seedRuns = () => lines.filter((line) => line.includes('[startup] Cinderhold seed:')).length;
    const before = seedRuns();
    assert.equal(await init.initializeNpcVillage(), true);
    assert.equal(seedRuns(), before + 1, 'the retry re-ran the seed instead of trusting the rows');
    // A clean seed clears the flag: the next boot check is a single read again.
    const mget = t.mock.method(kv, 'mget');
    assert.equal(await init.initializeNpcVillage(), true);
    assert.equal(mget.mock.callCount(), 1);
    assert.equal(seedRuns(), before + 1);
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
