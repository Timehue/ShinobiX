import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { LockOwnershipLostError, withKvLeaseContext } from './_kv-lock-context.js';

test('retired disk overlays preserve unlocked access but reject every protected storage boundary', async t => {
    const temporaryRoot = resolve(tmpdir());
    const directory = await mkdtemp(join(temporaryRoot, 'ninjak-fencing-overlay-'));
    t.after(async () => {
        // This is the exact unique fixture directory, never a computed ancestor.
        assert.equal(dirname(resolve(directory)), temporaryRoot);
        await rm(directory, { recursive: true, force: true });
    });
    process.env.DISK_KV_DIR = directory;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.KV_PROXY_URL;
    delete process.env.KV_PROXY_TOKEN;
    const { kv, storageLockFencingReady } = await import('./_storage.js');

    await kv.set('save:overlay-fencing-test', { credits: 1 });
    assert.deepEqual(await kv.get('save:overlay-fencing-test'), { credits: 1 });
    assert.deepEqual(await storageLockFencingReady(), { ok: false, backend: 'unsupported-overlay' });
    await withKvLeaseContext('lock:save:overlay-fencing-test', 'owner', async () => {
        await assert.rejects(async () => kv.get('save:overlay-fencing-test'), LockOwnershipLostError);
        await assert.rejects(async () => kv.set('save:overlay-fencing-test', { credits: 99 }), LockOwnershipLostError);
        await assert.rejects(async () => kv.del('save:overlay-fencing-test'), LockOwnershipLostError);
    });
    assert.deepEqual(await kv.get('save:overlay-fencing-test'), { credits: 1 });
});
