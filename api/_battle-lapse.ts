/*
 * Lapse reconciliation (F08): terminalize a fight that its owner walked away
 * from, using the owning store's own evidence, and settle the consequences
 * that evidence permits.
 *
 * "Expired" used to mean "the row's storage TTL ran out": the fight vanished
 * untouched, so walking away was the one exit that cost nothing, and a late
 * client found "session not found" where its obligation had been. Every mode
 * now keeps its active row past the fight's GAMEPLAY expiry and treats that
 * expiry as a terminal event with a per-mode ruling:
 *
 *   • Solo-PvE  — the engine's own abandon rule (10% max-HP cost, loss, no
 *                 rewards), stamped at the moment the fight lapsed, then the
 *                 ordinary physical settlement (api/pve/_fight-outcome-settlement.ts)
 *                 writes the HP the player left with; a 0-HP actor was already
 *                 down when they left, which is evidence, not invention.
 *   • Towers    — the run is forfeit: enemy win, nothing paid, the entry fee
 *                 stays spent (no "confirmed-missing" compensation for a run
 *                 that was published and abandoned), leases released, each
 *                 human actor's evidenced HP settled as above.
 *   • PvP       — a duel nobody has touched for its whole session TTL is a
 *                 double walk-out: a draw (no admission, no rewards) whose
 *                 vitals settle exactly as any other terminal duel's do.
 *
 * Three callers reach this: the owner's own heartbeat (battle-authority.ts
 * reports the lapse it found), any read of the session by its mode, and the
 * scheduled sweep over the battle projections (api/cron/_battle-lapse-sweep.ts).
 * All three are idempotent: a lapse is terminalized under the session's lock,
 * fenced on the exact row it was derived from, and re-reading a terminal row
 * is a no-op. A projection that names a fight which is already terminal or
 * gone is retired here, so the sweep never re-reads a finished fight for the
 * rest of the projection's retention.
 *
 * The mode modules are imported lazily so the heartbeat's hot path does not
 * load three combat engines' worth of settlement code up front.
 */
import { safeName } from './_utils.js';
import type { LapsedBattle } from './_realtime/battle-projection.js';

export type LapseReconciliation = {
    kind: LapsedBattle['kind'];
    sessionId: string;
    transitioned: boolean;
    settled: boolean;
    error?: string;
};

type Outcome = Pick<LapseReconciliation, 'transitioned' | 'settled' | 'error'>;

// One in-flight reconciliation per session: the heartbeat fires once a second
// and the resolver caches its verdict, so without this a lapse would be retried
// on every beat until the projection cleared.
const inFlight = new Map<string, number>();
const IN_FLIGHT_MS = 60_000;

function claimLapse(sessionId: string, now: number): boolean {
    const until = inFlight.get(sessionId);
    if (until !== undefined && until > now) return false;
    inFlight.set(sessionId, now + IN_FLIGHT_MS);
    if (inFlight.size > 2_000) {
        for (const [id, expiry] of inFlight) if (expiry <= now) inFlight.delete(id);
    }
    return true;
}

export function resetLapseReconciliationForTests(): void {
    inFlight.clear();
}

/** A projection naming a fight that is over (or gone) is stale: retire it. */
async function retireStaleProjection(playerName: string | undefined, sessionId: string): Promise<void> {
    if (!playerName) return;
    const { retireBattleProjection, noteBattleEnded } = await import('./_realtime/battle-projection.js');
    const { kv } = await import('./_storage.js');
    if (await retireBattleProjection(kv, playerName, sessionId).catch(() => false)) noteBattleEnded(playerName);
}

export async function reconcileLapsedBattle(
    lapsed: LapsedBattle,
    playerName?: string,
    now: number = Date.now(),
): Promise<LapseReconciliation> {
    const base = { kind: lapsed.kind, sessionId: lapsed.sessionId };
    const claim = `${lapsed.kind}:${lapsed.sessionId}`;
    if (!claimLapse(claim, now)) {
        return { ...base, transitioned: false, settled: false, error: 'in-flight' };
    }
    try {
        if (lapsed.kind === 'solo-pve') return { ...base, ...(await reconcileSoloPve(lapsed.sessionId, playerName)) };
        if (lapsed.kind === 'tower') return { ...base, ...(await reconcileTower(lapsed.sessionId, playerName)) };
        return { ...base, ...(await reconcilePvp(lapsed.sessionId, playerName)) };
    } catch (err) {
        return { ...base, transitioned: false, settled: false, error: (err as Error)?.message ?? String(err) };
    } finally {
        inFlight.delete(claim);
    }
}

async function reconcileSoloPve(sessionId: string, playerName?: string): Promise<Outcome> {
    const { terminalizeLapsedSoloPveSession } = await import('./solo-pve/_abandon.js');
    const { settlePveFightOutcome } = await import('./pve/_fight-outcome-settlement.js');
    const result = await terminalizeLapsedSoloPveSession(sessionId);
    if (!result.ok) return { transitioned: false, settled: false, error: result.error };
    const session = result.session;
    if (!session) {
        // Gone from storage: nothing to prove, nothing to charge.
        await retireStaleProjection(playerName, sessionId);
        return { transitioned: false, settled: false };
    }
    if (session.status !== 'done') return { transitioned: false, settled: false };
    if (!result.transitioned) await retireStaleProjection(playerName, sessionId);
    // The physical consequence the client would have reported had it stayed:
    // receipt-idempotent, so a late /api/pve/fight-outcome replays harmlessly.
    const settled = await settlePveFightOutcome(session, safeName(session.ownerSlug));
    if (!settled.ok) return { transitioned: result.transitioned, settled: false, error: settled.error };
    return { transitioned: result.transitioned, settled: settled.applied === true };
}

async function reconcileTower(runId: string, playerName?: string): Promise<Outcome> {
    const { terminalizeLapsedTowerRun } = await import('./towers/_lapse.js');
    const result = await terminalizeLapsedTowerRun(runId);
    if (!result.ok) return { transitioned: false, settled: false, error: result.error };
    if (!result.session || result.session.status === 'done') {
        if (!result.transitioned) await retireStaleProjection(playerName, runId);
    }
    return { transitioned: result.transitioned, settled: result.settled };
}

async function reconcilePvp(battleId: string, playerName?: string): Promise<Outcome> {
    const { terminalizeLapsedPvpSession } = await import('./pvp/_lapse.js');
    const result = await terminalizeLapsedPvpSession(battleId);
    if (!result.ok) return { transitioned: false, settled: false, error: result.error };
    if (!result.session || result.session.status === 'done') {
        if (!result.transitioned) await retireStaleProjection(playerName, battleId);
    }
    return { transitioned: result.transitioned, settled: result.settled };
}
