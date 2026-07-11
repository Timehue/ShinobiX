/*
 * rift-run: the data-free run-config + server-call helpers for Hollow Gate rifts.
 *
 * Split out of lib/hollow-rifts.ts so the App entry bundle (which needs only
 * riftEventConfig + completeRiftRun) does NOT pull the rift CONTENT catalog
 * (data/hollow-rifts.ts, ~40KB of VN text) into every player's initial download.
 * Everything here is data-free: only type imports, no runtime import of the
 * rift data array. lib/hollow-rifts re-exports these for its (lazy) importers.
 */
import type { Character, HollowGateEventConfig } from "../types/character";
import type { HollowRift } from "../data/hollow-rifts";

/** The scaled event-gate config for a rift (short floors, themed boss, free
 *  entry). Fed straight into the existing enterHollowGateShrine path. The run's
 *  variant.id = the rift id, which the App completion hook keys off. */
export function riftEventConfig(rift: HollowRift): HollowGateEventConfig {
    return {
        id: rift.id,
        label: `${rift.bossName} Rift`,
        maxFloor: rift.floors,
        width: rift.boardWidth,
        height: rift.boardHeight,
        bossAiId: rift.bossAiId,
        bossName: rift.bossName,
        keyCost: 0,          // quest-granted, free entry
        requiresUnlock: false,
        active: true,
    };
}

// ── Server calls (server-authoritative; the client never pays out) ────────────

type RiftResponse = {
    ok?: boolean;
    reason?: string;
    activeRiftQuest?: Character["activeRiftQuest"];
    ryo?: number;
    totalRyo?: number;
    fateShards?: number;
    totalFateShards?: number;
    boneCharms?: number;
    totalBoneCharms?: number;
    cooldownUntil?: number;
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
/** Complete: the server re-verifies the boss kill (hollowGateWardenKills delta) and pays. */
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
 * it composes with the shrine-clear bonus), `log` is the Hollow Gate log. The
 * server re-verifies the boss kill against the sealed baseline, single-use +
 * daily-capped; a failed/duplicate call is a no-op.
 */
export async function completeRiftRun(
    playerName: string,
    riftId: string,
    apply: (updater: (prev: Character | null) => Character | null) => void,
    log: (msg: string) => void,
): Promise<void> {
    const resp = await completeRift(playerName, riftId);
    if (!resp.ok) return;
    apply((prev) => prev ? ({
        ...prev,
        ryo: (prev.ryo ?? 0) + (resp.ryo ?? 0),
        fateShards: (prev.fateShards ?? 0) + (resp.fateShards ?? 0),
        boneCharms: (prev.boneCharms ?? 0) + (resp.boneCharms ?? 0),
        activeRiftQuest: null,
        riftCooldownUntil: resp.cooldownUntil ?? prev.riftCooldownUntil,
    }) : prev);
    const parts = [`${resp.ryo ?? 0} ryo`];
    if (resp.fateShards) parts.push(`${resp.fateShards} fate shard${resp.fateShards === 1 ? "" : "s"}`);
    if (resp.boneCharms) parts.push(`${resp.boneCharms} bone charm${resp.boneCharms === 1 ? "" : "s"}`);
    log(`Rift sealed. Quest reward: ${parts.join(", ")}.`);
}
