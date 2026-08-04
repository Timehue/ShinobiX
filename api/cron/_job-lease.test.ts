import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { _makeMemoryKv } from '../_storage.js';
import { withScheduledJobLeaseCore } from './_job-lease.js';

describe('distributed scheduled-job lease', () => {
    it('allows exactly one concurrent process to run a named job', async () => {
        const store = _makeMemoryKv();
        let executions = 0;
        let release!: () => void;
        const held = new Promise<void>((resolve) => { release = resolve; });

        const attempts = Array.from({ length: 8 }, () => withScheduledJobLeaseCore(
            store,
            'ranked-rollover',
            async () => {
                executions += 1;
                await held;
                return 'done';
            },
            { ttlSec: 60 },
        ));

        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(executions, 1);
        release();

        const results = await Promise.all(attempts);
        assert.equal(results.filter((result) => result.acquired).length, 1);
    });

    it('releases after success and after failure so a later tick can run', async () => {
        const store = _makeMemoryKv();
        const first = await withScheduledJobLeaseCore(store, 'snapshot', async () => 1, { ttlSec: 60 });
        assert.equal(first.acquired, true);

        await assert.rejects(
            () => withScheduledJobLeaseCore(store, 'snapshot', async () => { throw new Error('boom'); }, { ttlSec: 60 }),
            /boom/,
        );

        const third = await withScheduledJobLeaseCore(store, 'snapshot', async () => 3, { ttlSec: 60 });
        assert.deepEqual(third, { acquired: true, value: 3 });
    });

    it('retains a successful cadence claim so a delayed replica cannot replay the tick', async () => {
        const store = _makeMemoryKv();
        const first = await withScheduledJobLeaseCore(
            store,
            'village-war-daily',
            async () => 'ran',
            { ttlSec: 60, holdUntilExpiryOnSuccess: true },
        );
        const delayed = await withScheduledJobLeaseCore(
            store,
            'village-war-daily',
            async () => 'must-not-run',
            { ttlSec: 60, holdUntilExpiryOnSuccess: true },
        );
        assert.deepEqual(first, { acquired: true, value: 'ran' });
        assert.deepEqual(delayed, { acquired: false });
    });

    it('never deletes a replacement lease owned by another process', async () => {
        const store = _makeMemoryKv();
        let replace!: () => Promise<void>;
        const replaced = new Promise<void>((resolve) => {
            replace = async () => {
                await store.set('cron:lease:era-daily', 'new-owner', { ex: 60 });
                resolve();
            };
        });

        const run = withScheduledJobLeaseCore(store, 'era-daily', async () => {
            await replace();
            await replaced;
        }, { ttlSec: 60 });
        await run;

        assert.equal(await store.get('cron:lease:era-daily'), 'new-owner');
    });

    it('fails closed when lease storage is unavailable', async () => {
        let ran = false;
        const broken = {
            set: async () => { throw new Error('storage down'); },
            delIfEqual: async () => true,
        };
        await assert.rejects(
            () => withScheduledJobLeaseCore(broken, 'merc-auto', async () => { ran = true; }, { ttlSec: 60 }),
            /storage down/,
        );
        assert.equal(ran, false);
    });
});
