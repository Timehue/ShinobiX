import type { Character } from "../types/character";

/*
 * Live ranked pet matchmaking — client transport.
 *
 * The queue only produces a PAIRING. Everything that decides or rates the fight
 * is server-owned and already existed:
 *   /api/pet/ranked-start  mints one sealed match token for the pair
 *   /api/pet/ranked-watch  re-derives the rated fight for both players
 *   /api/pet/battle-result rates that same derivation
 *
 * So nothing here simulates a duel, invents a seed, or reports an outcome it
 * decided locally — that combination is exactly the defect this mode was
 * retired for.
 */

export type PetRankedQueueState =
    | { state: "idle" }
    | { state: "queued"; queuePosition: number; waiting: number }
    | { state: "paired"; opponent: string; opponentElo: number; initiator: boolean; expiresAt: number }
    | { state: "active"; matchToken: string; opponent: string; initiator: boolean }
    | { state: "completed"; matchToken: string; opponent: string };

export type RankedPetCharacterSnapshot = { character: Character; _saveVersion: number };

function rankedCharacterSnapshot(data: unknown, playerName: string): RankedPetCharacterSnapshot {
    const record = data && typeof data === "object" ? data as Record<string, unknown> : null;
    const character = record?.character as Character | undefined;
    if (!character || typeof character !== "object" || typeof character.name !== "string"
        || character.name.trim().toLowerCase() !== playerName.trim().toLowerCase()
        || !Number.isSafeInteger(record?._saveVersion) || Number(record?._saveVersion) <= 0) {
        throw new Error("The ranked result is recorded, but your updated character could not be loaded. Retry to recover it.");
    }
    return { character, _saveVersion: Number(record?._saveVersion) };
}

/** Completed discovery must adopt today's save, not an old match snapshot. */
export async function fetchRankedPetCharacter(playerName: string): Promise<RankedPetCharacterSnapshot> {
    const response = await fetch(`/api/save/${encodeURIComponent(playerName)}`, {
        signal: AbortSignal.timeout(12_000),
    });
    const data = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) throw new Error(data?.error ?? "Your ranked result is safe, but your updated character could not be loaded. Retry to recover it.");
    return rankedCharacterSnapshot(data, playerName);
}

async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch("/api/pvp/pet-ranked-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12_000),
    });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(String(data.error ?? "Ranked matchmaking request failed."));
    return data;
}

export async function petRankedQueue(
    action: "join" | "leave" | "poll" | "acknowledge",
    playerName: string,
    matchToken?: string,
): Promise<PetRankedQueueState> {
    // Never trust the body's shape: a proxy, an error page, or a preview build
    // with no API mounted all answer 200 with HTML, which parses to `{}`.
    // Adopting that would blank `state` and throw on the next render.
    const raw = await post({ action, name: playerName, ...(matchToken ? { matchToken } : {}) });
    return typeof raw.state === "string"
        ? raw as unknown as PetRankedQueueState
        : { state: "idle" };
}

/**
 * Mint the sealed match token. Only the initiator may call this; the other side
 * discovers the same token through the queue's `active` state.
 */
export async function startRankedPetMatch(opponentName: string): Promise<void> {
    const response = await fetch("/api/pet/ranked-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opponentName }),
        signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "The ranked match could not be started.");
    }
}

/**
 * Report the SERVER's own verdict so it can rate the match. The server
 * re-derives the outcome from the sealed token rather than trusting this body,
 * so posting it is a nudge to settle, never a claim about who won.
 */
export async function settleRankedPetMatch(input: {
    playerName: string;
    matchToken: string;
    opponentName: string;
    outcome: "win" | "loss" | "draw";
}): Promise<RankedPetCharacterSnapshot> {
    const response = await fetch("/api/pet/battle-result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            playerName: input.playerName,
            outcome: input.outcome,
            ranked: true,
            matchToken: input.matchToken,
            opponentName: input.opponentName,
            reportKey: `${input.matchToken}:ranked`,
        }),
        signal: AbortSignal.timeout(12_000),
    });
    const data = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
    if (!response.ok || data?.ok !== true) {
        throw new Error(data?.error ?? "The ranked result could not be recorded. Retry to finish recording this match.");
    }
    return rankedCharacterSnapshot(data, input.playerName);
}
