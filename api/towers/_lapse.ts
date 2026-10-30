import { safeName } from '../_utils.js';
import {
    applyPveOutcomeBodyOnce,
    markPveOutcomeSettled,
    readPveOutcomeMarker,
    settlePveFightOutcome,
} from '../pve/_fight-outcome-settlement.js';
import type { AiFightSession } from '../missions/_ai-fight-outcome.js';
import { releaseTowerBattleLeases, towerBattleLeaseMembers } from './_battle-lease.js';
import { closeTowerPartyRun } from './_party.js';
import { withTowerSessionMutation, type TowerSessionLock } from './_session-mutation.js';
import { isPublicTowerRun, isSpireRun, isTowerRunLapsed, needsTowerLapseReconciliation, readSession, towerRunExpiresAt, writeSession } from './_tower-store.js';
import type { TowerSession } from './_tower-session.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { settleCaravanCombat, requireCaravan } from '../festival/_caravan.js';
import { settleConsumedItemsForMember } from './_tower-store.js';
import { applyCompanionUsageCost } from '../solo-pve/_settlement.js';

async function settleCaravanAmbushLapse(session: TowerSession, playerName: string): Promise<{ ok: boolean; applied?: boolean; error?: string }> {
    const binding = session.caravanAmbush;
    const actor = session.actors.find(candidate => candidate.side === 'squad' && candidate.ai === false && candidate.ownerSlug === playerName);
    if (!binding || !actor) return { ok: false, error: 'Caravan ambush proof is incomplete.' };
    await settleConsumedItemsForMember({ session, slug: playerName });
    // Written ONCE across this forfeit and the generic pve-outcome path, which
    // reads this Tower run too (see api/pve/_fight-outcome-settlement.ts).
    const markedSettled = await readPveOutcomeMarker(session, playerName);
    let bodyWritten = false;
    const result = await mutatePlayerSave(playerName, ({ character }) => {
        bodyWritten = false;
        const { run } = requireCaravan(character, binding.runId);
        if (!run.combat || run.combat.sessionId !== session.runId) return { ok: false as const, status: 409, error: 'Ambush binding changed.' };
        if (run.combat.settled) return { ok: true as const, character, value: false, write: false };
        const now = Date.now();
        const physical = applyPveOutcomeBodyOnce({
            character, session, playerName, now, outcome: 'forfeit', continuousVitals: true, markedSettled,
        });
        bodyWritten = physical.bodyWritten;
        const next = settleCaravanCombat(applyCompanionUsageCost(physical.character, session.companionUsage), session.runId, false, now);
        return { ok: true as const, character: next, value: true, write: true };
    });
    if (!result.ok) return { ok: false, error: result.error };
    if (bodyWritten) await markPveOutcomeSettled(session, playerName, Date.now());
    return { ok: true, applied: result.value };
}

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
 * client report replays harmlessly). The run seated them at FULL HP, so that
 * value can only lower their save's HP, never raise it (sessionSeedsFullHp).
 * An actor at 0 HP had already fallen inside the run; that admission is
 * evidence, not invention.
 *
 * Idempotent under the session lock and fenced on the exact row read; a run
 * that is live, normally completed, or gone is left exactly as found. Recorded
 * forfeits retry their consequences: saving the terminal row alone does not
 * prove that the separate player-save, party, and lease writes succeeded.
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

export const TOWER_FORFEIT_LOG_LINE = 'The run was forfeited.';

/**
 * A solo run its owner gives up on purpose. The same terminal shape as a lapse
 * (enemy win, nothing paid, settlement closed) with `lapsedAt` stamped at the
 * forfeit, so every reader that retries a lapse's receipt-idempotent
 * consequences (needsTowerLapseReconciliation) retries this run's too.
 */
export function forfeitedTowerSession(session: TowerSession, now: number): TowerSession {
    return {
        ...session,
        status: 'done',
        winner: 'enemy',
        rewardSettlementState: 'settled',
        lapsedAt: now,
        forfeitedAt: now,
        log: [...session.log, TOWER_FORFEIT_LOG_LINE],
    };
}

export type TowerForfeitRefusal = { status: 403 | 409; error: string };
export const TOWER_FORFEIT_SOLO_ONLY_ERROR = 'Only a solo Story or Spire run can be forfeited.';

/**
 * Why an ACTIVE run cannot be forfeited by this player, or null. Only a solo
 * Story/Spire run qualifies: a party run, a Clan Boss assault, a world boss
 * raid, a caravan ambush or a crisis fight has other members or another owner
 * whose outcome a lone forfeit must not decide. Those keep "leave the view"
 * and the lapse reconciler.
 */
export function towerForfeitRefusal(session: TowerSession, playerName: string): TowerForfeitRefusal | null {
    const slug = safeName(playerName);
    const humans = towerBattleLeaseMembers(session);
    if (!humans.includes(slug)) return { status: 403, error: 'Not a member of this run.' };
    const partyId = (session as TowerSession & { towerPartyId?: string }).towerPartyId;
    const solo = !partyId && humans.length === 1
        && !session.runId.startsWith('cboss-')
        && !session.worldBossEvent && !session.caravanAmbush && !session.worldCrisis80
        && (isPublicTowerRun(session) || isSpireRun(session));
    return solo ? null : { status: 409, error: TOWER_FORFEIT_SOLO_ONLY_ERROR };
}

/** Decide, under the session lock, whether an ACTIVE run becomes terminal now. */
type TowerTerminalTransition = (session: TowerSession, now: number) => TowerSession | null;

export async function terminalizeLapsedTowerRun(
    runId: string,
    deps: LapsedTowerDeps = {},
): Promise<LapsedTowerResult> {
    return terminalizeTowerRun(runId, deps, (session, now) => (isTowerRunLapsed(session, now) ? lapsedTowerSession(session) : null));
}

/**
 * Forfeit a solo run on its owner's request. `transitioned: false` with a
 * session means the run was already over (a replay, or a lapse that won the
 * race); a refusal names why the run cannot be forfeited at all.
 */
export async function forfeitTowerRun(
    runId: string,
    playerName: string,
    deps: LapsedTowerDeps = {},
): Promise<LapsedTowerResult> {
    const state: { refusal: TowerForfeitRefusal | null } = { refusal: null };
    const result = await terminalizeTowerRun(runId, deps, (session, now) => {
        if (session.status !== 'active') return null;
        state.refusal = towerForfeitRefusal(session, playerName);
        return state.refusal ? null : forfeitedTowerSession(session, now);
    });
    if (state.refusal) return { ok: false, ...state.refusal };
    return result;
}

async function terminalizeTowerRun(
    runId: string,
    deps: LapsedTowerDeps,
    transition: TowerTerminalTransition,
): Promise<LapsedTowerResult> {
    const read = deps.read ?? readSession;
    const write = deps.write ?? writeSession;
    const now = deps.now ?? Date.now;
    if (!runId) return { ok: false, status: 400, error: 'Missing tower run.' };

    const outcome = await withTowerSessionMutation(runId, async () => {
        const session = await read(runId);
        if (!session) return { session: null, transitioned: false };
        const next = transition(session, now());
        if (!next) return { session, transitioned: false };
        await write(next);
        return { session: next, transitioned: true };
    }, deps.lock);
    if (!outcome.session || !needsTowerLapseReconciliation(outcome.session, now())) {
        return { ok: true, session: outcome.session, transitioned: false, settled: false };
    }

    // Consequences run OUTSIDE the session lock: each is idempotent and owns
    // its own locking (leases and parties by member/party key, the physical
    // settlement by save key and in-save receipt).
    const session = outcome.session;
    let settled = false;
    const settle = deps.settle ?? (async (row: AiFightSession, playerName: string) => {
        const tower = row as unknown as TowerSession;
        if (tower.caravanAmbush) return settleCaravanAmbushLapse(tower, playerName);
        return settlePveFightOutcome(row, playerName);
    });
    try {
        for (const member of towerBattleLeaseMembers(session)) {
            const result = await settle(session, safeName(member));
            if (!result.ok) return { ok: false, status: 503, error: result.error ?? 'Tower outcome recovery is pending.' };
            if (result.applied) settled = true;
        }
        const partyId = (session as TowerSession & { towerPartyId?: string }).towerPartyId;
        if (partyId) await (deps.closeParty ?? closeTowerPartyRun)(partyId, runId);
        // Lease release also retires the sweep's battle projection. Keep that
        // retry trigger until player outcomes and party cleanup have succeeded.
        await (deps.releaseLeases ?? releaseTowerBattleLeases)(runId, towerBattleLeaseMembers(session));
    } catch (err) {
        console.warn('[towers/lapse] cleanup deferred', runId, (err as Error)?.message);
        return { ok: false, status: 503, error: 'Tower outcome recovery is pending.' };
    }
    return { ok: true, session, transitioned: outcome.transitioned, settled };
}
