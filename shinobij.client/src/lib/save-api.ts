import type { PlayerSaveAcknowledgement, PlayerSaveSnapshot, SaveError } from '../../../shared/save-contract';

/** Lazy wire validation keeps save recovery code out of the initial shell. */
export async function readSaveAcknowledgement(raw: unknown): Promise<PlayerSaveAcknowledgement> {
    const { playerSaveAcknowledgementContract, deferredSaveContract } = await import('../../../shared/save-contract');
    const deferred = deferredSaveContract.safeParse(raw);
    if (deferred.success) throw new Error(`Save deferred by the server (${deferred.data.reason}). Your draft is still protected.`);
    const acknowledged = playerSaveAcknowledgementContract.safeParse(raw);
    if (!acknowledged.success) throw new Error('The save acknowledgement could not be confirmed. Your device draft is still available.');
    return acknowledged.data;
}

export async function readPlayerSaveSnapshot<TPayload extends Record<string, unknown> = Record<string, unknown>>(raw: unknown, accountName: string): Promise<TPayload & PlayerSaveSnapshot> {
    const { playerSaveSnapshotContract } = await import('../../../shared/save-contract');
    const snapshot = playerSaveSnapshotContract.parse(raw);
    const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9\-_]/g, '').slice(0, 32);
    if (key(snapshot.character.name) !== key(accountName)) throw new Error('The saved character belongs to another account.');
    // The contract owns the envelope/identity/version; game fields stay opaque
    // until the existing hydration and ownership code handles them.
    return snapshot as unknown as TPayload & PlayerSaveSnapshot;
}

export async function readSaveError(raw: unknown): Promise<SaveError | null> {
    const { saveErrorContract } = await import('../../../shared/save-contract');
    const result = saveErrorContract.safeParse(raw);
    return result.success ? result.data : null;
}
