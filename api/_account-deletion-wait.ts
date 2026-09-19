import { kv } from './_storage.js';

export const ACCOUNT_DELETION_WAIT_MS = 24 * 60 * 60 * 1000;

export function accountDeletionStatus(record: { deletionRequestedAt?: number } | null, now = Date.now()) {
    const requestedAt = Number.isSafeInteger(record?.deletionRequestedAt) && record!.deletionRequestedAt! > 0
        ? record!.deletionRequestedAt! : null;
    const availableAt = requestedAt === null ? null : requestedAt + ACCOUNT_DELETION_WAIT_MS;
    return { requestedAt, availableAt, serverNow: now, ready: availableAt !== null && now >= availableAt };
}

export class AccountDeletionWaitError extends Error {
    constructor() { super('Request account deletion in Settings and wait 24 hours before confirming.'); }
}

/** Call inside the save lock, before any teardown or deletion fence is written. */
export async function assertAccountDeletionReady(name: string): Promise<void> {
    const record = await kv.get<{ deletionRequestedAt?: number }>(`auth:${name}`);
    if (!accountDeletionStatus(record).ready) throw new AccountDeletionWaitError();
}
