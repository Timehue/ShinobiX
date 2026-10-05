import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import pg from 'pg';

process.env.DATABASE_URL = 'postgresql://fencing-test:fencing-test@127.0.0.1/fencing-test';
process.env.FORCE_PG_KV = '1';
delete process.env.SHINOBIX_QA_MEMORY_KV;
delete process.env.VERCEL;
delete process.env.KV_PROXY_URL;
delete process.env.DISK_KV_DIR;

type Row = { value: unknown; expiresAt: string | null };
type Client = { pending: Map<string, Row | null>; shares: Set<string>; released: boolean };
const rows = new Map<string, Row>();
const shared = new Map<string, Set<Client>>();
const commands: Array<{ text: string; keys?: unknown[]; client: boolean }> = [];
const originalQuery = pg.Pool.prototype.query;
const originalConnect = pg.Pool.prototype.connect;
const originalEnd = pg.Pool.prototype.end;
const originalNow = Date.now;
let clock = originalNow();
let storage: typeof import('./_storage.js');
let locks: typeof import('./_lock.js');
let mutationGate: { entered: () => void; wait: Promise<void> } | undefined;
let commitGate: { entered: () => void; wait: Promise<void> } | undefined;
let loseCommit = false;
let loseAcquire = false;
let fenceFailure: Error | undefined;
let endCount = 0;

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

function releaseShares(client: Client) {
    for (const key of client.shares) {
        shared.get(key)?.delete(client);
        if (!shared.get(key)?.size) shared.delete(key);
    }
    client.shares.clear();
}

async function waitForShares(key: string, client?: Client) {
    while ([...(shared.get(key) ?? [])].some(owner => owner !== client)) {
        await new Promise<void>(resolve => setImmediate(resolve));
    }
}

async function query(sql: unknown, parameters: unknown[] = [], client?: Client) {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    commands.push({ text, keys: parameters, client: !!client });
    const key = String(parameters[0] ?? '');
    const current = (item: string) => client?.pending.has(item) ? client.pending.get(item) : rows.get(item);
    const write = (item: string, row: Row | null) => {
        if (client) client.pending.set(item, row);
        else if (row) rows.set(item, row);
        else rows.delete(item);
    };
    if (text === 'BEGIN') return { rows: [], rowCount: 0 };
    if (text === 'ROLLBACK') {
        client?.pending.clear();
        if (client) releaseShares(client);
        return { rows: [], rowCount: 0 };
    }
    if (text === 'COMMIT') {
        if (commitGate) { const gate = commitGate; commitGate = undefined; gate.entered(); await gate.wait; }
        for (const [item, row] of client!.pending) {
            if (row) rows.set(item, row); else rows.delete(item);
        }
        client!.pending.clear();
        releaseShares(client!);
        if (loseCommit) { loseCommit = false; throw new Error('lost COMMIT response'); }
        return { rows: [], rowCount: 0 };
    }
    if (text.includes('ORDER BY key FOR SHARE')) {
        if (fenceFailure) { const failure = fenceFailure; fenceFailure = undefined; throw failure; }
        assert.ok(client, 'fence and mutation must use a checked-out client');
        const guardedKeys = parameters[0] as string[];
        const found = guardedKeys.flatMap(item => {
            const row = rows.get(item);
            if (!row) return [];
            client.shares.add(item);
            const owners = shared.get(item) ?? new Set<Client>();
            owners.add(client);
            shared.set(item, owners);
            return [{ key: item, value: structuredClone(row.value), live: !!row.expiresAt && new Date(row.expiresAt).getTime() > clock }];
        });
        return { rows: found, rowCount: found.length };
    }
    if (text.startsWith('SELECT public.kv_set_nx')) {
        await waitForShares(key, client);
        const row = current(key);
        const available = !row || !!row.expiresAt && new Date(row.expiresAt).getTime() <= clock;
        if (available) write(key, { value: JSON.parse(String(parameters[1])), expiresAt: parameters[2] as string | null });
        if (loseAcquire && available) { loseAcquire = false; throw new Error('lost acquire response'); }
        return { rows: [{ kv_set_nx: available }], rowCount: 1 };
    }
    if (text.startsWith('SELECT value, expires_at')) {
        const row = current(key);
        return { rows: row ? [{ value: structuredClone(row.value), expires_at: row.expiresAt }] : [], rowCount: row ? 1 : 0 };
    }
    if (text.startsWith('INSERT INTO public.kv_store')) {
        if (mutationGate) { const gate = mutationGate; mutationGate = undefined; gate.entered(); await gate.wait; }
        write(key, { value: JSON.parse(String(parameters[1])), expiresAt: parameters[2] as string | null });
        return { rows: [], rowCount: 1 };
    }
    if (text.startsWith('DELETE FROM public.kv_store WHERE key = $1 AND value')) {
        await waitForShares(key, client);
        const deleted = JSON.stringify(current(key)?.value) === String(parameters[1]);
        if (deleted) write(key, null);
        return { rows: [], rowCount: deleted ? 1 : 0 };
    }
    throw new Error(`Unexpected test SQL: ${text}`);
}

before(async () => {
    Date.now = () => clock;
    pg.Pool.prototype.query = query as typeof pg.Pool.prototype.query;
    pg.Pool.prototype.connect = (async () => {
        const client: Client = { pending: new Map(), shares: new Set(), released: false };
        return {
            query: (sql: unknown, parameters?: unknown[]) => query(sql, parameters, client),
            release: () => { assert.equal(client.released, false); client.released = true; releaseShares(client); },
        };
    }) as unknown as typeof pg.Pool.prototype.connect;
    pg.Pool.prototype.end = (async () => { endCount++; }) as typeof pg.Pool.prototype.end;
    storage = await import('./_storage.js');
    locks = await import('./_lock.js');
});

beforeEach(() => {
    rows.clear(); shared.clear(); commands.length = 0;
    mutationGate = undefined; commitGate = undefined; loseCommit = false; loseAcquire = false;
    fenceFailure = undefined;
});

after(async () => {
    await storage.closeStoragePool();
    Date.now = originalNow;
    pg.Pool.prototype.query = originalQuery;
    pg.Pool.prototype.connect = originalConnect;
    pg.Pool.prototype.end = originalEnd;
});

const critical = { failClosed: true, maxAttempts: 1, baseBackoffMs: 1 };

test('a resumed expired holder cannot overwrite the replacement holder', async () => {
    const aRead = deferred(); const continueA = deferred();
    await storage.kv.set('save:overrun', { balance: 0, receipts: [] });
    const a = locks.withKvLock('save:overrun', async () => {
        const old = (await storage.kv.get<{ balance: number; receipts: string[] }>('save:overrun'))!;
        aRead.resolve(); await continueA.promise;
        await storage.kv.set('save:overrun', { balance: old.balance + 1, receipts: [...old.receipts, 'A'] });
    }, critical);
    const rejected = assert.rejects(a, locks.LockOwnershipLostError);
    await aRead.promise;
    clock += 6000;
    await locks.withKvLock('save:overrun', () => storage.kv.set('save:overrun', { balance: 1, receipts: ['B'] }), critical);
    continueA.resolve(); await rejected;
    assert.deepEqual(rows.get('save:overrun')?.value, { balance: 1, receipts: ['B'] });
});

test('takeover cannot enter between the checked lease and an in-flight statement commit', async () => {
    const entered = deferred(); const finishWrite = deferred();
    mutationGate = { entered: entered.resolve, wait: finishWrite.promise };
    const a = locks.withKvLock('save:inflight', () => storage.kv.set('save:inflight', 1), critical);
    await entered.promise; clock += 6000;
    let bEntered = false;
    const b = locks.withKvLock('save:inflight', async () => {
        bEntered = true;
        assert.equal(await storage.kv.get('save:inflight'), 1);
        await storage.kv.set('save:inflight', 2);
    }, critical);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(bEntered, false, 'owner-row share lock blocks an expired lease takeover');
    finishWrite.resolve(); await Promise.all([a, b]);
    assert.equal(rows.get('save:inflight')?.value, 2);
});

test('nested locks validate every owner in deterministic key order; same-target calls are reentrant', async () => {
    await locks.withKvLock('z-outer', () => locks.withKvLock('a-inner', async () => {
        await locks.withKvLock('z-outer', () => storage.kv.set('nested-value', 7), critical);
    }, critical), critical);
    const checks = commands.filter(command => command.text.includes('FOR SHARE'));
    assert.ok(checks.some(check => JSON.stringify(check.keys?.[0]) === JSON.stringify(['lock:a-inner', 'lock:z-outer'])),
        'the protected mutation must validate both owners; inner release later validates only its ancestor');
    const acquires = commands.filter(command => command.text.startsWith('SELECT public.kv_set_nx'));
    assert.equal(acquires.length, 2, 'reentrant call must neither replace nor renew its owner');
    assert.equal(commands.filter(command => command.text.startsWith('INSERT INTO')).every(command => command.client), true);
});

test('an expired ancestor blocks nested acquisition before the inner callback runs', async () => {
    let ran = false;
    await assert.rejects(locks.withKvLock('ancestor', async () => {
        clock += 6000;
        await locks.withKvLock('child', async () => { ran = true; }, critical);
    }, critical), locks.LockContendedError);
    assert.equal(ran, false);
    assert.equal(rows.has('lock:child'), false);
});

test('lost COMMIT responses are not replayed and poison all subsequent operations, including cached reads', async () => {
    await storage.kv.set('cacheable-fence', 0);
    await locks.withKvLock('commit-owner', async () => {
        loseCommit = true;
        await assert.rejects(storage.kv.set('cacheable-fence', 1), /lost COMMIT response/);
        await assert.rejects(storage.kv.get('cacheable-fence'), /lost COMMIT response/);
        await assert.rejects(storage.kv.set('second-write', 2), /lost COMMIT response/);
    }, critical);
    assert.equal(rows.get('cacheable-fence')?.value, 1, 'ambiguous commit may be durable; caller must use domain receipts');
    assert.equal(rows.has('second-write'), false);
    assert.equal(commands.filter(command => command.text.startsWith('INSERT INTO') && command.keys?.[0] === 'cacheable-fence').length, 2);
    assert.equal(await storage.kv.get('cacheable-fence'), 1, 'failed response must not leave a predecessor in cache');
});

test('cache publication waits for COMMIT, and a closed callback cannot publish a detached write', async () => {
    const entered = deferred(); const finishCommit = deferred();
    commitGate = { entered: entered.resolve, wait: finishCommit.promise };
    const write = locks.withKvLock('cache-owner', () => storage.kv.set('commit-cache', 3), critical);
    await entered.promise;
    assert.equal(await storage.kv.get('commit-cache'), null, 'uncommitted value is neither stored nor cached');
    finishCommit.resolve(); await write;
    let late!: () => Promise<unknown>;
    await locks.withKvLock('detached-owner', async () => { late = () => storage.kv.set('detached-value', 1); }, critical);
    // Capture the async context in an admitted continuation rather than invoking
    // the closure later from this test's unlocked context.
    const delay = deferred(); let detached!: Promise<unknown>;
    await locks.withKvLock('detached-owner', async () => { detached = delay.promise.then(late); }, critical);
    const rejected = assert.rejects(detached, /completed lock callback/);
    delay.resolve(); await rejected;
    assert.equal(rows.has('detached-value'), false);
});

test('a lost initial NX response never grants the callback an unknown lease owner', async () => {
    loseAcquire = true; let ran = false;
    await assert.rejects(locks.withKvLock('acquire-owner', async () => { ran = true; }, { ...critical, maxAttempts: 2 }), locks.LockContendedError);
    assert.equal(ran, false);
    assert.equal(rows.has('lock:acquire-owner'), true, 'unknown owner is left to expire, not deleted speculatively');
});

test('every mutation entry point fails before SQL once its held lease expires', async () => {
    const mutations = [
        () => storage.kv.set('fenced-mutation', 1),
        () => storage.kv.compareSet('fenced-mutation', null, 1),
        () => storage.kv.del('fenced-mutation'),
        () => storage.kv.delIfEqual('fenced-mutation', 1),
        () => storage.kv.incr('fenced-mutation'),
        () => storage.kv.hset('fenced-mutation', { value: 1 }),
        () => storage.kv.hdel('fenced-mutation', 'value'),
    ];
    for (let index = 0; index < mutations.length; index++) {
        await locks.withKvLock(`mutation-${index}`, async () => {
            clock += 6000;
            const count = commands.length;
            await assert.rejects(mutations[index](), locks.LockOwnershipLostError);
            assert.equal(commands.slice(count).some(command => /INSERT|UPDATE|kv_incr|kv_hset|kv_hdel/.test(command.text)), false);
        }, critical);
    }
});

test('a deadlock/query failure rolls back and cannot be caught to issue a fresh unfenced mutation', async () => {
    await locks.withKvLock('deadlock-owner', async () => {
        fenceFailure = Object.assign(new Error('deadlock detected'), { code: '40P01' });
        await assert.rejects(storage.kv.set('deadlock-value', 1), /deadlock detected/);
        await assert.rejects(storage.kv.set('deadlock-value', 2), /deadlock detected/);
    }, critical);
    assert.equal(rows.has('deadlock-value'), false);
    assert.equal(commands.filter(command => command.text === 'ROLLBACK').length, 1);
    assert.equal(commands.filter(command => command.text === 'COMMIT').length, 0);
});

test('an expired data read under a lease does not launch detached maintenance or poison later writes', async () => {
    rows.set('save:expired-under-lock', { value: 'expired', expiresAt: new Date(0).toISOString() });
    await locks.withKvLock('cleanup-owner', async () => {
        assert.equal(await storage.kv.get('save:expired-under-lock'), null);
        await storage.kv.set('save:healthy-after-read', 1);
    }, critical);
    assert.equal(commands.some(command => command.text.startsWith('DELETE') && command.keys?.[0] === 'save:expired-under-lock'), false);
    assert.equal(rows.get('save:healthy-after-read')?.value, 1);
});

test('scheduled-job leases fence their protected database statements too', async () => {
    const { withScheduledJobLeaseCore } = await import('./cron/_job-lease.js');
    await assert.rejects(withScheduledJobLeaseCore(storage.kv, 'fenced-job', async () => {
        clock += 6000;
        await storage.kv.set('scheduled-output', 1);
    }, { ttlSec: 5 }), locks.LockOwnershipLostError);
    assert.equal(rows.has('scheduled-output'), false);
    const check = commands.find(command => command.text.includes('FOR SHARE'));
    assert.deepEqual(check?.keys?.[0], ['cron:lease:fenced-job']);
});

test('pool close is idempotent and permanently rejects reads and writes instead of recreating a pool', async () => {
    await storage.kv.set('shutdown-cached', 1);
    await Promise.all([storage.closeStoragePool(), storage.closeStoragePool()]);
    assert.equal(endCount, 1);
    const before = commands.length;
    await assert.rejects(storage.kv.get('shutdown-cached'), /closed for shutdown/);
    await assert.rejects(storage.kv.set('shutdown-value', 1), /closed for shutdown/);
    assert.equal(commands.length, before);
});
