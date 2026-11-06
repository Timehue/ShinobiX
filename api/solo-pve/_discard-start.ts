import { withoutKvLeaseContext } from '../_kv-lock-context.js';
import { kv as realKv } from '../_storage.js';
import { noteBattleEnded, retireBattleProjection, type BattleProjectionStore } from '../_realtime/battle-projection.js';
import { soloPveSessionKey } from './_store.js';

/*
 * Undo a fight start that wrote its solo-PvE session and then failed or was
 * refused before the player could reach the fight.
 *
 * writeSoloPveSession does more than store the row. It publishes the
 * `battle-state:<player>` projection and marks the player in battle in memory,
 * and the heartbeat then proves "fighting" from that projection: travel and
 * every other fight are refused. A start that leaves the row behind with no
 * pointer to resume it leaves the player in a fight they cannot see or leave
 * until it lapses (30 min). That happened live on 2026-11-06.
 *
 * Runs OUTSIDE the caller's storage lock context. A failed write inside a lock
 * poisons that context, and every later write through it throws, so a cleanup
 * through it was refused and swallowed in exactly the case it exists for.
 * Nothing here can overwrite another holder's work:
 *   - `keys` must be keys this attempt minted under fresh random ids;
 *   - `ifEqual` keys (a per-player pointer) are deleted only while they still
 *     hold the exact value this attempt read;
 *   - the projection is retired only while it still names this session.
 * Best-effort throughout: the lapse sweep remains the backstop.
 */

type DiscardStore = BattleProjectionStore & {
    del(...keys: string[]): Promise<unknown>;
    delIfEqual(key: string, expected: unknown): Promise<boolean>;
};

export type DiscardFailedStartInput = {
    playerName: string;
    /** The session this attempt wrote, if it got that far. */
    sessionId?: string;
    /** Other keys minted by this attempt alone (binding, token, run). */
    keys?: string[];
    /** Shared keys to delete only if they still hold the value this attempt read. */
    ifEqual?: Array<{ key: string; value: unknown }>;
};

export function discardFailedStart(
    input: DiscardFailedStartInput,
    deps: { store?: DiscardStore; noteEnded?: (playerName: string) => void } = {},
): Promise<void> {
    const store = deps.store ?? realKv;
    return withoutKvLeaseContext(async () => {
        const keys = [...(input.keys ?? []), ...(input.sessionId ? [soloPveSessionKey(input.sessionId)] : [])];
        if (keys.length > 0) await store.del(...keys).catch(() => undefined);
        for (const { key, value } of input.ifEqual ?? []) {
            if (value !== null && value !== undefined) await store.delIfEqual(key, value).catch(() => false);
        }
        if (!input.sessionId) return;
        const retired = await retireBattleProjection(store, input.playerName, input.sessionId).catch(() => false);
        // Only when the projection was this fight's: a newer fight keeps its flag.
        if (retired) (deps.noteEnded ?? noteBattleEnded)(input.playerName);
    });
}
