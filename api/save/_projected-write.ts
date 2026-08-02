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
 * to mutatePlayerSave. Same commit semantics, plus the projection.
 */
import { kv } from '../_storage.js';
import { mergePreservingImages } from '../_utils.js';
import { syncCurrencyLedger } from '../_currency-ledger.js';

/**
 * Commit a versioned player record and project its currency slice.
 *
 * @param saveKey   `save:<name>` — the key being written.
 * @param next      the already-version-bumped record to commit.
 * @param previous  the record read at the start of the critical section; its
 *                  character is used to skip the projection entirely when the
 *                  write did not move currency.
 */
export async function writeSaveProjected(
    saveKey: string,
    next: Record<string, unknown>,
    previous: Record<string, unknown>,
): Promise<void> {
    await kv.set(saveKey, mergePreservingImages(next, previous));
    // Never allowed to fail the write it follows — see api/_currency-ledger.ts.
    await syncCurrencyLedger(
        saveKey.startsWith('save:') ? saveKey.slice('save:'.length) : saveKey,
        next,
        { previousCharacter: (previous.character ?? null) as Record<string, unknown> | null },
    );
}
