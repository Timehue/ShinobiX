/*
 * The save write that keeps its side-cars in step.
 *
 * `mutatePlayerSave` / `writeVersionedPlayerSave` commit the currency ledger
 * (api/_currency-ledger.ts) in the same transaction as the save. Several
 * settlement paths predate that helper and hand-roll the same two lines instead:
 *
 *     await kv.set(saveKey, mergePreservingImages(next, record));
 *
 * which commits the blob but leaves the ledger behind — counted as
 * `ledger-lagging-different` on the next money write. Lag is benign (the save
 * still carries the right balances), but every such writer is noise that makes
 * a REAL divergence harder to spot, and the fail-closed step is gated on that
 * signal being clean.
 *
 * This is that pair of lines, in one place, for writers that cannot easily move
 * to mutatePlayerSave — committed with compare-and-set against the row read
 * under the lock (see writeSaveProjected), not a plain set, and with the ledger
 * row in the same transaction (commitPlayerSaveRecord).
 */
import { kv } from '../_storage.js';
import { storedValueEquals } from '../_stored-value.js';
import { mergePreservingImages } from '../_utils.js';
import { commitPlayerSaveRecord } from './_commit-player-save.js';

/** Thrown when another writer committed the save after `previous` was read. */
export const PLAYER_SAVE_VERSION_CONFLICT = 'player-save-version-conflict';

export function isPlayerSaveVersionConflict(error: unknown): boolean {
    return error instanceof Error && error.message === PLAYER_SAVE_VERSION_CONFLICT;
}

/**
 * Run a locked read-modify-write again when its commit lost the race.
 *
 * Wrap the WHOLE `withKvLock(...)` call, never just the write: the re-run must
 * re-read the save and recompute from it. That is only safe for blocks whose
 * result is keyed by a receipt or reservation (so a recompute cannot pay or
 * charge twice) and that do nothing outside the save before their write.
 */
export async function retryOnSaveVersionConflict<T>(run: () => Promise<T>, attempts = 2): Promise<T> {
    for (let attempt = 1; ; attempt++) {
        try {
            return await run();
        } catch (error) {
            if (attempt >= attempts || !isPlayerSaveVersionConflict(error)) throw error;
        }
    }
}

/** The retryable reply for a commit that lost its race twice. Nothing was written. */
export const SAVE_VERSION_CONFLICT_REPLY = {
    error: 'Your save changed while this was being recorded. Please try again.',
    errorCode: 'save-version-conflict',
    retryable: true,
} as const;

/**
 * Commit a versioned player record, and its currency ledger row in the same
 * transaction when the write moves currency.
 *
 * Commits with compare-and-set against `previous`, exactly like
 * writeVersionedPlayerSaveWithStore. Every caller holds withKvLock on the save,
 * but that lock's TTL (5s) is not renewed and a pool wait can reach 15s under
 * load, so a stalled holder can outlive it while another writer commits. A plain
 * set would then silently overwrite that commit (a reward, a claim receipt).
 * Instead this throws PLAYER_SAVE_VERSION_CONFLICT and writes nothing, so the
 * caller can answer with a retryable error — nothing was paid or charged.
 *
 * @param saveKey   `save:<name>` — the key being written.
 * @param next      the already-version-bumped record to commit.
 * @param previous  the record read at the start of the critical section; its
 *                  character is used to skip the ledger entirely when the
 *                  write did not move currency. Must be the exact stored row.
 */
export async function writeSaveProjected(
    saveKey: string,
    next: Record<string, unknown>,
    previous: Record<string, unknown>,
): Promise<void> {
    const intended = mergePreservingImages(next, previous);
    try {
        const committed = await commitPlayerSaveRecord(kv, {
            playerName: saveKey.startsWith('save:') ? saveKey.slice('save:'.length) : saveKey,
            saveKey,
            expected: previous,
            intended: intended as Record<string, unknown>,
        });
        if (committed !== true) throw new Error(PLAYER_SAVE_VERSION_CONFLICT);
    } catch (error) {
        if (isPlayerSaveVersionConflict(error)) throw error;
        // A transport error can hide a write that did land (lost response).
        // Only a read-back of exactly what we meant to write proves that; the
        // ledger row, when there was one, committed in the same transaction.
        const readback = await kv.get(saveKey).catch(() => null);
        if (!storedValueEquals(readback, intended)) throw error;
    }
}
