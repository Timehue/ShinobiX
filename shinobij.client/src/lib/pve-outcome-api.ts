import type { Character } from "../types/character";

/*
 * The physical cost of a server-resolved PvE fight, reported once the run ends.
 *
 * Separate from every mode's reward settle on purpose. The reward settles
 * (api/story/settle, queue-combat-claim, report-ai-fight) refuse a losing run by
 * design, so a defeat used to reach the server through nothing at all: the
 * player kept their HP, was never hospitalized, and could retry immediately. The
 * local Arena has always done the opposite — surviving HP written back on every
 * exchange, `{hp: 0, hospitalized: true}` when the player falls.
 *
 * The SERVER decides from the sealed session; this only asks. It pays nothing,
 * so it is safe to call on any resolution, including a win (where it writes back
 * the HP the fight actually cost).
 */

export type PveFightOutcome = "win" | "loss" | "draw" | "forfeit" | "unknown";

export type PveFightOutcomeResult = {
    ok: boolean;
    outcome: PveFightOutcome;
    /** False when the run was already reported, or the session had lapsed. */
    applied: boolean;
    replayed?: boolean;
    character?: Character | null;
    _saveVersion?: number;
};

/**
 * Report one finished (or abandoned) server PvE run.
 *
 * Never throws: this must not be able to break a results screen or swallow a
 * reward the player already earned. A failure resolves to null and the fight
 * simply costs nothing, which is the pre-existing behaviour.
 */
export async function reportPveFightOutcome(runId: string, playerName: string): Promise<PveFightOutcomeResult | null> {
    if (!runId || !playerName) return null;
    try {
        const response = await fetch("/api/pve/fight-outcome", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ runId, playerName }),
        });
        if (!response.ok) return null;
        const data = await response.json().catch(() => null) as PveFightOutcomeResult | null;
        return data?.ok ? data : null;
    } catch {
        return null;
    }
}
