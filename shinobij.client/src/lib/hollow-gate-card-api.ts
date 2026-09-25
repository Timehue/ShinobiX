import type { Character } from "../types/character";

/** `loanerDeck`: the player had no legal deck of their own (the Card Hall opens
 * at 17), so the server lent its starter deck for this one match. */
type CardStartResult = { ok: boolean; matchId?: string; loanerDeck?: boolean; error?: string };
type CardSettleResult = { ok: boolean; won?: boolean; reward?: { ryo: number; auraDust: number }; character?: Character; _saveVersion?: number; error?: string };

/** The run-log line for a card ambush that has just opened. */
export function hollowGateCardAmbushLogLine(started: Pick<CardStartResult, "loanerDeck">): string {
    return started.loanerDeck
        ? "A Chronicle Keeper blocks the corridor and lends you a traveler's starter deck for the showdown. Win or withstand it to break the ambush seal."
        : "A Chronicle Keeper blocks the corridor. Win or withstand the card showdown to break the ambush seal.";
}

export async function startHollowGateCardAmbush(playerName: string, token: string, nodeId: string): Promise<CardStartResult> {
    try {
        const response = await fetch("/api/hollow-gate/card-start", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, token, nodeId }),
        });
        const data = await response.json().catch(() => ({})) as CardStartResult;
        return response.ok && data.ok ? data : { ...data, ok: false, error: data.error ?? "The rift card ambush could not start." };
    } catch {
        return { ok: false, error: "The rift card service is unreachable." };
    }
}

export async function settleHollowGateCardAmbush(playerName: string, token: string, matchId: string): Promise<CardSettleResult> {
    try {
        const response = await fetch("/api/hollow-gate/card-settle", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, token, matchId }),
        });
        const data = await response.json().catch(() => ({})) as CardSettleResult;
        return response.ok && data.ok ? data : { ...data, ok: false, error: data.error ?? "The rift card result could not be sealed." };
    } catch {
        return { ok: false, error: "The rift card service is unreachable." };
    }
}
