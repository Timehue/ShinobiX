import type { RallyPet, RallyRaceResult, RallyStanding, RallyState } from './rally-types.js';
export type RallyChampionship = {
    id: string; day: string; seed: number; pet: RallyPet; rivals: string[]; tracks: string[];
    difficulty: number; raceIndex: number; race: RallyState | null; startedAt: number | null; checkpointAt: number;
    results: RallyRaceResult[]; status: 'ready' | 'racing' | 'between' | 'complete';
    reward: { ryo: number; reputation: number; place: number } | null; rewardBase: number;
};
export type RallyProgress = { reputation: number; championships: number; wins: number; lastEntryDay: string | null; current: RallyChampionship | null; best: Record<string, number> };
export const RALLY_RANKS = [
    { name: 'Rookie', at: 0 }, { name: 'Bronze', at: 60 }, { name: 'Silver', at: 180 },
    { name: 'Gold', at: 420 }, { name: 'Elite', at: 850 }, { name: 'Sunscar Champion', at: 1500 },
] as const;
export function rallyRank(reputation: number) { return [...RALLY_RANKS].reverse().find(r => reputation >= r.at) ?? RALLY_RANKS[0]; }
export function rallyStandings(results: readonly RallyRaceResult[]): RallyStanding[] {
    const standings = new Map<string, RallyStanding>();
    for (const race of results) for (const result of race.placements) {
        const row = standings.get(result.id) ?? { id: result.id, points: 0, totalTicks: 0 };
        row.points += result.points;
        row.totalTicks += result.tick;
        standings.set(row.id, row);
    }
    return [...standings.values()].sort((a, b) => b.points - a.points || a.totalTicks - b.totalTicks || a.id.localeCompare(b.id));
}
