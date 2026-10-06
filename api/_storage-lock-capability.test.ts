import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { LockOwnershipLostError, withKvLeaseContext } from './_kv-lock-context.js';
import { StorageLockCapabilityError, type GuardedRestRequest } from './_storage-lock-rest.js';

test('retired overlay settings keep base-store routing and cannot bypass REST lock fencing', async t => {
    const temporaryRoot = resolve(tmpdir());
    const directory = await mkdtemp(join(temporaryRoot, 'ninjak-fencing-overlay-'));
    t.after(async () => {
        // This is the exact unique fixture directory, never a computed ancestor.
        assert.equal(dirname(resolve(directory)), temporaryRoot);
        await rm(directory, { recursive: true, force: true });
    });
    const fixtureEnv: Record<string, string | undefined> = {
        NODE_ENV: 'test', SUPABASE_URL: 'https://storage-lock-fixture.invalid',
        SUPABASE_SERVICE_ROLE_KEY: 'isolated-fixture-key', DISK_KV_DIR: directory,
        KV_PROXY_URL: 'https://retired-overlay-fixture.invalid', REQUIRE_DISK_OVERLAY: '1',
        SHINOBIX_QA_MEMORY_KV: undefined, KV_PROXY_TOKEN: undefined, VERCEL: undefined,
        FORCE_PG_KV: undefined, DATABASE_URL: undefined, SUPABASE_POSTGRES_URL: undefined,
        SUPABASE_DNS_BYPASS: undefined, SUPABASE_DNS_HOST: undefined, SUPABASE_HARDCODED_IP: undefined,
    };
    const previous = Object.fromEntries(Object.keys(fixtureEnv).map(key => [key, process.env[key]]));
    const assignEnv = (values: Record<string, string | undefined>) => {
        for (const [key, value] of Object.entries(values)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    };
    assignEnv(fixtureEnv); t.after(() => assignEnv(previous));
    const rows = new Map<string, unknown>(), requests: GuardedRestRequest[] = [];
    let rpcReady = false;
    const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
        status, headers: { 'content-type': 'application/json' },
    });
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        assert.equal(url.origin, fixtureEnv.SUPABASE_URL, 'fixture must never contact a real database or retired proxy');
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        if (url.pathname === '/rest/v1/rpc/kv_guarded_operation') {
            const request = body as GuardedRestRequest; requests.push(request);
            if (!rpcReady) return response({ code: 'PGRST202', message: 'Guarded RPC is not installed.' }, 404);
            if (request.p_operation === 'capability') return response({ version: 1 });
            if (request.p_leases.some(lease => lease.owner !== 'owner')) {
                return response({ code: '55000', message: 'KV_LOCK_LOST' }, 409);
            }
            const key = String(request.p_args.key ?? (request.p_args.keys as string[])[0]);
            if (request.p_operation === 'get') return response(rows.get(key) ?? null);
            if (request.p_operation === 'set') { rows.set(key, request.p_args.value); return response('OK'); }
            if (request.p_operation === 'del') return response(Number(rows.delete(key)));
            assert.fail(`Unexpected guarded operation: ${request.p_operation}`);
        }
        assert.equal(url.pathname, '/rest/v1/kv_store');
        if (init?.method === 'POST') { rows.set(body.key, body.value); return response(null, 201); }
        assert.equal(init?.method, 'GET');
        const key = url.searchParams.get('key')!.replace(/^eq\./u, '');
        return response(rows.has(key) ? [{ value: rows.get(key), expires_at: null }] : []);
    });
    const { kv, storageLockFencingReady, saveStoreKind } = await import('./_storage.js');

    await kv.set('save:overlay-fencing-test', { credits: 1 });
    assert.deepEqual(await kv.get('save:overlay-fencing-test'), { credits: 1 });
    assert.equal(saveStoreKind, 'base-store');
    assert.deepEqual(await storageLockFencingReady(), { ok: false, backend: 'supabase-rest' });
    const operations = [() => kv.get('save:overlay-fencing-test'),
        () => kv.set('save:overlay-fencing-test', { credits: 99 }), () => kv.del('save:overlay-fencing-test')];
    for (const operation of operations) await withKvLeaseContext('lock:save:overlay-fencing-test', 'owner',
        async () => { await assert.rejects(operation, StorageLockCapabilityError); });
    assert.deepEqual(requests.slice(1).map(request => request.p_operation), ['get', 'set', 'del']);
    assert.deepEqual(await kv.get('save:overlay-fencing-test'), { credits: 1 });
    rpcReady = true;
    assert.deepEqual(await storageLockFencingReady(), { ok: true, backend: 'supabase-rest' });
    for (const operation of operations) await withKvLeaseContext('lock:save:overlay-fencing-test', 'expired-owner',
        async () => { await assert.rejects(operation, LockOwnershipLostError); });
    assert.deepEqual(await kv.get('save:overlay-fencing-test'), { credits: 1 });
    await withKvLeaseContext('lock:save:overlay-fencing-test', 'owner', async () => {
        assert.deepEqual(await kv.get('save:overlay-fencing-test'), { credits: 1 });
        assert.equal(await kv.set('save:overlay-fencing-test', { credits: 2 }), 'OK');
        assert.equal(await kv.del('save:overlay-fencing-test'), 1);
    });
    assert.equal(await kv.get('save:overlay-fencing-test'), null);
    assert.deepEqual(await readdir(directory), [], 'retired disk setting must not receive any save data');
});
