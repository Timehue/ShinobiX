import type { ClientBattleLock } from "./battle-save";

type RecoveryKind = "hub" | "pvp" | "pet-pvp" | "towers" | "resolved" | "endless"
    | "arena" | "shrine" | "dungeon" | "story-event" | "story-fallback" | "resume" | "missing";

/** Classify only; the caller retains each runtime's settlement and admission.
 * Reads are lazy and ordered: a live PvP pointer must bypass stale PvE data,
 * and tower leases must bypass the resolved marker and browser resume state. */
export function decideBootBattleRecovery({
    pvpSessionAliveOnServer,
    restoredPvpBattleId,
    hasPendingPetPvp,
    bootLock,
    readRecentlyResolved,
    readStoryKind,
    hasResumeState,
}: {
    pvpSessionAliveOnServer: boolean;
    restoredPvpBattleId: string | null;
    hasPendingPetPvp: boolean;
    bootLock: ClientBattleLock | null | undefined;
    readRecentlyResolved: () => string;
    readStoryKind: () => unknown;
    hasResumeState: () => boolean;
}): RecoveryKind {
    if (pvpSessionAliveOnServer && restoredPvpBattleId) return "pvp";
    if (hasPendingPetPvp) return "pet-pvp";
    if (!bootLock?.screen) return "hub";
    if (bootLock.kind === "battleTowers") return "towers";
    const recentlyResolved = readRecentlyResolved();
    if (recentlyResolved && recentlyResolved === bootLock.battleId) return "resolved";
    if (bootLock.kind === "endless") return "endless";
    if (bootLock.kind === "arena") return "arena";
    if (bootLock.kind === "arenaStory" && readStoryKind() === "hollowGateShrine") return "shrine";
    if (bootLock.kind === "arenaStory" && readStoryKind() === "dungeonAi") return "dungeon";
    if (bootLock.kind === "arenaStory" && ["triggeredEvent", "academySparring"].includes(String(readStoryKind()))) return "story-event";
    if (bootLock.kind === "arenaStory") return "story-fallback";
    if (hasResumeState()) return "resume";
    return "missing";
}
