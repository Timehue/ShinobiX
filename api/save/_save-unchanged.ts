/*
 * The read-back an `onUnconfirmedWrite` hook (api/save/_mutate-player-save.ts)
 * uses to decide whether its save write can have landed.
 *
 * A write that threw and could not be confirmed either landed (its
 * acknowledgement was lost) or did not. A decision that spent something OUTSIDE
 * the save ahead of the write (a daily slot, a cooldown, a claim, a token) may
 * hand it back only when the write provably did not land, because handing back
 * a claim whose payout DID land lets the player claim it again.
 *
 * Every save write bumps `_saveVersion`, and the caller holds the save lock, so
 * a stored save still at the version the decision read cannot hold the write.
 * Anything else answers false: a moved version, a missing row, an unreadable
 * store. An inconclusive read keeps the outside write, never hands it back.
 */
export async function saveUnchangedSince(saveKey: string, read: { _saveVersion?: unknown }): Promise<boolean> {
    try {
        const { kv } = await import('../_storage.js');
        const stored = await kv.get<Record<string, unknown>>(saveKey);
        return Boolean(stored) && Number(stored!._saveVersion ?? 0) === Number(read._saveVersion ?? 0);
    } catch {
        return false;
    }
}
