/*
 * rift-server: the rift quest's server calls and post-run claim. Server-
 * authoritative; the client never pays out. Kept out of the startup graph:
 * only WorldMap and a claim after a cleared rift ever need it.
 */
import { gameToast } from "../components/GameToast";
import type { Character } from "../types/character";

const CLAIM_RETRY_MS = 30_000;
const CLAIM_MAX_ATTEMPTS = 5;

export type RiftResponse = {
    ok?: boolean;
    reason?: string;
    /** Monotonic save token returned by the authoritative rift endpoint. */
    _saveVersion?: number;
    activeRiftQuest?: Character["activeRiftQuest"];
    ryo?: number;
    totalRyo?: number;
    fateShards?: number;
    totalFateShards?: number;
    boneCharms?: number;
    totalBoneCharms?: number;
    veils?: number;
    /** The server's counted items after the Veil was added. */
    itemStacks?: Character["itemStacks"];
    cooldownUntil?: number;
    firstClear?: boolean;
    firstClearAt?: number;
    completedRiftId?: string;
};

async function postRift(body: Record<string, unknown>): Promise<RiftResponse> {
    try {
        const res = await fetch("/api/sector/rift-quest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        return (await res.json()) as RiftResponse;
    } catch {
        return { ok: false, reason: "offline" };
    }
}

/** Seal the rift baseline + target sector (rejected if a rift is already active
 *  or on cooldown). */
export function acceptRift(playerName: string, riftId: string): Promise<RiftResponse> {
    return postRift({ action: "accept", playerName, riftId });
}
/** Complete: the server redeems the exact accepted-rift boss receipt and pays. */
export function completeRift(playerName: string, riftId: string): Promise<RiftResponse> {
    return postRift({ action: "complete", playerName, riftId });
}
/** Abandon the active rift. */
export function abandonRift(playerName: string): Promise<RiftResponse> {
    return postRift({ action: "abandon", playerName });
}

/**
 * Complete a rift run's quest server-side and mirror the reward locally.
 * Extracted from App.tsx (line-budget): `apply` is setCharacter (functional so
 * it composes with the shrine-clear bonus). The server matches the accepted
 * seal, Gate run, and boss-combat receipt, single-use + daily-capped; a
 * failed/duplicate call is a no-op.
 */
export async function completeRiftRun(
    playerName: string,
    riftId: string,
    apply: (updater: (prev: Character | null) => Character | null) => void,
    log: (msg: string) => void,
): Promise<RiftResponse> {
    const account = playerName.trim().toLowerCase();
    const belongsToAccount = (candidate: Character | null): candidate is Character =>
        candidate?.name.trim().toLowerCase() === account;
    const resp = await completeRift(playerName, riftId);
    if (!resp.ok) {
        // The old silent `return` ate a full boss-clear whenever the seal had
        // lapsed (7d TTL) or was lost in the cutover, and left activeRiftQuest set
        // — which blocks nextRift() forever. Now surface every outcome, and when the
        // server self-heals a stranded rift (reason "none") clear the local mirror
        // too so the roaming giver can offer a fresh rift.
        if (resp.reason === "none") {
            apply((prev) => belongsToAccount(prev) ? ({ ...prev, activeRiftQuest: null, riftQuestBossReceipt: null }) : prev);
            log("The rift's energy had already faded — this quest is cleared. A new rift can appear.");
        } else if (resp.reason === "incomplete") {
            log("The rift boss wasn't registered as defeated. Defeat the boss, then return.");
        } else if (resp.reason === "wrong-rift") {
            log("That victory belongs to a different rift. Return to the accepted rift shown in your quest record.");
        } else if (resp.reason === "proof-missing-retry") {
            log("That older run could not be tied safely to this rift. The accepted rift remains open and key-free; enter it again to retry.");
        } else if (resp.reason === "daily-cap") {
            log("You've claimed all your rift rewards for today. Come back tomorrow.");
        }
        return resp;
    }
    apply((prev) => belongsToAccount(prev) ? ({
        ...prev,
        // The server wrote the post-credit balance; adopt it rather than re-adding
        // the delta to a local balance that may already be stale.
        ryo: typeof resp.totalRyo === "number" ? resp.totalRyo : (prev.ryo ?? 0) + (resp.ryo ?? 0),
        fateShards: (prev.fateShards ?? 0) + (resp.fateShards ?? 0),
        boneCharms: (prev.boneCharms ?? 0) + (resp.boneCharms ?? 0),
        itemStacks: resp.itemStacks ?? prev.itemStacks,
        activeRiftQuest: null,
        riftQuestBossReceipt: null,
        riftCooldownUntil: resp.cooldownUntil ?? prev.riftCooldownUntil,
        ...(resp.firstClear && resp.completedRiftId ? {
            riftFirstClears: {
                ...(prev.riftFirstClears ?? {}),
                [resp.completedRiftId]: { at: resp.firstClearAt ?? Date.now() },
            },
        } : {}),
    }) : prev);
    const parts = [`${resp.ryo ?? 0} ryo`];
    if (resp.fateShards) parts.push(`${resp.fateShards} fate shard${resp.fateShards === 1 ? "" : "s"}`);
    if (resp.boneCharms) parts.push(`${resp.boneCharms} bone charm${resp.boneCharms === 1 ? "" : "s"}`);
    if (resp.veils) parts.push(`${resp.veils} Veil of the Hollow`);
    log(`Rift sealed. Quest reward: ${parts.join(", ")}.`);
    return resp;
}

/** True when a failed claim says nothing about the quest itself, so asking again can work. */
export function riftClaimShouldRetry(response: RiftResponse): boolean {
    return !response.ok && (response.reason === "offline" || response.reason === "run-open" || !response.reason);
}

/** Claims until the server answers or the attempts run out. Past the last
 *  attempt the receipt stays on the save, so the next load claims it. */
export async function runRiftClaim(
    playerName: string,
    riftId: string,
    apply: (updater: (prev: Character | null) => Character | null) => void,
    isCurrent: () => boolean,
): Promise<void> {
    for (let attempt = 1; attempt <= CLAIM_MAX_ATTEMPTS; attempt += 1) {
        if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, CLAIM_RETRY_MS));
        if (!isCurrent()) return;
        const response = await completeRiftRun(playerName, riftId, apply, (line) => gameToast(line, { kind: "info" }));
        if (!riftClaimShouldRetry(response)) return;
    }
}
