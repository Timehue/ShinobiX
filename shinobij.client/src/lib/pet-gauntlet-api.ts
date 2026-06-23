/*
 * Client side of the server-authoritative Pet Gauntlet rewards + weekly board.
 *
 * `start` fetches the WEEKLY SHARED SEED (so every player faces the same gauntlet)
 * plus a single-use run token; the UI seeds startGauntletRun with it. `report`
 * hands back the run result on completion — the server pays Ryo from its SEALED
 * schedule and returns the credited amount + your weekly rank, which we mirror
 * onto the local character (same reconcile pattern as claim-mission). The client
 * never sends or trusts a Ryo amount. Both calls go through the auth-wrapped
 * global fetch (installAuthFetch), so no name/token plumbing is needed here.
 */

export interface GauntletStart {
    runToken: string;
    seed: number;
    weekKey: string;
    rewardEligible: boolean;
    maxRounds: number;
    rewardedRunsLeft: number;
}

export interface GauntletReward {
    ryo: number;
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

export async function reportGauntlet(runToken: string, roundsCleared: number, heartsLeft: number): Promise<GauntletReward | null> {
    try {
        const r = await fetch("/api/pet/gauntlet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "report", runToken, roundsCleared, heartsLeft }),
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
