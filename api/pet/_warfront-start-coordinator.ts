import { randomUUID } from 'node:crypto';
import type { KvLike } from '../_storage.js';

const WARFRONT_INITIALIZING_PREFIX = 'pet:warfront-initializing:';

export type WarfrontStartCoordination<T> =
    | { status: 'initialized'; value: T }
    | { status: 'resumed'; value: T }
    | { status: 'busy' };

export type WarfrontStartCoordinationOptions = {
    /** Crash-recovery lease. Must exceed the route's worst-case simulation time. */
    leaseTtlSeconds: number;
    /** How long a concurrent request waits for the lease owner to publish. */
    waitForPublishedMs: number;
    /** First/maximum delay for bounded exponential publication polling. */
    pollIntervalMs?: number;
    maxPollIntervalMs?: number;
};

export function warfrontInitializingKey(playerName: string): string {
    return `${WARFRONT_INITIALIZING_PREFIX}${playerName.trim().toLowerCase()}`;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Serialize the expensive full Warfront simulation across processes.
 *
 * The active battle is checked both before and after the NX lease. A losing
 * concurrent request never simulates: it waits briefly for the owner to publish
 * and then resumes that exact seal. Storage errors fail closed before `initialize`
 * can run, and compare-and-delete prevents a stale owner from deleting a newer
 * lease after TTL expiry.
 */
export async function coordinateWarfrontStart<T>(
    store: Pick<KvLike, 'set' | 'delIfEqual'>,
    playerName: string,
    readPublished: () => Promise<T | null>,
    initialize: () => Promise<T>,
    options: WarfrontStartCoordinationOptions,
): Promise<WarfrontStartCoordination<T>> {
    if (!playerName.trim()) throw new Error('Warfront initialization requires a player name.');
    if (!Number.isSafeInteger(options.leaseTtlSeconds) || options.leaseTtlSeconds < 1) {
        throw new Error(`Invalid Warfront initialization lease TTL: ${options.leaseTtlSeconds}`);
    }
    if (!Number.isSafeInteger(options.waitForPublishedMs) || options.waitForPublishedMs < 0) {
        throw new Error(`Invalid Warfront publication wait: ${options.waitForPublishedMs}`);
    }
    const pollIntervalMs = options.pollIntervalMs ?? 25;
    if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1) {
        throw new Error(`Invalid Warfront publication poll interval: ${pollIntervalMs}`);
    }
    const maxPollIntervalMs = options.maxPollIntervalMs ?? 1_000;
    if (!Number.isSafeInteger(maxPollIntervalMs) || maxPollIntervalMs < pollIntervalMs) {
        throw new Error(`Invalid Warfront maximum publication poll interval: ${maxPollIntervalMs}`);
    }

    const published = await readPublished();
    if (published) return { status: 'resumed', value: published };

    const key = warfrontInitializingKey(playerName);
    const ownerToken = randomUUID();
    const acquired = await store.set(key, ownerToken, {
        nx: true,
        ex: options.leaseTtlSeconds,
    });

    if (acquired !== 'OK') {
        const deadline = Date.now() + options.waitForPublishedMs;
        let nextPollMs = pollIntervalMs;
        do {
            const concurrent = await readPublished();
            if (concurrent) return { status: 'resumed', value: concurrent };
            if (Date.now() >= deadline) break;
            await delay(Math.min(nextPollMs, Math.max(1, deadline - Date.now())));
            nextPollMs = Math.min(maxPollIntervalMs, nextPollMs * 2);
        } while (true);
        return { status: 'busy' };
    }

    try {
        // Load-bearing second check: an active seal may have appeared between
        // the optimistic read and this request's successful lease claim.
        const raced = await readPublished();
        if (raced) return { status: 'resumed', value: raced };
        return { status: 'initialized', value: await initialize() };
    } finally {
        await store.delIfEqual(key, ownerToken).catch(() => undefined);
    }
}
