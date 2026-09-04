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
import type { FirstPactEncounterId, FirstPactProgress } from "../../../shared/first-pact-contract";

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

/**
 * What the practice door can be pointed at.
 *
 * The three tiers are the player choosing their own opposition. `"sparring"` is
 * the opposite request — "match me" — and the server answers it by rolling the
 * tier itself and levelling the AI team pet-for-pet against the team brought.
 * It is not a fourth tier, so it never enters the shared contract: it is a mode
 * of asking, and only this endpoint's practice entry understands it.
 */
export type ShowdownOpposition = ShowdownTier | "sparring";

export async function startShowdown(
    playerName: string,
    format: ShowdownFormat,
    opposition: ShowdownOpposition,
    petIds: string[],
): Promise<{ state: ShowdownStateView } | { error: string }> {
    const sparring = opposition === "sparring";
    // The server ignores `tier` outright when sparring (it rolls its own), so
    // the value sent alongside is only ever the schema's default.
    const tier: ShowdownTier = sparring ? "scrapper" : opposition;
    const r = await post({ action: "start", playerName, format, tier, petIds, sparring });
    if (!r) return { error: "Network error — could not reach the Showdown." };
    const data = await r.json().catch(() => null) as { state?: ShowdownStateView; error?: string } | null;
    if (!r.ok || !data?.state) return { error: data?.error ?? "The Showdown gate is closed right now." };
    return { state: data.state };
}

export async function startFirstPactShowdown(
    playerName: string,
    encounterId: FirstPactEncounterId,
    petIds: string[],
): Promise<{ state: ShowdownStateView; progress: FirstPactProgress } | { error: string }> {
    const r = await post({ action: "first-pact", playerName, encounterId, petIds });
    if (!r) return { error: "The Celestial crossing could not reach the Colosseum." };
    const data = await r.json().catch(() => null) as {
        state?: ShowdownStateView;
        error?: string;
        firstPact?: { progress?: FirstPactProgress };
    } | null;
    if (!r.ok || !data?.state || !data.firstPact?.progress) {
        return { error: data?.error ?? "The tournament gate is closed right now." };
    }
    return { state: data.state, progress: data.firstPact.progress };
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
/**
 * A Hollow Gate pet encounter, BOUND to the run that started it.
 *
 * Only the run's own identifiers travel: the server validates the run token and
 * the combat binding, then fields the run's OWN Hound (it does not take an
 * opponent from here). A bound bout pays no arena faucet and consumes no daily
 * cap — the Gate's settlement endpoint pays it, redeeming the receipt this bout
 * mints under the session id.
 */
export type ShowdownHollowGateRef = { token: string; runId: string; houndId: string };

export async function startArenaBout(
    playerName: string,
    format: ShowdownFormat,
    petIds: string[],
    hollowGate?: ShowdownHollowGateRef,
): Promise<{ state: ShowdownStateView; dailyPetWins?: number; dailyCap?: number } | { error: string; capped?: boolean }> {
    const r = await post({ action: "arena", playerName, format, petIds, ...(hollowGate ? { hollowGate } : {}) });
    if (!r) return { error: "Network error — could not reach the arena." };
    const data = await r.json().catch(() => null) as
        { state?: ShowdownStateView; error?: string; capped?: boolean; dailyPetWins?: number; dailyCap?: number } | null;
    if (!r.ok || !data?.state) {
        return { error: data?.error ?? "The arena gate is closed right now.", capped: data?.capped };
    }
    return { state: data.state, dailyPetWins: data.dailyPetWins, dailyCap: data.dailyCap };
}

/**
 * An AUTHORED encounter — the relic-dungeon Rare Beast Seal, or an
 * admin-authored VN choice with a pet battle in it.
 *
 * The descriptor is a SELECTOR, never an opponent. A dungeon seal names the
 * player's own server-minted run token; an authored VN battle names the event
 * and the authored (petId, difficulty) pair identifying which choice it is. The
 * server rebuilds the beast from its own copy of the authored content, so no
 * statline, level, kit or name for the opponent is ever sent from here — which
 * is exactly what kept these two fights on the old client-local sim.
 *
 * These bouts pay nothing. The dungeon's rewards come from its run settlement
 * and the event's from its completion.
 */
export type ShowdownEncounterRef =
    | { kind: "dungeon-seal"; runToken: string }
    | { kind: "story-event"; eventId: string; petId: string; difficulty?: string };

export async function startAuthoredEncounter(
    playerName: string,
    petId: string,
    encounter: ShowdownEncounterRef,
): Promise<{ state: ShowdownStateView } | { error: string }> {
    const r = await post({ action: "encounter", playerName, petIds: [petId], encounter });
    if (!r) return { error: "Network error — the seal did not answer." };
    const data = await r.json().catch(() => null) as { state?: ShowdownStateView; error?: string } | null;
    if (!r.ok || !data?.state) return { error: data?.error ?? "This encounter cannot be fought right now." };
    return { state: data.state };
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

/** Concede the bout. The server DECIDES the session as a loss rather than
 *  dropping it, so anything bound to the fight (a Hollow Gate encounter) still
 *  gets an outcome to settle. Resolves true once the concession is recorded. */
export async function forfeitShowdown(playerName: string, sessionId: string): Promise<boolean> {
    const r = await post({ action: "forfeit", playerName, sessionId });
    return !!r?.ok;
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
