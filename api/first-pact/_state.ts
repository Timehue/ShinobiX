import { kv } from "../_storage.js";
import { withKvLock } from "../_lock.js";
import {
    acceptStableQuest,
    advanceFirstPactMainBeat,
    createFirstPactProgress,
    normalizeFirstPactProgress,
    settleFirstPactTournamentEncounter,
    settleFirstPactMainEncounter,
    type FirstPactMainBeat,
    type FirstPactMainEncounterId,
    type FirstPactProgress,
    type FirstPactTournamentEncounterId,
    type FirstPactWorldPosition,
} from "../../shared/first-pact-contract.js";

const FIRST_PACT_STATE_TTL_SECONDS = 5 * 365 * 24 * 60 * 60;

export const firstPactStateKey = (playerName: string) => `first-pact:${playerName}`;

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
        const stored = await kv.get<unknown>(key);
        const current = stored == null
            ? createFirstPactProgress(now)
            : normalizeFirstPactProgress(stored, now);
        const next = normalizeFirstPactProgress(update(current), now);
        await kv.set(key, next, { ex: FIRST_PACT_STATE_TTL_SECONDS });
        return next;
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
    now = Date.now(),
): Promise<{ progress: FirstPactProgress; advanced: boolean }> {
    let advanced = false;
    const progress = await updateFirstPactProgress(playerName, (current) => {
        const result = advanceFirstPactMainBeat(current, beat, now);
        advanced = result.advanced;
        return result.progress;
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

export async function checkpointFirstPact(
    playerName: string,
    position: FirstPactWorldPosition,
    now = Date.now(),
): Promise<{ progress: FirstPactProgress; checkpointed: boolean }> {
    let checkpointed = false;
    const progress = await updateFirstPactProgress(playerName, (current) => {
        if (current.mainStep === "cross-the-threshold") return current;
        checkpointed = true;
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

export async function settleFirstPactMainBattle(
    playerName: string,
    encounterId: FirstPactMainEncounterId,
    outcome: "win" | "loss",
    proofId: string,
    now = Date.now(),
): Promise<{ progress: FirstPactProgress; advanced: boolean }> {
    let advanced = false;
    const progress = await updateFirstPactProgress(playerName, (current) => {
        const settled = settleFirstPactMainEncounter(current, encounterId, outcome, proofId, now);
        advanced = settled.advanced;
        return settled.progress;
    }, now);
    return { progress, advanced };
}
