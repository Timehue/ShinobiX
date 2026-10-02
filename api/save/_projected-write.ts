/*
 * The save write that keeps its side-cars in step.
 *
 * `mutatePlayerSave` / `writeVersionedPlayerSave` already project the currency
 * ledger (api/_currency-ledger.ts) after committing. Several settlement paths
 * predate that helper and hand-roll the same two lines instead:
 *
 *     await kv.set(saveKey, mergePreservingImages(next, record));
 *
 * which commits the blob but leaves the ledger behind — reported as `stale` by
 * `npm run ledger:audit`. Stale is benign (the blob is authoritative and the
 * projection carries the version it came from, so lag is self-describing), but
 * every stale writer is noise that makes a REAL divergence harder to spot, and
 * the currency read cutover is gated on that signal being clean.
 *
 * This is that pair of lines, in one place, for writers that cannot easily move
 * to mutatePlayerSave, plus the projection — and committed with compare-and-set
 * against the row read under the lock (see writeSaveProjected), not a plain set.
 */
import { isDeepStrictEqual } from 'node:util';
import { kv } from '../_storage.js';
import { mergePreservingImages } from '../_utils.js';
import { syncCurrencyLedger } from '../_currency-ledger.js';

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
 * Commit a versioned player record and project its currency slice.
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
 *                  character is used to skip the projection entirely when the
 *                  write did not move currency. Must be the exact stored row.
 */
export async function writeSaveProjected(
    saveKey: string,
    next: Record<string, unknown>,
    previous: Record<string, unknown>,
): Promise<void> {
    const intended = mergePreservingImages(next, previous);
    try {
        if (await kv.compareSet(saveKey, previous, intended) !== true) {
            throw new Error(PLAYER_SAVE_VERSION_CONFLICT);
        }
    } catch (error) {
        if (isPlayerSaveVersionConflict(error)) throw error;
        // A transport error can hide a write that did land (lost response).
        // Only a read-back of exactly what we meant to write proves that.
        const readback = await kv.get(saveKey).catch(() => null);
        if (!isDeepStrictEqual(readback, intended)) throw error;
    }
    // Never allowed to fail the write it follows — see api/_currency-ledger.ts.
    await syncCurrencyLedger(
        saveKey.startsWith('save:') ? saveKey.slice('save:'.length) : saveKey,
        next,
        { previousCharacter: (previous.character ?? null) as Record<string, unknown> | null },
    );
}
