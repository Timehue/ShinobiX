/*
 * Clan-war PET battle — client API + the pinned duel parameters.
 *
 * Clan-war pet results are SERVER-AUTHORITATIVE: both sides field a pet through
 * /api/clan/war/pet, the server runs the deterministic duel and finalizes the
 * challenge itself, and /api/clan/war/report refuses a client-reported pet result.
 * This screen never reports a winner — it only replays what the server recorded.
 */

import type { Pet } from "../types/pet";

/**
 * Duel parameters PINNED for every clan-war pet battle.
 * MUST match api/clan/war/_pet-duel.ts CLAN_WAR_PET_DUEL exactly — the replay
 * feeds these to the same engine, so any drift makes the animated fight disagree
 * with the recorded result.
 *
 * `accuracy` is pinned rather than read from petAccuracyEnabled(): that helper
 * reads localStorage, so two players with different toggles used to compute
 * DIFFERENT winners for the same clan-war fight. `true` is the unset default, so
 * pinning it preserves the fight players already experience.
 */
export const CLAN_WAR_PET_DUEL = Object.freeze({
    damageMult: 1,
    hpMult: 1,
    reviveOnce: false,
    applyItems: true,
    accuracy: true,
    terrain: null as string | null,
});

export type ClanWarPetMode = "pet1v1" | "pet2v2";
export type ClanWarPetOutcome = "from-wins" | "to-wins" | "draw";
export type ClanWarPetFighter = { name: string; pet: Pet };

export type ClanWarPetSession = {
    warId: string;
    challengeId: string;
    mode: ClanWarPetMode;
    seed: number;
    /** The opposing side reads as [] until the duel resolves (no scouting). */
    from: ClanWarPetFighter[];
    to: ClanWarPetFighter[];
    status: "awaiting-pets" | "done";
    winner?: ClanWarPetOutcome;
    createdAt: number;
    updatedAt: number;
};

type PetResponse = { session?: ClanWarPetSession; error?: string; warEnded?: boolean };

async function post(body: Record<string, unknown>): Promise<PetResponse> {
    const r = await fetch("/api/clan/war/pet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({})) as PetResponse;
    if (!r.ok) return { error: data.error ?? `HTTP ${r.status}` };
    return data;
}

/** Field a pet. Idempotent — a retry by the same player re-reads the session. */
export function submitClanWarPet(warId: string, challengeId: string, petId: string): Promise<PetResponse> {
    return post({ action: "submit", warId, challengeId, petId });
}

/** Read the session (drives the waiting state + the replay). */
export function clanWarPetState(warId: string, challengeId: string): Promise<PetResponse> {
    return post({ action: "state", warId, challengeId });
}

/** Which side of the challenge a player is on, for banner wording. */
export function clanWarPetSideOf(
    playerName: string,
    ch: { fromPlayer?: string; fromPlayer2?: string | null; acceptedPlayer?: string | null; acceptedPlayer2?: string | null },
): "from" | "to" | null {
    const n = playerName.trim().toLowerCase();
    const eq = (v?: string | null) => String(v ?? "").trim().toLowerCase() === n;
    if (eq(ch.fromPlayer) || eq(ch.fromPlayer2)) return "from";
    if (eq(ch.acceptedPlayer) || eq(ch.acceptedPlayer2)) return "to";
    return null;
}
