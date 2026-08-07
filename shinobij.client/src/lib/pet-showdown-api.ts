/*
 * Client side of Pet Showdown — the server-authoritative turn-based flagship
 * pet battle mode (/api/pet/showdown).
 *
 * The battle ENGINE lives only on the server: `start` seals the player's pets
 * and mints a session, each `turn` posts one round of commands and receives the
 * turn script (events) the battle screen plays back cinematically, and the
 * finishing turn's response carries the server-settled reward + character
 * snapshot (ryo is client-owned — the caller must ADOPT the returned character,
 * same as /api/pet/battle-result responses).
 *
 * All calls ride the auth-wrapped global fetch (installAuthFetch).
 */

import type {
    ShowdownCommand,
    ShowdownFormat,
    ShowdownStateView,
    ShowdownTier,
    ShowdownTurnResponse,
} from "../../../shared/pet-showdown-contract";

export type {
    ShowdownCommand,
    ShowdownEvent,
    ShowdownFormat,
    ShowdownPetView,
    ShowdownStateView,
    ShowdownTier,
    ShowdownTurnResponse,
} from "../../../shared/pet-showdown-contract";

async function post(body: Record<string, unknown>): Promise<Response | null> {
    try {
        return await fetch("/api/pet/showdown", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    } catch {
        return null;
    }
}

export async function startShowdown(
    playerName: string,
    format: ShowdownFormat,
    tier: ShowdownTier,
    petIds: string[],
): Promise<{ state: ShowdownStateView } | { error: string }> {
    const r = await post({ action: "start", playerName, format, tier, petIds });
    if (!r) return { error: "Network error — could not reach the Showdown." };
    const data = await r.json().catch(() => null) as { state?: ShowdownStateView; error?: string } | null;
    if (!r.ok || !data?.state) return { error: data?.error ?? "The Showdown gate is closed right now." };
    return { state: data.state };
}

/** Submit one round of commands. Retries once on a 503 (lock contention). */
export async function submitShowdownTurn(
    playerName: string,
    sessionId: string,
    commands: ShowdownCommand[],
): Promise<ShowdownTurnResponse | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
        const r = await post({ action: "turn", playerName, sessionId, commands });
        if (!r) return null;
        if (r.status === 503 && attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 900));
            continue;
        }
        if (!r.ok) return null;
        return await r.json().catch(() => null) as ShowdownTurnResponse | null;
    }
    return null;
}

export async function forfeitShowdown(playerName: string, sessionId: string): Promise<void> {
    await post({ action: "forfeit", playerName, sessionId });
}

export async function fetchShowdownState(
    playerName: string,
    sessionId: string,
): Promise<ShowdownStateView | null> {
    const r = await post({ action: "state", playerName, sessionId });
    if (!r || !r.ok) return null;
    const data = await r.json().catch(() => null) as { state?: ShowdownStateView } | null;
    return data?.state ?? null;
}
