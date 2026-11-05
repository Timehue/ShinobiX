import { randomUUID } from 'node:crypto';
import { kv } from '../_storage.js';
import type { AuthRecord } from '../player-auth.js';
import type { AtomicSaveProof } from '../save/_commit-player-save.js';
import { alreadyHoldsKvLock } from '../_kv-lock-context.js';

export function validBountyOwnerId(value: unknown): value is string {
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** Creation requires the auth lease through commit; payment only asserts existing identity. */
export async function bountyOwnerProof(name: string, expectedId?: string): Promise<{ ownerId: string; proof: AtomicSaveProof } | null> {
    const key = `auth:${name}`;
    if (expectedId === undefined && !alreadyHoldsKvLock(key)) throw new Error('Bounty identity publication requires the auth lease');
    const auth = await kv.get<AuthRecord>(key);
    if (!auth || typeof auth !== 'object') return null;
    if (expectedId !== undefined && (!validBountyOwnerId(expectedId) || auth.bountyOwnerId !== expectedId)) return null;
    // An invalid pre-existing ID is not repaired into new ownership automatically.
    if (auth.bountyOwnerId !== undefined && !validBountyOwnerId(auth.bountyOwnerId)) return null;
    const ownerId = auth.bountyOwnerId ?? randomUUID();
    return { ownerId, proof: { key, expected: auth, value: { ...auth, bountyOwnerId: ownerId } } };
}
