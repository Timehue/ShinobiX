/*
 * Client wrapper for the weekly mission board (api/missions/weekly-board.ts).
 * Plain fetch (auth headers via the global authFetch interceptor). The server is
 * authoritative for progress + payout; the caller reflects the returned reward
 * locally so the autosave converges.
 */

export type WeeklyBoardReward = { ryo?: number; fateShards?: number; boneCharms?: number };
export type WeeklyBoardMission = {
    id: string;
    name: string;
    desc: string;
    target: number;
    reward: WeeklyBoardReward;
    progress: number;
    complete: boolean;
    claimed: boolean;
};
export type WeeklyBoard = { weekKey: string; endsAt: number; missions: WeeklyBoardMission[] };
export type WeeklyClaimResult = {
    ok: boolean;
    error?: string;
    reason?: string;
    requiredLevel?: number;
    requiredSystem?: string;
    reward?: WeeklyBoardReward;
    balances?: { ryo: number; fateShards: number; boneCharms: number };
    alreadyClaimed?: boolean;
};

export async function fetchWeeklyBoard(playerName: string): Promise<WeeklyBoard | null> {
    try {
        const res = await fetch(`/api/missions/weekly-board?playerName=${encodeURIComponent(playerName)}`);
        const data = await res.json().catch(() => null) as WeeklyBoard | null;
        if (!res.ok || !data || !Array.isArray(data.missions)) return null;
        return data;
    } catch {
        return null;
    }
}

export async function claimWeeklyMission(playerName: string, missionId: string): Promise<WeeklyClaimResult> {
    try {
        const res = await fetch('/api/missions/weekly-board', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, missionId }),
        });
        const data = await res.json().catch(() => ({})) as WeeklyClaimResult;
        if (!res.ok || !data.ok) return { ok: false, error: data.error || 'Could not claim.', reason: data.reason, requiredLevel: data.requiredLevel, requiredSystem: data.requiredSystem };
        return { ok: true, reward: data.reward, balances: data.balances, alreadyClaimed: data.alreadyClaimed };
    } catch {
        return { ok: false, error: 'Could not claim. Try again.' };
    }
}

export function weeklyClaimErrorText(result: WeeklyClaimResult): string {
    if (result.reason === "level-too-low") return result.requiredLevel ? `Unlocks at Level ${result.requiredLevel}.` : "You do not meet this mission's level requirement.";
    if (result.reason === "system-locked") {
        if (result.requiredSystem === "hollowGate") return "Requires Hollow Gate access.";
        if (result.requiredSystem === "ranked") return "Requires ranked PvP.";
        return "This mission requires a system your character has not unlocked yet.";
    }
    if (result.reason === "missing-clan") return "Requires joining a clan.";
    if (result.reason === "missing-pet") return "Requires a pet.";
    if (result.error === "mission_not_eligible") return "This mission is not unlocked for your character yet.";
    return result.error || "Could not claim.";
}

export function rewardText(r: WeeklyBoardReward): string {
    return [
        r.ryo ? `+${r.ryo.toLocaleString()} ryo` : '',
        r.fateShards ? `+${r.fateShards} Fate Shards` : '',
        r.boneCharms ? `+${r.boneCharms} Bone Charms` : '',
    ].filter(Boolean).join(', ');
}
