import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { assertKvLockContext } from '../_kv-lock-context.js';

let kv: typeof import('../_storage.js').kv;
let withKvLock: typeof import('../_lock.js').withKvLock;
let observations: Pick<typeof import('./moderation.js'), 'recordClientIp' | 'recordClientFingerprint'>;

before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SHINOBIX_QA_MEMORY_KV = '1';
    ({ kv } = await import('../_storage.js'));
    ({ withKvLock } = await import('../_lock.js'));
    observations = await import('./moderation.js');
});

for (const kind of ['ip', 'fingerprint'] as const) {
    test(`${kind} observations survive a completed auth callback without changing authority or punishments`, async t => {
        const name = `observation-${kind}-${process.pid}`;
        const value = kind === 'ip' ? '8.8.8.8' : '0123456789abcdef';
        const forwardKey = kind === 'ip' ? `mod:ip-v2:${name}` : `mod:fp:${name}`;
        const reverseKey = kind === 'ip' ? `mod:by-ip-v2:${value}` : `mod:by-fp:${value}`;
        const immutableRows = new Map<string, unknown>([
            [`auth:${name}`, { guest: false, sessionEpoch: 7, recoveryHash: 'unchanged-authority' }],
            [`auth-session:${name}`, 7],
            [`mod:ban:${name}`, { until: 0, permanent: true, reason: 'fixture', by: 'admin', at: 1 }],
            [`mod:silence:${name}`, { until: Date.now() + 60_000, reason: 'fixture', by: 'admin', at: 1 }],
            [`audit:observation-context:${name}`, { receipt: 'durable-refund-evidence', settled: true }],
        ]);
        for (const [key, row] of immutableRows) await kv.set(key, row);
        await kv.del(forwardKey, reverseKey);
        const originalGet = kv.get;
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let gated = false;
        let logger!: Promise<void>;
        // QA memory is the real local data adapter. Apply the production
        // completed-scope guard at this delayed transport boundary, since QA's
        // adapter intentionally does not require database owner rows.
        t.mock.method(kv, 'get', async <T>(key: string): Promise<T | null> => {
            if (key === forwardKey && !gated) {
                gated = true;
                await gate;
            }
            assertKvLockContext();
            return originalGet<T>(key);
        });
        try {
            await withKvLock(`auth:${name}`, async () => {
                logger = kind === 'ip'
                    ? observations.recordClientIp(name, value)
                    : observations.recordClientFingerprint(name, value);
            }, { failClosed: true });
            assert.equal(gated, true, 'the real recorder began reading while its auth caller was active');
            release();
            await logger;
            for (const [key, row] of immutableRows) assert.deepEqual(await originalGet(key), row);
            assert.equal(await originalGet(`lock:auth:${name}`), null, 'account callback and release finished');
            const forward = await originalGet<Record<string, unknown>>(forwardKey);
            assert.equal(forward?.[kind === 'ip' ? 'lastIp' : 'lastFp'], value, 'the authorized observation must survive callback completion');
            assert.deepEqual(await originalGet(reverseKey), [name]);
        } finally {
            release();
            await logger?.catch(() => undefined);
            t.mock.restoreAll();
            await kv.del(...immutableRows.keys(), forwardKey, reverseKey);
        }
    });
}
