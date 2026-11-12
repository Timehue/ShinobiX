import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ModelOperations } from '../../../shared/avatar-model-operations.js';

test('world model activity is full-admin only and exposes aggregate queue, retry and settled billing data', async () => {
    Object.assign(process.env, { NODE_ENV: 'test', SHINOBIX_QA_MEMORY_KV: '1',
        SESSION_SECRET: 'operations-fixture-player-session-secret',
        ADMIN_SESSION_SECRET: 'operations-fixture-admin-session-secret' });
    const { issueAdminToken } = await import('../../_auth.js');
    const { kv } = await import('../../_storage.js');
    const handler = (await import('./operations.js')).default as unknown as (req: never, res: never) => Promise<unknown>;
    const prefix = 'avatar-model:';
    const now = Date.now();
    const old = now - 45 * 86400 * 1000;
    const privateSlug = 'fixture-private-account';
    const privatePortrait = 'avatar-model/private/portraits/private-art-fingerprint';
    const sample = { createdAt: now, slug: privateSlug, sourceKey: privatePortrait,
        pipelineVersion: 'pipeline-v4', kitVersion: 'kit-v3' };
    const jobs = {
        'ready-paid': { ...sample, path: 'A', state: 'ready', attempt: 3,
            retryCauses: { 'expired-style': 1, 'worker-failure': 1 }, reserved: [],
            settledCosts: { modal: { spentMicros: 13000, billedMilliseconds: 24000 }, openai: { spentMicros: 2000 } } },
        'ready-zero': { ...sample, path: 'A', state: 'ready', attempt: 1, reserved: [],
            settledCosts: { modal: { spentMicros: 0, billedMilliseconds: 0 }, openai: { spentMicros: 0 } } },
        'ready-incomplete': { ...sample, path: 'B', state: 'ready', reserved: [{ provider: 'openai' }],
            settledCosts: { modal: { spentMicros: 12000 } } },
        'known-failure': { ...sample, path: 'B', state: 'failed', attempt: 2, errorCode: 'worker-crash' },
        'unknown-failure': { ...sample, state: 'failed', errorCode: privatePortrait, pipelineVersion: privatePortrait },
        'new-dispatch': { ...sample, path: 'A', state: 'queued', attempt: 0 },
        'old-publication': { ...sample, path: 'A', state: 'validate', createdAt: old },
        'old-paid': { ...sample, path: 'A', state: 'ready', createdAt: old, reserved: [],
            settledCosts: { modal: { spentMicros: 70000, billedMilliseconds: 90000 }, openai: { spentMicros: 20000 } } },
    };
    await Promise.all([
        ...Object.entries(jobs).map(([id, job]) => kv.set(prefix + 'job:' + id, job)),
        kv.set(prefix + 'dispatch', ['new-dispatch', 'new-dispatch']),
        kv.set(prefix + 'publish', ['old-publication']),
    ]);
    async function request(token?: string, method = 'GET') {
        let status = 0;
        let json: unknown;
        const headers = new Map<string, unknown>();
        const res = { setHeader(name: string, value: unknown) { headers.set(name, value); },
            status(code: number) { status = code; return res; }, json(value: unknown) { json = value; }, end() {} };
        await handler({ method, headers: token ? { 'x-admin-token': token } : {} } as never, res as never);
        return { status, json, headers };
    }
    assert.equal((await request()).status, 403);
    assert.equal((await request(issueAdminToken('content')!)).status, 403);
    const admin = issueAdminToken('full')!;
    assert.equal((await request(admin, 'POST')).status, 405);
    const result = await request(admin);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
    const data = result.json as ModelOperations;
    assert.equal(data.windowDays, 30);
    assert.deepEqual(data.paths, {
        A: { admitted: 3, ready: 2, failed: 0, cancelled: 0 },
        B: { admitted: 2, ready: 1, failed: 1, cancelled: 0 },
        unknown: { admitted: 1, ready: 0, failed: 1, cancelled: 0 },
    });
    assert.equal(data.queue.dispatch, 1);
    assert.equal(data.queue.publication, 1);
    assert.ok(data.queue.oldestSeconds !== null && data.queue.oldestSeconds >= 45 * 86400);
    assert.deepEqual(data.billing, { settledReady: 2, averageReadyMicros: 7500, timedJobs: 2, workerMilliseconds: 24000 });
    assert.deepEqual(data.retries, { 'expired-style': 1, 'worker-failure': 1, unknown: 1 });
    assert.deepEqual(data.failures, { 'worker-crash': 1, unknown: 1 });
    assert.deepEqual(data.versions, [
        { pipeline: 'pipeline-v4', kit: 'kit-v3', count: 5 },
        { pipeline: 'Unknown', kit: 'kit-v3', count: 1 },
    ]);
    const serialized = JSON.stringify(data);
    for (const privateValue of [privateSlug, privatePortrait, ...Object.keys(jobs)]) {
        assert.equal(serialized.includes(privateValue), false);
    }
    await kv.set(prefix + 'publish', ['missing-job']);
    const incomplete = (await request(admin)).json as ModelOperations;
    assert.deepEqual(incomplete.queue, { dispatch: 1, publication: 1, oldestSeconds: null });
    assert.deepEqual(await kv.get(prefix + 'job:ready-paid'), jobs['ready-paid']);
});
