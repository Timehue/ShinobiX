/*
 * Weekly mission board — a single GLOBAL set of cross-system missions that
 * rotates every week. Everyone sees the same board (seeded by the week key
 * only, not per-player), so a small population shares the same goals.
 *
 * Progress is measured by DIFFING existing lifetime counters against a per-week
 * baseline snapshot (see api/missions/weekly-board.ts) — so this needs NO new
 * action hooks: it reads counters the game already increments. The catalog
 * deliberately leans on server-authoritative counters (ranked wins, raids, AI
 * kills, missions, pet wins, Hollow Gate, exploration, tower) and avoids the
 * client-incremented PvP-kill counter.
 *
 * Pure data + helpers — unit-tested. The handler does the kv + claim.
 */

// Lifetime Character counters a weekly mission can track. All already exist and
// increment through normal play; we only diff them against a weekly baseline.
export type WeeklyCounter =
    | 'rankedWins'
    | 'totalVillageRaids'
    | 'totalAiKills'
    | 'totalMissionsCompleted'
    | 'totalPetWins'
    | 'hollowGateWardenKills'
    | 'totalTilesExplored'
    | 'totalEndlessTowerWins';

export const WEEKLY_COUNTERS: WeeklyCounter[] = [
    'rankedWins', 'totalVillageRaids', 'totalAiKills', 'totalMissionsCompleted',
    'totalPetWins', 'hollowGateWardenKills', 'totalTilesExplored', 'totalEndlessTowerWins',
];

// Weekly rewards: ryo + scarce currency (fate shards / bone charms). No aura
// stones (owner call). Magnitudes are the only balance levers — tune freely.
export type WeeklyReward = { ryo?: number; fateShards?: number; boneCharms?: number };

export type WeeklyMission = {
    id: string;
    name: string;
    desc: string;
    counter: WeeklyCounter;
    target: number;
    reward: WeeklyReward;
};

export const WEEKLY_CATALOG: WeeklyMission[] = [
    { id: 'wk-ranked-3',     name: 'Ladder Climber', desc: 'Win 3 ranked matches.',        counter: 'rankedWins',            target: 3,   reward: { ryo: 4000, fateShards: 1 } },
    { id: 'wk-ranked-7',     name: 'Ranked Grinder', desc: 'Win 7 ranked matches.',        counter: 'rankedWins',            target: 7,   reward: { ryo: 8000, fateShards: 2 } },
    { id: 'wk-raid-5',       name: 'Raider',         desc: 'Complete 5 village raids.',    counter: 'totalVillageRaids',     target: 5,   reward: { ryo: 5000, boneCharms: 3 } },
    { id: 'wk-raid-12',      name: 'Warbringer',     desc: 'Complete 12 village raids.',   counter: 'totalVillageRaids',     target: 12,  reward: { ryo: 9000, boneCharms: 6 } },
    { id: 'wk-ai-25',        name: 'Skirmisher',     desc: 'Defeat 25 AI opponents.',      counter: 'totalAiKills',          target: 25,  reward: { ryo: 3000, boneCharms: 2 } },
    { id: 'wk-ai-60',        name: 'Bladestorm',     desc: 'Defeat 60 AI opponents.',      counter: 'totalAiKills',          target: 60,  reward: { ryo: 6000, fateShards: 1 } },
    { id: 'wk-missions-10',  name: 'Dutiful',        desc: 'Complete 10 missions.',        counter: 'totalMissionsCompleted',target: 10,  reward: { ryo: 4000, boneCharms: 2 } },
    { id: 'wk-missions-25',  name: 'Tireless',       desc: 'Complete 25 missions.',        counter: 'totalMissionsCompleted',target: 25,  reward: { ryo: 8000, fateShards: 2 } },
    { id: 'wk-pet-10',       name: 'Beastmaster',    desc: 'Win 10 pet battles.',          counter: 'totalPetWins',          target: 10,  reward: { ryo: 4000, boneCharms: 3 } },
    { id: 'wk-pet-25',       name: 'Pack Leader',    desc: 'Win 25 pet battles.',          counter: 'totalPetWins',          target: 25,  reward: { ryo: 8000, fateShards: 2 } },
    { id: 'wk-gate-3',       name: 'Gate Delver',    desc: 'Slay 3 Hollow Gate Wardens.',  counter: 'hollowGateWardenKills', target: 3,   reward: { ryo: 5000, fateShards: 1 } },
    { id: 'wk-explore-150',  name: 'Pathfinder',     desc: 'Explore 150 sectors.',         counter: 'totalTilesExplored',    target: 150, reward: { ryo: 3000, boneCharms: 2 } },
    { id: 'wk-tower-3',      name: 'Tower Ascent',   desc: 'Win 3 Endless Tower runs.',    counter: 'totalEndlessTowerWins', target: 3,   reward: { ryo: 5000, boneCharms: 3 } },
];

// Weekly board is anchored to Mondays 00:00 UTC. 2024-01-01 was a Monday.
export const WEEK_EPOCH_MS = Date.UTC(2024, 0, 1);
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const WEEKLY_BOARD_SIZE = 5;

export function weekIndex(now: number): number {
    return Math.floor((now - WEEK_EPOCH_MS) / WEEK_MS);
}
export function weekKey(now: number): string {
    return `w${weekIndex(now)}`;
}
/** ms timestamp when the current week ends (next Monday 00:00 UTC). */
export function weekEndsAt(now: number): number {
    return WEEK_EPOCH_MS + (weekIndex(now) + 1) * WEEK_MS;
}

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function stringHash(s: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
}

/** The week's board: a deterministic, GLOBAL pick (same for every player). */
export function pickWeeklyBoard(wkKey: string, count: number = WEEKLY_BOARD_SIZE): WeeklyMission[] {
    const take = Math.min(count, WEEKLY_CATALOG.length);
    const rng = mulberry32(stringHash(wkKey));
    const remaining = [...WEEKLY_CATALOG];
    const chosen: WeeklyMission[] = [];
    for (let i = 0; i < take; i += 1) {
        chosen.push(remaining.splice(Math.floor(rng() * remaining.length), 1)[0]);
    }
    return chosen;
}

function n(v: unknown): number { const x = Number(v); return Number.isFinite(x) ? x : 0; }

/** Progress on one mission = how much its counter rose since the week baseline. */
export function computeProgress(mission: WeeklyMission, baseline: Record<string, unknown>, current: Record<string, unknown>): number {
    return Math.max(0, n(current[mission.counter]) - n(baseline[mission.counter]));
}

/** Snapshot just the tracked counters from a character (the weekly baseline). */
export function snapshotCounters(char: Record<string, unknown>): Record<WeeklyCounter, number> {
    const snap = {} as Record<WeeklyCounter, number>;
    for (const c of WEEKLY_COUNTERS) snap[c] = n(char[c]);
    return snap;
}
