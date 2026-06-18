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

export async function claimWeeklyMission(playerName: string, missionId: string): Promise<{ ok: boolean; error?: string; reward?: WeeklyBoardReward; alreadyClaimed?: boolean }> {
    try {
        const res = await fetch('/api/missions/weekly-board', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, missionId }),
        });
        const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; reward?: WeeklyBoardReward; alreadyClaimed?: boolean };
        if (!res.ok || !data.ok) return { ok: false, error: data.error || 'Could not claim.' };
        return { ok: true, reward: data.reward, alreadyClaimed: data.alreadyClaimed };
    } catch {
        return { ok: false, error: 'Could not claim. Try again.' };
    }
}

export function rewardText(r: WeeklyBoardReward): string {
    return [
        r.ryo ? `+${r.ryo.toLocaleString()} ryo` : '',
        r.fateShards ? `+${r.fateShards} Fate Shards` : '',
        r.boneCharms ? `+${r.boneCharms} Bone Charms` : '',
    ].filter(Boolean).join(', ');
}
