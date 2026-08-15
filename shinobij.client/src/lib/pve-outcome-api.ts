import type { Character } from "../types/character";

/*
 * The physical cost of a server-resolved PvE fight, reported once the run ends.
 *
 * Separate from every mode's reward settle on purpose. The reward settles
 * (api/story/settle, queue-combat-claim, report-ai-fight) refuse a losing run by
 * design, so physical consequences use this separate server report. The sealed
 * session persists surviving HP and applies `{hp: 0, hospitalized: true}` when
 * the player falls, preventing a defeat from becoming a free retry.
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
 * Retries and throws when the server cannot confirm the durable receipt. The
 * action/state routes already reconcile terminal mission/story sessions before
 * returning them, so this call normally replays that receipt and refreshes the
 * local character. Throwing keeps the explicit forfeit path fail-closed too.
 */
export async function reportPveFightOutcome(runId: string, playerName: string): Promise<PveFightOutcomeResult> {
    if (!runId || !playerName) throw new Error("Missing fight outcome identity.");
    let lastError: Error = new Error("The fight outcome could not be confirmed.");
    for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
            const response = await fetch("/api/pve/fight-outcome", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ runId, playerName }),
            });
            const data = await response.json().catch(() => null) as (PveFightOutcomeResult & { error?: string }) | null;
            if (!response.ok || !data?.ok) throw new Error(data?.error || `Fight outcome confirmation failed (${response.status}).`);
            return data;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
        }
    }
    throw lastError;
}
