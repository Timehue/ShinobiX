/**
 * A run's battle that was walked away from still counts.
 *
 * Orin's Exhibition, an Unbroken attempt and the Standing Court all turn on the
 * first loss (the Court sends the player back to its first sitting). A player who
 * closed the tab on a losing fight and started the round again would dodge
 * that, so each run battle leaves a pointer here when it starts. The next run
 * action (another start, a fresh draft, a new or withdrawn attempt) settles the
 * pointed-at battle first: by its own result if it finished, and as a loss if
 * it did not. Settlement is idempotent by proof, so a battle that was already
 * claimed the normal way settles to nothing.
 */
import { kv } from "../_storage.js";
import type { Pet } from "../_pet-sim/pet-types.js";
import { firstPactExhibitionRound, firstPactStandingCourtRound, type FirstPactReplaySettings } from "../../shared/first-pact-contract.js";
import { settleExhibitionBattle } from "./_exhibition.js";
import { settleFirstPactReplayBattle, settleFirstPactStandingCourtBattle } from "./_state.js";

/** Outlives the 45-minute showdown session, so an expired fight still settles. */
const PENDING_RUN_BATTLE_TTL_SECONDS = 30 * 24 * 60 * 60;

export type PendingRunBattle = {
    sessionId: string;
    encounterId: string;
    exhibitionRunId?: string;
    exhibitionOpponents?: Pet[];
    replay?: FirstPactReplaySettings;
};

export const pendingRunBattleKey = (playerName: string) => `first-pact-run-battle:${playerName}`;
const showdownSessionKey = (playerName: string, sessionId: string) => `pet:showdown:${playerName}:${sessionId}`;

/** Only Exhibition rounds, Unbroken attempts and Standing Court sittings are runs a loss can end. */
export function isRunBattle(battle: Omit<PendingRunBattle, "sessionId">): boolean {
    return (!!battle.exhibitionRunId && !!firstPactExhibitionRound(battle.encounterId))
        || battle.replay?.unbroken === true
        || (!battle.replay && !!firstPactStandingCourtRound(battle.encounterId));
}

export async function recordPendingRunBattle(playerName: string, battle: PendingRunBattle): Promise<void> {
    await kv.set(pendingRunBattleKey(playerName), battle, { ex: PENDING_RUN_BATTLE_TTL_SECONDS });
}

/** Drop the pointer once its battle settled the normal way. */
export async function clearPendingRunBattle(playerName: string, sessionId: string): Promise<void> {
    const pending = await kv.get<PendingRunBattle>(pendingRunBattleKey(playerName));
    if (pending?.sessionId === sessionId) await kv.del(pendingRunBattleKey(playerName));
}

/** Said when a refusal follows from a run fight that was just settled as a loss. */
export const PENDING_RUN_LOSS_NOTE = "Your last run fight was left unfinished, so it counted as a loss.";

/**
 * Settle the run battle left behind, if any. Safe to call before every run
 * action. Returns the outcome it settled, or null when nothing was pending.
 */
export async function settlePendingRunBattle(playerName: string): Promise<"win" | "loss" | null> {
    const pending = await kv.get<PendingRunBattle>(pendingRunBattleKey(playerName));
    if (!pending || typeof pending.sessionId !== "string" || typeof pending.encounterId !== "string") return null;
    const sessionKey = showdownSessionKey(playerName, pending.sessionId);
    const session = await kv.get<{ finished?: boolean; outcome?: "win" | "loss" }>(sessionKey);
    const outcome = session?.finished && session.outcome ? session.outcome : "loss";
    const proof = `showdown:${pending.sessionId}`;
    const round = firstPactExhibitionRound(pending.encounterId);
    if (round && pending.exhibitionRunId) {
        await settleExhibitionBattle(playerName, pending.exhibitionRunId, round.id, outcome, proof, pending.exhibitionOpponents ?? []);
    } else if (pending.replay?.unbroken) {
        await settleFirstPactReplayBattle(playerName, pending.encounterId, pending.replay, outcome, proof);
    } else if (!pending.replay) {
        const sitting = firstPactStandingCourtRound(pending.encounterId);
        if (sitting) await settleFirstPactStandingCourtBattle(playerName, sitting.id, outcome, proof);
    }
    // Decided now, so an unfinished fight can no longer be played on and claimed.
    if (session && !session.finished) await kv.del(sessionKey);
    await clearPendingRunBattle(playerName, pending.sessionId);
    return outcome;
}
