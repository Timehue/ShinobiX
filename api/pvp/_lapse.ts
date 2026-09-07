import { kv as realKv, type KvLike } from '../_storage.js';
import { commitPvpSessionMutation } from './_session-mutation.js';
import { replayCommittedPvpTerminalEffects } from './_committed-terminal-effects.js';
import { isPvpSessionLapsed, pvpSessionLapsesAt } from './_lapse-rules.js';
import type { PvpSession } from './session.js';

export { isPvpSessionLapsed, pvpSessionLapsesAt, pvpSessionMayLapse, PVP_LAPSED_RETENTION_SECONDS } from './_lapse-rules.js';

/*
 * Lapsed PvP sessions (F08).
 *
 * A duel that nobody touches for a whole session TTL used to expire out of
 * storage untouched: no terminal row, no vitals settlement for a sector raid
 * that carried real HP, and two recovery pointers left naming a fight that no
 * longer existed. The row now outlives its gameplay expiry (_session-mutation.ts
 * keeps active rows for PVP_LAPSED_RETENTION_SECONDS past it) and the lapse
 * is recorded here as a DRAW — the only conclusion the evidence supports when
 * both fighters walked away: no winner, no admission, no rewards, and the
 * ordinary terminal replay (receipt, history, presence, pointers, and the
 * vitals each body actually carried out of the fight).
 *
 * A single absent fighter never reaches this: the present one's polls make
 * the server pass the lapsed turns and the forfeit is theirs to claim.
 *
 * Fenced on the exact row read (CAS), so a move landing meanwhile wins and
 * this becomes a no-op; a terminal or missing row is left as found.
 */

export const PVP_LAPSE_LOG_LINE = 'Both fighters left the field; the duel lapses as a draw.';

export type LapsedPvpDeps = {
    kv?: Pick<KvLike, 'get' | 'compareSet'>;
    now?: () => number;
    replayTerminal?: (session: PvpSession) => Promise<unknown>;
};

export type LapsedPvpResult =
    | { ok: true; session: PvpSession | null; transitioned: boolean; settled: boolean; error?: string }
    | { ok: false; status: number; error: string; retryable?: boolean };

export function lapsedPvpSession(session: PvpSession): PvpSession {
    const lapsedAt = pvpSessionLapsesAt(session);
    return {
        ...session,
        status: 'done',
        winner: 'draw',
        endedAt: lapsedAt,
        lapsedAt,
        log: [...session.log, PVP_LAPSE_LOG_LINE],
    };
}

export async function terminalizeLapsedPvpSession(
    battleId: string,
    deps: LapsedPvpDeps = {},
): Promise<LapsedPvpResult> {
    const store = deps.kv ?? realKv;
    const now = deps.now ?? Date.now;
    if (!battleId) return { ok: false, status: 400, error: 'Missing PvP battle.' };
    const key = `pvp:${battleId}`;
    const raw = await store.get<unknown>(key);
    const session = raw && typeof raw === 'object' && (raw as PvpSession).battleId === battleId ? raw as PvpSession : null;
    if (!session) return { ok: true, session: null, transitioned: false, settled: false };
    if (!isPvpSessionLapsed(session, now())) return { ok: true, session, transitioned: false, settled: false };

    const committed = await commitPvpSessionMutation(store, key, session, lapsedPvpSession(session));
    if (committed.status !== 'committed') {
        return { ok: false, status: 409, error: 'The duel changed while its lapse was being recorded.', retryable: true };
    }
    // The same terminal replay every finished duel runs: receipt, history,
    // presence, recovery pointers, and the carried vitals. Idempotent, and
    // retried by every later terminal reader — so a failure here (a storage
    // blip, or a row so old its recovery window is already behind it) leaves
    // the committed draw standing and is reported, never thrown.
    try {
        await (deps.replayTerminal ?? replayCommittedPvpTerminalEffects)(committed.session);
    } catch (err) {
        const error = (err as Error)?.message ?? String(err);
        console.warn('[pvp/lapse] terminal replay deferred', battleId, error);
        return { ok: true, session: committed.session, transitioned: true, settled: false, error };
    }
    return { ok: true, session: committed.session, transitioned: true, settled: true };
}
