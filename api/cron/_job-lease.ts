/**
 * Distributed ownership for in-process scheduled jobs.
 *
 * Every Railway process creates the same local timers. Before a timer performs
 * work it must claim a short-lived KV lease, so only one process can execute a
 * named job at a time. The owner token makes release compare-and-delete safe:
 * a stale process can never delete a newer process's lease after TTL expiry.
 *
 * Leases deliberately fail closed. A storage outage skips background work for
 * this tick instead of allowing every process to run it concurrently.
 */
import { randomUUID } from 'node:crypto';
import { kv, type KvLike } from '../_storage.js';

const LEASE_PREFIX = 'cron:lease:';

export type ScheduledJobLeaseResult<T> =
    | { acquired: false }
    | { acquired: true; value: T };

export type ScheduledJobLeaseOptions = {
    /** Crash-recovery TTL in seconds. Must exceed the job's normal maximum runtime. */
    ttlSec: number;
    /**
     * Keep the lease until its TTL after success. Scheduled callers use this as
     * a cadence dedupe window so a slightly delayed replica cannot rerun the
     * same tick after the first process finishes.
     */
    holdUntilExpiryOnSuccess?: boolean;
};

function leaseKey(jobName: string): string {
    return `${LEASE_PREFIX}${jobName}`;
}

/**
 * Core lease operation with an injected store for deterministic concurrency
 * tests. Production callers use {@link withScheduledJobLease} below.
 */
export async function withScheduledJobLeaseCore<T>(
    store: Pick<KvLike, 'set' | 'delIfEqual'>,
    jobName: string,
    fn: () => Promise<T>,
    options: ScheduledJobLeaseOptions,
): Promise<ScheduledJobLeaseResult<T>> {
    if (!/^[a-z0-9][a-z0-9:_-]{0,119}$/i.test(jobName)) {
        throw new Error(`Invalid scheduled job name: ${jobName}`);
    }
    if (!Number.isSafeInteger(options.ttlSec) || options.ttlSec < 1) {
        throw new Error(`Invalid scheduled job lease TTL: ${options.ttlSec}`);
    }

    const key = leaseKey(jobName);
    const ownerToken = randomUUID();
    const acquired = await store.set(key, ownerToken, { nx: true, ex: options.ttlSec });
    if (acquired !== 'OK') return { acquired: false };

    let succeeded = false;
    try {
        const value = await fn();
        succeeded = true;
        return { acquired: true, value };
    } finally {
        if (!(succeeded && options.holdUntilExpiryOnSuccess)) {
            // Compare-and-delete is load-bearing: if this process stalled past
            // the TTL, it must not release a newer owner's replacement lease.
            await store.delIfEqual(key, ownerToken).catch(() => undefined);
        }
    }
}

/** Claim distributed ownership of one scheduled-job invocation. */
export function withScheduledJobLease<T>(
    jobName: string,
    fn: () => Promise<T>,
    options: ScheduledJobLeaseOptions,
): Promise<ScheduledJobLeaseResult<T>> {
    return withScheduledJobLeaseCore(kv, jobName, fn, options);
}
