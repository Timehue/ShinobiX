import { kv } from "../_storage.js";
import { withKvLock } from "../_lock.js";
import {
    acceptStableQuest,
    recordFirstPactLatticeCompanions,
    recordFirstPactCompanionNames,
    enterFirstPactFinding,
    settleFirstPactStandingCourtRound,
    advanceFirstPactMainBeat,
    createFirstPactProgress,
    normalizeFirstPactProgress,
    settleFirstPactTournamentEncounter,
    settleFirstPactMainEncounter,
    settleFirstPactWritEncounter,
    visitFirstPactAftermath,
    type FirstPactAftermathId,
    type FirstPactMainBeat,
    type FirstPactMainEncounterId,
    type FirstPactProgress,
    type FirstPactTournamentEncounterId,
    type FirstPactWorldPosition,
} from "../../shared/first-pact-contract.js";

const FIRST_PACT_STATE_TTL_SECONDS = 5 * 365 * 24 * 60 * 60;

export const firstPactStateKey = (playerName: string) => `first-pact:${playerName}`;
export const standingCourtReceiptKey = (playerName: string, proofId: string) =>
    `first-pact-standing-receipt:${playerName}:${proofId}`;

export async function readFirstPactProgress(playerName: string, now = Date.now()): Promise<FirstPactProgress> {
    const stored = await kv.get<unknown>(firstPactStateKey(playerName));
    return normalizeFirstPactProgress(stored, now);
}

export async function updateFirstPactProgress(
    playerName: string,
    update: (current: FirstPactProgress) => FirstPactProgress,
    now = Date.now(),
): Promise<FirstPactProgress> {
    const key = firstPactStateKey(playerName);
    return withKvLock(key, async () => {
        // A delayed request can outlive the lock lease. Rebase a rejected CAS
        // on the latest progress so checkpoints and other mutations preserve
        // a Standing Court reward/proof committed by the next lock holder.
        // Retry only a definite rejection: a thrown write may have committed,
        // so leave recovery to the operation's normal idempotent retry path.
        for (let attempt = 0; attempt < 5; attempt++) {
            const stored = await kv.get<unknown>(key);
            const current = stored == null
                ? createFirstPactProgress(now)
                : normalizeFirstPactProgress(stored, now);
            const next = normalizeFirstPactProgress(update(current), now);
            if (await kv.compareSet(key, stored, next, { ex: FIRST_PACT_STATE_TTL_SECONDS })) {
                return next;
            }
        }
        throw new Error('first-pact-progress-conflict');
    }, { failClosed: true });
}

export function enterFirstPact(playerName: string, now = Date.now()): Promise<FirstPactProgress> {
    return updateFirstPactProgress(playerName, (current) => ({
        ...current,
        lastVisitedAt: now,
        mainStep: current.mainStep === "cross-the-threshold" ? "meet-scribe-vey" : current.mainStep,
        flags: [...new Set([...current.flags, "crossed-celestial-threshold"])],
    }), now);
}

export async function advanceFirstPactMain(
    playerName: string,
    beat: FirstPactMainBeat,
    pets: readonly { id?: unknown; name?: unknown; nickname?: unknown }[] = [],
    now = Date.now(),
): Promise<{ progress: FirstPactProgress; advanced: boolean }> {
    let advanced = false;
    const progress = await updateFirstPactProgress(playerName, (current) => {
        const result = advanceFirstPactMainBeat(current, beat, now);
        advanced = result.advanced;
        return result.advanced && beat.startsWith("forge-first-pact-")
            ? recordFirstPactCompanionNames(result.progress, pets)
            : result.progress;
    }, now);
    return { progress, advanced };
}

export async function acceptFirstPactStableQuest(
    playerName: string,
    now = Date.now(),
): Promise<{ progress: FirstPactProgress; accepted: boolean }> {
    let accepted = false;
    const progress = await updateFirstPactProgress(playerName, (current) => {
        const next = acceptStableQuest(current, now);
        accepted = next !== current;
        return next;
    }, now);
    return { progress, accepted };
}

/**
 * Spend Court Standing to enter one answered writ's finding into the record.
 *
 * The browser sends a writ id and nothing else. Price, the reserve that keeps
 * the Balancing gate reachable, and whether that writ was ever answered are all
 * re-derived here from the STORED progress, so a client that lies about its
 * standing buys nothing.
 */
export async function enterFirstPactFindingForPlayer(
    playerName: string,
    writId: string,
    now = Date.now(),
): Promise<{ progress: FirstPactProgress; entered: boolean }> {
    let entered = false;
    const progress = await updateFirstPactProgress(playerName, (current) => {
        const next = enterFirstPactFinding(current, writId, now).progress;
        entered = next !== current;
        return next;
    }, now);
    return { progress, entered };
}

export async function visitFirstPactAftermathForPlayer(
    playerName: string,
    aftermathId: FirstPactAftermathId,
    now = Date.now(),
): Promise<{ progress: FirstPactProgress; visited: boolean; replayed: boolean }> {
    let visited = false;
    let replayed = false;
    const progress = await updateFirstPactProgress(playerName, (current) => {
        const result = visitFirstPactAftermath(current, aftermathId, now);
        visited = result.visited;
        replayed = result.replayed;
        return result.progress;
    }, now);
    return { progress, visited, replayed };
}

/**
 * Settle one sitting of the Standing Court rerun.
 *
 * The only First Pact settlement where a LOSS writes: it ends the run. Passing
 * the outcome straight through is the point, not an oversight.
 */
export async function settleFirstPactStandingCourtBattle(
    playerName: string,
    roundId: string,
    outcome: 'win' | 'loss',
    proofId: string,
    now = Date.now(),
): Promise<{ progress: FirstPactProgress; advanced: boolean }> {
    const key = firstPactStateKey(playerName);
    return withKvLock(key, async () => {
        const stored = await kv.get<unknown>(key);
        const current = normalizeFirstPactProgress(stored, now);
        const safeProof = String(proofId).slice(0, 96);
        if (safeProof && await kv.get(standingCourtReceiptKey(playerName, safeProof))) {
            return { progress: current, advanced: false };
        }
        const settled = settleFirstPactStandingCourtRound(current, roundId, outcome, proofId, now);
        if (!settled.advanced) return settled;

        // The progress write contains the new proof and its reward together.
        // Before its short history drops an ALREADY applied proof, preserve
        // that proof permanently. A failed archive leaves it in the progress
        // record, so retries cannot either repay it or lose an unpaid reward.
        // This also works when the progress write commits but its reply is lost.
        const next = normalizeFirstPactProgress(settled.progress, now);
        for (const oldProof of current.standingCourt.battleProofs) {
            if (!next.standingCourt.battleProofs.includes(oldProof)) {
                await kv.set(standingCourtReceiptKey(playerName, oldProof), { applied: true });
            }
        }
        if (!await kv.compareSet(key, stored, next, { ex: FIRST_PACT_STATE_TTL_SECONDS })) {
            throw new Error('first-pact-standing-settlement-conflict');
        }
        return { progress: next, advanced: true };
    }, { failClosed: true });
}

export async function checkpointFirstPact(
    playerName: string,
    position: FirstPactWorldPosition,
    now = Date.now(),
): Promise<{ progress: FirstPactProgress; checkpointed: boolean }> {
    let checkpointed = false;
    const progress = await updateFirstPactProgress(playerName, (current) => {
        checkpointed = current.mainStep !== "cross-the-threshold";
        if (!checkpointed) return current;
        return {
            ...current,
            lastVisitedAt: now,
            lastPosition: position,
        };
    }, now);
    return { progress, checkpointed };
}

export async function settleFirstPactTournamentBattle(
    playerName: string,
    encounterId: FirstPactTournamentEncounterId,
    outcome: "win" | "loss",
    proofId: string,
    now = Date.now(),
): Promise<{ progress: FirstPactProgress; advanced: boolean }> {
    let advanced = false;
    const progress = await updateFirstPactProgress(playerName, (current) => {
        const settled = settleFirstPactTournamentEncounter(current, encounterId, outcome, proofId, now);
        advanced = settled.advanced;
        return settled.progress;
    }, now);
    return { progress, advanced };
}

export async function settleFirstPactWritBattle(
    playerName: string,
    writId: string,
    outcome: "win" | "loss",
    proofId: string,
    now = Date.now(),
): Promise<{ progress: FirstPactProgress; advanced: boolean }> {
    let advanced = false;
    const progress = await updateFirstPactProgress(playerName, (current) => {
        const settled = settleFirstPactWritEncounter(current, writId, outcome, proofId, now);
        advanced = settled.advanced;
        return settled.progress;
    }, now);
    return { progress, advanced };
}

export async function settleFirstPactMainBattle(
    playerName: string,
    encounterId: FirstPactMainEncounterId,
    outcome: "win" | "loss",
    proofId: string,
    companionIds: readonly string[] = [],
    now = Date.now(),
): Promise<{ progress: FirstPactProgress; advanced: boolean }> {
    let advanced = false;
    const progress = await updateFirstPactProgress(playerName, (current) => {
        const settled = settleFirstPactMainEncounter(current, encounterId, outcome, proofId, now);
        advanced = settled.advanced;
        return settled.advanced && encounterId === "lattice-guardian"
            ? recordFirstPactLatticeCompanions(settled.progress, companionIds)
            : settled.progress;
    }, now);
    return { progress, advanced };
}
