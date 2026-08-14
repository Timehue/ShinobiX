import type { Pet } from "../types/pet";

export type PetArenaPlayerScope = Readonly<{
    playerName: string;
    generation: number;
}>;

export type PetArenaServerVersionDecision = "accepted" | "stale" | "foreign";

export type PetArenaServerVersionResult = PetArenaServerVersionDecision | boolean | void;

export type WarfrontRewardSeal = Readonly<{
    token: string;
    seed: number;
    reportKey: string;
    stance: "balanced" | "siege" | "jungle" | "headhunt" | "turtle";
    doctrine: "none" | "vanguard" | "bulwark" | "zealot" | "warden-pact";
    buyPolicy: "balanced" | "offense" | "defense";
    opponentStance: "balanced";
    opponentDoctrine: "vanguard";
    bluePets: readonly Pet[];
    redPets: readonly Pet[];
    expiresAt: number;
    matchDurationMs: number;
    settleAfter: number;
    safePlaybackForMs: number;
}>;

const WARFRONT_SETTLEMENT_RETRY_WINDOW_MS = 10 * 60_000;

function isSealedWarfrontPet(value: unknown): value is Pet {
    if (!value || typeof value !== "object") return false;
    const pet = value as Record<string, unknown>;
    const rarity = pet.rarity;
    return typeof pet.id === "string" && Boolean(pet.id)
        && typeof pet.name === "string" && Boolean(pet.name)
        && (rarity === "standard" || rarity === "rare" || rarity === "legendary" || rarity === "mythic")
        && [pet.level, pet.xp, pet.maxLevel, pet.hp, pet.attack, pet.defense, pet.speed]
            .every((stat) => typeof stat === "number" && Number.isFinite(stat))
        && Array.isArray(pet.jutsus)
        && typeof pet.unlockedForPve === "boolean";
}

/** Accept only a proof whose report identity is canonically derived from the
 * server-minted seed. The report key is optional on the wire for compatibility,
 * but a server-provided value may never disagree with that seed. */
export function parseWarfrontRewardSeal(payload: unknown): WarfrontRewardSeal | null {
    if (!payload || typeof payload !== "object") return null;
    const record = payload as Record<string, unknown>;
    if (typeof record.token !== "string" || !record.token.trim()) return null;
    if (typeof record.seed !== "number"
        || !Number.isSafeInteger(record.seed)
        || record.seed <= 0
        || record.seed >= 2 ** 31) return null;
    const reportKey = `${record.seed}:tactical`;
    if (record.reportKey !== undefined && record.reportKey !== reportKey) return null;
    if (!(["balanced", "siege", "jungle", "headhunt", "turtle"] as const).includes(record.stance as never)) return null;
    if (!(["none", "vanguard", "bulwark", "zealot", "warden-pact"] as const).includes(record.doctrine as never)) return null;
    if (!(["balanced", "offense", "defense"] as const).includes(record.buyPolicy as never)) return null;
    if (record.opponentStance !== "balanced" || record.opponentDoctrine !== "vanguard") return null;
    if (!Array.isArray(record.bluePets)
        || record.bluePets.length !== 4
        || !record.bluePets.every(isSealedWarfrontPet)
        || new Set(record.bluePets.map((pet) => pet.id)).size !== 4) return null;
    if (!Array.isArray(record.redPets)
        || record.redPets.length !== 4
        || !record.redPets.every(isSealedWarfrontPet)) return null;
    if (typeof record.expiresAt !== "number" || !Number.isSafeInteger(record.expiresAt)
        || typeof record.matchDurationMs !== "number" || !Number.isSafeInteger(record.matchDurationMs)
        || record.matchDurationMs <= 0
        || typeof record.settleAfter !== "number" || !Number.isSafeInteger(record.settleAfter)
        || record.settleAfter >= record.expiresAt
        || typeof record.safePlaybackForMs !== "number" || !Number.isSafeInteger(record.safePlaybackForMs)
        // This relative server budget is immune to a player's mis-set wall clock.
        || record.safePlaybackForMs < record.matchDurationMs + WARFRONT_SETTLEMENT_RETRY_WINDOW_MS) return null;
    return {
        token: record.token,
        seed: record.seed,
        reportKey,
        stance: record.stance as WarfrontRewardSeal["stance"],
        doctrine: record.doctrine as WarfrontRewardSeal["doctrine"],
        buyPolicy: record.buyPolicy as WarfrontRewardSeal["buyPolicy"],
        opponentStance: record.opponentStance,
        opponentDoctrine: record.opponentDoctrine,
        bluePets: record.bluePets,
        redPets: record.redPets,
        expiresAt: record.expiresAt,
        matchDurationMs: record.matchDurationMs,
        settleAfter: record.settleAfter,
        safePlaybackForMs: record.safePlaybackForMs,
    };
}

/**
 * A settlement may finish long after the duel that created it. This check keeps
 * an old mounted instance (or an account that was swapped in-place) from
 * touching the new player's UI, version clock, or run callbacks.
 */
export function isPetArenaPlayerScopeActive(
    origin: PetArenaPlayerScope,
    current: PetArenaPlayerScope,
    mounted: boolean,
): boolean {
    return mounted
        && origin.generation === current.generation
        && origin.playerName.toLowerCase() === current.playerName.toLowerCase();
}

/** Normalise the legacy boolean callback without conflating a stale snapshot
 * with a response belonging to a different account/session. */
export function normalizePetArenaVersionDecision(
    result: PetArenaServerVersionResult,
): PetArenaServerVersionDecision {
    if (result === "foreign") return "foreign";
    if (result === "stale" || result === false) return "stale";
    return "accepted";
}

/** A response carrying a character is valid only for the player who began the
 * settlement. Character-less receipt hops (such as Hollow Gate's first hop)
 * are allowed and remain protected by the mounted scope check. */
export function responseBelongsToPetArenaPlayer(
    origin: PetArenaPlayerScope,
    responsePlayerName?: string | null,
): boolean {
    return !responsePlayerName
        || responsePlayerName.toLowerCase() === origin.playerName.toLowerCase();
}
