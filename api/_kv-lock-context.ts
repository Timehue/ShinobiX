import { AsyncLocalStorage } from 'node:async_hooks';

export class LockOwnershipLostError extends Error {
    constructor(message = 'The operation no longer owns its storage lock. Retry from current state.') {
        super(message);
        this.name = 'LockOwnershipLostError';
    }
}

export type HeldKvLease = { key: string; owner: string; active: boolean };
export type KvLockContext = {
    leases: readonly HeldKvLease[];
    // Nested scopes share this poison: a failed/ambiguous guarded operation
    // cannot be caught and followed by writes through a fresh connection.
    health: { error?: Error };
};

const contexts = new AsyncLocalStorage<KvLockContext>();

export function currentKvLockContext(): KvLockContext | undefined {
    return contexts.getStore();
}

/** Trusted telemetry only: financial/credential/domain writes must stay fenced. */
export function withoutKvLeaseContext<T>(fn: () => T): T {
    return contexts.exit(fn);
}

export function assertKvLockContext(context = contexts.getStore()): void {
    if (!context) return;
    if (context.health.error) throw context.health.error;
    if (context.leases.some(lease => !lease.active)) {
        throw new LockOwnershipLostError('A completed lock callback cannot perform detached storage operations.');
    }
}

export function poisonKvLockContext(context: KvLockContext, error: unknown): Error {
    const failure = error instanceof Error ? error : new Error(String(error));
    context.health.error ??= failure;
    return context.health.error;
}

/** Reentrant acquisition uses the original owner; it never renews its lease. */
export function alreadyHoldsKvLock(target: string): boolean {
    const context = contexts.getStore();
    assertKvLockContext(context);
    return context?.leases.some(lease => lease.key === `lock:${target}`) ?? false;
}

export async function withKvLeaseContext<T>(key: string, owner: string, fn: () => Promise<T>): Promise<T> {
    const parent = contexts.getStore();
    assertKvLockContext(parent);
    const lease: HeldKvLease = { key, owner, active: true };
    const context: KvLockContext = {
        leases: [...(parent?.leases ?? []), lease].sort((a, b) => a.key.localeCompare(b.key)),
        health: parent?.health ?? {},
    };
    try {
        return await contexts.run(context, fn);
    } finally {
        lease.active = false;
    }
}
