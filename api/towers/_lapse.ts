import { safeName } from '../_utils.js';
import { settlePveFightOutcome } from '../pve/_fight-outcome-settlement.js';
import type { AiFightSession } from '../missions/_ai-fight-outcome.js';
import { releaseTowerBattleLeases, towerBattleLeaseMembers } from './_battle-lease.js';
import { closeTowerPartyRun } from './_party.js';
import { withTowerSessionMutation, type TowerSessionLock } from './_session-mutation.js';
import { isTowerRunLapsed, readSession, towerRunExpiresAt, writeSession } from './_tower-store.js';
import type { TowerSession } from './_tower-session.js';

/*
 * Lapsed Tower runs (F08).
 *
 * A run whose row simply expired out of storage used to leave no evidence at
 * all. `my-run` then read the still-live account lease against a MISSING
 * session, concluded the run had never been published, and — after the
 * publication grace — released the lease AND refunded the entry fee
 * (compensateConfirmedMissingTowerEntry). Closing the tab on a losing floor
 * was therefore a free retry with the fee handed back.
 *
 * The row now outlives its gameplay expiry (_tower-store.ts), and a lapse is
 * recorded here as what it is: a forfeit. Enemy win, nothing paid, reward
 * settlement closed, the entry fee spent, leases released, the party run
 * closed, and each human actor's HP settled at the value they walked away
 * with (api/pve/_fight-outcome-settlement.ts — receipt-idempotent, so a late
 * client report replays harmlessly). An actor at 0 HP had already fallen
 * inside the run; that admission is evidence, not invention.
 *
 * Idempotent under the session lock and fenced on the exact row read; a run
 * that is live, already terminal, or gone is left exactly as found.
 */

export type LapsedTowerDeps = {
    read?: (runId: string) => Promise<TowerSession | null>;
    write?: (session: TowerSession) => Promise<void>;
    lock?: TowerSessionLock;
    now?: () => number;
    settle?: (session: AiFightSession, playerName: string) => Promise<{ ok: boolean; applied?: boolean; error?: string }>;
    releaseLeases?: (runId: string, members: readonly string[]) => Promise<void>;
    closeParty?: (partyId: string, runId: string) => Promise<unknown>;
};

export type LapsedTowerResult =
    | { ok: true; session: TowerSession | null; transitioned: boolean; settled: boolean }
    | { ok: false; status: number; error: string };

export const TOWER_LAPSE_LOG_LINE = 'The run lapsed unattended and is forfeit.';

export function lapsedTowerSession(session: TowerSession): TowerSession {
    return {
        ...session,
        status: 'done',
        winner: 'enemy',
        rewardSettlementState: 'settled',
        lapsedAt: towerRunExpiresAt(session),
        log: [...session.log, TOWER_LAPSE_LOG_LINE],
    };
}

export async function terminalizeLapsedTowerRun(
    runId: string,
    deps: LapsedTowerDeps = {},
): Promise<LapsedTowerResult> {
    const read = deps.read ?? readSession;
    const write = deps.write ?? writeSession;
    const now = deps.now ?? Date.now;
    if (!runId) return { ok: false, status: 400, error: 'Missing tower run.' };

    const outcome = await withTowerSessionMutation(runId, async () => {
        const session = await read(runId);
        if (!session) return { session: null, transitioned: false };
        if (!isTowerRunLapsed(session, now())) return { session, transitioned: false };
        const next = lapsedTowerSession(session);
        await write(next);
        return { session: next, transitioned: true };
    }, deps.lock);
    if (!outcome.session || !outcome.transitioned) return { ok: true, session: outcome.session, transitioned: false, settled: false };

    // Consequences run OUTSIDE the session lock: each is idempotent and owns
    // its own locking (leases and parties by member/party key, the physical
    // settlement by save key and in-save receipt).
    const session = outcome.session;
    const members = towerBattleLeaseMembers(session);
    await (deps.releaseLeases ?? releaseTowerBattleLeases)(runId, members).catch((err) => {
        console.warn('[towers/lapse] lease release deferred', runId, (err as Error)?.message);
    });
    const partyId = (session as TowerSession & { towerPartyId?: string }).towerPartyId;
    if (partyId) {
        await (deps.closeParty ?? closeTowerPartyRun)(partyId, runId).catch((err) => {
            console.warn('[towers/lapse] party close deferred', runId, (err as Error)?.message);
        });
    }
    let settled = false;
    const settle = deps.settle ?? settlePveFightOutcome;
    for (const actor of session.actors) {
        if (actor.side !== 'squad' || actor.ai !== false || !actor.ownerSlug) continue;
        const result = await settle(session, safeName(actor.ownerSlug));
        if (result.ok && result.applied) settled = true;
        else if (!result.ok) console.warn('[towers/lapse] physical settlement deferred', runId, actor.ownerSlug, result.error);
    }
    return { ok: true, session, transitioned: true, settled };
}
