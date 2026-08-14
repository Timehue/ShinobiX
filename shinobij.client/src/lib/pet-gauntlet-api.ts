/*
 * Client side of the server-authoritative Pet Gauntlet rewards + weekly board.
 *
 * `start` fetches a SERVER-MINTED per-run seed plus a single-use run token; the UI
 * seeds startGauntletRun with that seed so the server can replay the exact run.
 * `report` sends the player's decision TRANSCRIPT (drafts / rerolls / items /
 * relics / premium buys / per-fight placement) — the server RE-SIMULATES the run
 * and pays Ryo/premium from the SERVER-computed roundsCleared/heartsLeft, returning
 * the credited amounts + weekly rank, which we mirror onto the local character
 * (same reconcile pattern as claim-mission). The client never sends or trusts a
 * reward amount, roundsCleared, or heartsLeft. Both calls go through the
 * auth-wrapped global fetch (installAuthFetch), so no name/token plumbing here.
 */
import type { Character } from "../types/character";

// One player decision in a run, in the order performed. Fight outcomes are NOT
// recorded — the server re-fights each round. Mirrors GauntletAction in
// api/_pet-sim/gauntlet-sim.ts.
export type GauntletAction =
    | { k: "buy"; i: number }
    | { k: "item"; id: string }
    | { k: "relic"; id: string }
    | { k: "premium"; kind: "fateShard" | "boneCharm" }
    | { k: "reroll" }
    | { k: "release"; id: string }
    | { k: "fight"; place: { row: number; col: number }[] };

export interface GauntletStart {
    runToken: string;
    seed: number;
    weekKey: string;
    rewardEligible: boolean;
    maxRounds: number;
    rewardedRunsLeft: number;
    chargedRyo: number;
    balances: { ryo: number };
    character: Character;
    _saveVersion?: number;
}

export interface GauntletReward {
    ryo: number;
    fateShards: number;
    boneCharms: number;
    balances: { ryo: number; fateShards: number; boneCharms: number };
    score: number;
    rank: number | null;
    weekKey: string;
    roundsCleared: number;
    heartsLeft: number;
}

export async function startGauntlet(): Promise<GauntletStart | null> {
    try {
        const r = await fetch("/api/pet/gauntlet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "start" }),
        });
        if (!r.ok) return null;
        return (await r.json()) as GauntletStart;
    } catch {
        return null;
    }
}

export async function reportGauntlet(runToken: string, transcript: GauntletAction[]): Promise<GauntletReward | null> {
    try {
        const r = await fetch("/api/pet/gauntlet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "report", runToken, transcript }),
        });
        if (!r.ok) return null;
        return (await r.json()) as GauntletReward;
    } catch {
        return null;
    }
}

export interface GauntletLbRow { rank: number; name: string; village?: string; score: number; roundsCleared: number; heartsLeft: number; }

export async function fetchGauntletLeaderboard(top = 25): Promise<{ weekKey: string; leaderboard: GauntletLbRow[] }> {
    try {
        const r = await fetch(`/api/pet/gauntlet?top=${top}`);
        if (!r.ok) return { weekKey: "", leaderboard: [] };
        const data = await r.json();
        return { weekKey: String(data.weekKey ?? ""), leaderboard: (data.leaderboard ?? []) as GauntletLbRow[] };
    } catch {
        return { weekKey: "", leaderboard: [] };
    }
}
