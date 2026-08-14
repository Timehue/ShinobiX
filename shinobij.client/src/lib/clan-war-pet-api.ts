/*
 * Clan-war PET battle — client API.
 *
 * Clan-war pet results are SERVER-AUTHORITATIVE: both sides field a pet through
 * /api/clan/war/pet, the server resolves the duel on the Showdown engine and
 * finalizes the challenge itself, and /api/clan/war/report refuses a
 * client-reported pet result. The client never re-runs anything — a decided
 * fight is WATCHED via the `watch` action, which returns the server's own
 * re-derived script. (The pinned mirror parameters that used to live here died
 * with the client mirror: there is no second engine left to keep in sync.)
 */

import type { Pet } from "../types/pet";
import type { ShowdownReplayScript } from "../../../shared/pet-showdown-contract";

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
    /** Stamped 'showdown' on every duel decided after the engine cutover; a
     *  session without it predates the cutover and cannot be replayed. */
    engine?: "showdown";
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

/** Fetch the watchable script for a decided duel (null = not watchable). */
export async function clanWarPetWatch(warId: string, challengeId: string): Promise<ShowdownReplayScript | null> {
    const r = await fetch("/api/clan/war/pet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "watch", warId, challengeId }),
    });
    const data = await r.json().catch(() => ({})) as { script?: ShowdownReplayScript };
    return r.ok && data.script ? data.script : null;
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
