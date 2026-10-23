import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { invalidateProcCache } from '../_proc-cache.js';
import { activityPurseMinutes, creditActivityPurse } from '../_activity-purse.js';
import type { CircuitAttempt, CircuitDiscipline, CircuitEvent, CircuitHistory, CircuitVictory } from '../../shared/dojo-circuit.js';
export const CIRCUIT_KEY = 'game:dojo-circuit:state';
export const CIRCUIT_ENABLED_KEY = 'game:dojo-circuit:enabled';
export type CircuitState = { event: CircuitEvent | null; attempts: Record<string, CircuitAttempt>; history: CircuitHistory[] };
export const readCircuit = async (): Promise<CircuitState> => (await kv.get<CircuitState>(CIRCUIT_KEY)) ?? { event: null, attempts: {}, history: [] };
/** Called only after a sealed Solo-PvE victory has settled, including no-payout spars. */
export async function recordCircuitCombatVictory(playerId: string, startedAt: number, finishedAt: number) {
    return recordCircuitVerifiedVictory(playerId, 'combat', startedAt, finishedAt);
}
/** Accepts only host-supplied terminal evidence; no public route exposes this operation. */
export function circuitVictoryFits(event: CircuitEvent, attempt: CircuitAttempt, startedAt: number, finishedAt: number) {
    return Number.isFinite(startedAt) && Number.isFinite(finishedAt)
        && startedAt >= Math.max(attempt.openedAt, event.startsAt)
        && finishedAt >= startedAt && finishedAt < Math.min(event.endsAt, event.endedAt ?? Infinity);
}
/** Card AI and paid companion hosts stage proof for the player's explicit check-in. */
export async function recordCircuitPendingVictory(playerId: string, discipline: 'cards' | 'pets', proof: CircuitVictory) {
    if (!proof.matchId) return;
    return recordCircuitVerifiedVictory(playerId, discipline, proof.startedAt, proof.finishedAt, proof);
}
export async function recordCircuitVerifiedVictory(playerId: string, discipline: CircuitDiscipline, startedAt: number, finishedAt: number, pendingProof?: CircuitVictory) {
    if (await kv.get<boolean>(CIRCUIT_ENABLED_KEY) !== true) return;
    await withKvLock(CIRCUIT_KEY, async () => {
        if (await kv.get<boolean>(CIRCUIT_ENABLED_KEY) !== true) return;
        const state = await readCircuit();
        const event = state.event;
        const attempt = state.attempts[`player:${playerId}`];
        const entrant = event?.entrants.find(e => e.id === playerId);
        if (!event || !entrant || attempt?.discipline !== discipline || !circuitVictoryFits(event, attempt, startedAt, finishedAt)) return;
        if (pendingProof) {
            if (attempt.verifiedVictory) return;
            attempt.verifiedVictory = pendingProof;
        } else {
            if (!entrant.seals.some(s => s.discipline === discipline)) {
                await creditCircuitSealPurse(playerId, event.id, discipline, startedAt, finishedAt);
                entrant.seals.push({ discipline, earnedAt: finishedAt });
            }
            delete state.attempts[`player:${playerId}`];
        }
        await kv.set(CIRCUIT_KEY, state);
    }, { failClosed: true });
}
/**
 * The seal purse (owner amendment A7): earning a seal pays 0.5 x A(L) per
 * active minute of the verified victory that earned it, at most once per
 * (event, discipline, player). Called under the Circuit lock just before the
 * seal is recorded; the credit is receipted in the save, so a seal write that
 * fails and is retried never pays twice. Best effort: a busy save pays
 * nothing rather than holding back the seal.
 */
export async function creditCircuitSealPurse(playerId: string, eventId: string, discipline: CircuitDiscipline, startedAt: number, finishedAt: number) {
    return creditActivityPurse({
        mode: 'dojo',
        playerSlug: playerId,
        outcomeId: `${eventId}:${discipline}`,
        startedAt,
        minutes: activityPurseMinutes(startedAt, finishedAt),
    });
}
/** A paused attempt cannot earn credit from activity played while the event was off. */
export async function setCircuitEnabled(enabled: boolean) {
    await withKvLock(CIRCUIT_KEY, async () => {
        if ((await kv.get<boolean>(CIRCUIT_ENABLED_KEY) === true) === enabled) return;
        const state = await readCircuit();
        if (Object.keys(state.attempts).length) await kv.set(CIRCUIT_KEY, { ...state, attempts: {} });
        await kv.set(CIRCUIT_ENABLED_KEY, enabled);
        invalidateProcCache('game-state:frame');
    }, { failClosed: true });
}
