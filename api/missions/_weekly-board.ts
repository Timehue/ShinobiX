/*
 * Weekly mission board - a global rotating catalog filtered per player.
 *
 * The raw weekly pick is seeded by the week key only, but the handler returns a
 * player-eligible view. If a global mission is locked for the player, safe
 * mission-completion fallbacks fill the visible slots so low-level players never
 * lose weekly capacity to impossible endgame objectives.
 */

import { canPlayerReceiveMission, type MissionEligibility, type MissionEligibilityContext } from './_eligibility.js';

export type WeeklyCounter =
    | 'rankedWins'
    | 'totalMissionsCompleted'
    | 'hollowGateWardenKills';

export const WEEKLY_COUNTERS: WeeklyCounter[] = [
    'rankedWins',
    'totalMissionsCompleted',
    'hollowGateWardenKills',
];

export type WeeklyReward = { ryo?: number; fateShards?: number; boneCharms?: number };

export type WeeklyMission = {
    id: string;
    name: string;
    desc: string;
    counter: WeeklyCounter;
    target: number;
    reward: WeeklyReward;
    eligibility: MissionEligibility;
};

const rankedEligibility: MissionEligibility = { minLevel: 10, requiresRankedUnlocked: true };
const safeEligibility: MissionEligibility = { minLevel: 1 };
const hollowGateWardenEligibility: MissionEligibility = {
    minLevel: 100,
    requiresHollowGateUnlocked: true,
};

export const WEEKLY_CATALOG: WeeklyMission[] = [
    { id: 'wk-ranked-3', name: 'Ladder Climber', desc: 'Win 3 ranked matches.', counter: 'rankedWins', target: 3, reward: { ryo: 4000, fateShards: 1 }, eligibility: rankedEligibility },
    { id: 'wk-ranked-7', name: 'Ranked Grinder', desc: 'Win 7 ranked matches.', counter: 'rankedWins', target: 7, reward: { ryo: 8000, fateShards: 2 }, eligibility: rankedEligibility },
    { id: 'wk-missions-10', name: 'Dutiful', desc: 'Complete 10 missions.', counter: 'totalMissionsCompleted', target: 10, reward: { ryo: 4000, boneCharms: 2 }, eligibility: safeEligibility },
    { id: 'wk-missions-25', name: 'Tireless', desc: 'Complete 25 missions.', counter: 'totalMissionsCompleted', target: 25, reward: { ryo: 8000, fateShards: 2 }, eligibility: safeEligibility },
    { id: 'wk-hollow-warden', name: 'Hollow Gate Warden', desc: 'Defeat the Hollow Gate Warden once.', counter: 'hollowGateWardenKills', target: 1, reward: { ryo: 12000, fateShards: 3, boneCharms: 4 }, eligibility: hollowGateWardenEligibility },
];

export const WEEKLY_FALLBACK_CATALOG: WeeklyMission[] = [
    { id: 'wk-safe-missions-5', name: 'Reliable Shinobi', desc: 'Complete 5 missions.', counter: 'totalMissionsCompleted', target: 5, reward: { ryo: 2500, boneCharms: 1 }, eligibility: safeEligibility },
    { id: 'wk-safe-missions-15', name: 'Steady Service', desc: 'Complete 15 missions.', counter: 'totalMissionsCompleted', target: 15, reward: { ryo: 5500, boneCharms: 2 }, eligibility: safeEligibility },
    { id: 'wk-safe-missions-20', name: 'Village Backbone', desc: 'Complete 20 missions.', counter: 'totalMissionsCompleted', target: 20, reward: { ryo: 6500, fateShards: 1 }, eligibility: safeEligibility },
];

export const WEEKLY_CLAIMABLE_CATALOG: WeeklyMission[] = [
    ...WEEKLY_CATALOG,
    ...WEEKLY_FALLBACK_CATALOG,
];

export const WEEK_EPOCH_MS = Date.UTC(2024, 0, 1);
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const WEEKLY_BOARD_SIZE = 4;

export function weekIndex(now: number): number {
    return Math.floor((now - WEEK_EPOCH_MS) / WEEK_MS);
}
export function weekKey(now: number): string {
    return `w${weekIndex(now)}`;
}
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
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}

function pickFromWeeklyPool(pool: WeeklyMission[], seed: string, count: number): WeeklyMission[] {
    const take = Math.min(count, pool.length);
    const rng = mulberry32(stringHash(seed));
    const remaining = [...pool];
    const chosen: WeeklyMission[] = [];
    for (let i = 0; i < take; i += 1) {
        chosen.push(remaining.splice(Math.floor(rng() * remaining.length), 1)[0]);
    }
    return chosen;
}

export function pickWeeklyBoard(wkKey: string, count: number = WEEKLY_BOARD_SIZE): WeeklyMission[] {
    return pickFromWeeklyPool(WEEKLY_CATALOG, wkKey, count);
}

export function pickWeeklyBoardForPlayer(
    wkKey: string,
    character: Record<string, unknown> | null | undefined,
    count: number = WEEKLY_BOARD_SIZE,
    context: MissionEligibilityContext = {},
): WeeklyMission[] {
    const selected = pickWeeklyBoard(wkKey, count);
    const visible = selected.filter((mission) => canPlayerReceiveMission(character ?? {}, mission, context).ok);
    const used = new Set(visible.map((mission) => mission.id));
    if (visible.length >= count) return visible.slice(0, count);

    const fillerPool = pickFromWeeklyPool(
        WEEKLY_CLAIMABLE_CATALOG.filter((mission) =>
            !used.has(mission.id) && canPlayerReceiveMission(character ?? {}, mission, context).ok
        ),
        `${wkKey}:fallback`,
        WEEKLY_CLAIMABLE_CATALOG.length,
    );
    for (const mission of fillerPool) {
        if (used.has(mission.id)) continue;
        visible.push(mission);
        used.add(mission.id);
        if (visible.length >= count) break;
    }
    return visible;
}

function n(v: unknown): number {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
}

export function computeProgress(mission: WeeklyMission, baseline: Record<string, unknown>, current: Record<string, unknown>): number {
    return Math.max(0, n(current[mission.counter]) - n(baseline[mission.counter]));
}

export function snapshotCounters(char: Record<string, unknown>): Record<WeeklyCounter, number> {
    const snap = {} as Record<WeeklyCounter, number>;
    for (const c of WEEKLY_COUNTERS) snap[c] = n(char[c]);
    return snap;
}
