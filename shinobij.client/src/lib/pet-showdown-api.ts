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

export {
    SHOWDOWN_BENCH_SIZE,
    SHOWDOWN_FORMAT_SIZE,
    showdownTeamSize,
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

/**
 * Start a PAID arena bout — the Coliseum's reward loop.
 *
 * Deliberately separate from `startShowdown`, which is unlimited practice and
 * pays nothing. The arena matches you: the server picks the opposition scaled
 * to the team you bring, enforces the daily win cap up front, and seals the
 * payout into the session. No tier is sent, because a chosen tier on a paying
 * path is a difficulty slider on a faucet.
 */
export async function startArenaBout(
    playerName: string,
    format: ShowdownFormat,
    petIds: string[],
): Promise<{ state: ShowdownStateView; dailyPetWins?: number; dailyCap?: number } | { error: string; capped?: boolean }> {
    const r = await post({ action: "arena", playerName, format, petIds });
    if (!r) return { error: "Network error — could not reach the arena." };
    const data = await r.json().catch(() => null) as
        { state?: ShowdownStateView; error?: string; capped?: boolean; dailyPetWins?: number; dailyCap?: number } | null;
    if (!r.ok || !data?.state) {
        return { error: data?.error ?? "The arena gate is closed right now.", capped: data?.capped };
    }
    return { state: data.state, dailyPetWins: data.dailyPetWins, dailyCap: data.dailyCap };
}

export type ShowdownTurnResult = ShowdownTurnResponse | { expired: true } | null;

/** Submit one round of commands. Retries once on a 503 (lock contention).
 *  A 404 means the session no longer exists (45-min TTL lapsed or already
 *  settled elsewhere) — surfaced distinctly so the battle screen can say
 *  "expired" instead of implying a transient connection problem. */
export async function submitShowdownTurn(
    playerName: string,
    sessionId: string,
    commands: ShowdownCommand[],
): Promise<ShowdownTurnResult> {
    for (let attempt = 0; attempt < 2; attempt++) {
        const r = await post({ action: "turn", playerName, sessionId, commands });
        if (!r) return null;
        if (r.status === 503 && attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 900));
            continue;
        }
        if (r.status === 404) return { expired: true };
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
