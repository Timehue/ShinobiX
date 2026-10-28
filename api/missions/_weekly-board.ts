/*
 * Weekly mission board - a global rotating catalog filtered per player.
 *
 * The raw weekly pick is seeded by the week key only, but the handler returns a
 * player-eligible view. If a global mission is locked for the player, safe
 * mission-completion fallbacks fill the visible slots so low-level players never
 * lose weekly capacity to impossible endgame objectives.
 */

import { canPlayerReceiveMission, type MissionEligibility, type MissionEligibilityContext } from './_eligibility.js';
import { RANKED_MIN_LEVEL } from '../../shared/ranked-eligibility.js';

export type WeeklyCounter =
    | 'rankedWins'
    | 'totalMissionsCompleted'
    | 'fishingXp'
    | 'miningXp'
    | 'hollowGateWardenKills';

export const WEEKLY_COUNTERS: WeeklyCounter[] = [
    'rankedWins',
    'totalMissionsCompleted',
    'fishingXp',
    'miningXp',
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

const rankedEligibility: MissionEligibility = { minLevel: RANKED_MIN_LEVEL, requiresRankedUnlocked: true };
const safeEligibility: MissionEligibility = { minLevel: 1 };
const hollowGateWardenEligibility: MissionEligibility = {
    minLevel: 100,
    requiresHollowGateUnlocked: true,
    requiresVillage: true,
};

const LEGACY_WEEKLY_CATALOG: WeeklyMission[] = [
    { id: 'wk-ranked-3', name: 'Ladder Climber', desc: 'Win 3 ranked matches.', counter: 'rankedWins', target: 3, reward: { ryo: 4000, fateShards: 1 }, eligibility: rankedEligibility },
    { id: 'wk-ranked-7', name: 'Ranked Grinder', desc: 'Win 7 ranked matches.', counter: 'rankedWins', target: 7, reward: { ryo: 8000, fateShards: 2 }, eligibility: rankedEligibility },
    { id: 'wk-missions-10', name: 'Dutiful', desc: 'Complete 10 missions.', counter: 'totalMissionsCompleted', target: 10, reward: { ryo: 4000, boneCharms: 2 }, eligibility: safeEligibility },
    { id: 'wk-missions-25', name: 'Tireless', desc: 'Complete 25 missions.', counter: 'totalMissionsCompleted', target: 25, reward: { ryo: 8000, fateShards: 2 }, eligibility: safeEligibility },
    { id: 'wk-hollow-warden', name: 'Hollow Hound Alpha', desc: 'Defeat the Hollow Hound Alpha once.', counter: 'hollowGateWardenKills', target: 1, reward: { ryo: 12000, fateShards: 3, boneCharms: 4 }, eligibility: hollowGateWardenEligibility },
];

const LEGACY_FALLBACK_CATALOG: WeeklyMission[] = [
    { id: 'wk-safe-missions-5', name: 'Reliable Shinobi', desc: 'Complete 5 missions.', counter: 'totalMissionsCompleted', target: 5, reward: { ryo: 2500, boneCharms: 1 }, eligibility: safeEligibility },
    { id: 'wk-safe-missions-15', name: 'Steady Service', desc: 'Complete 15 missions.', counter: 'totalMissionsCompleted', target: 15, reward: { ryo: 5500, boneCharms: 2 }, eligibility: safeEligibility },
    { id: 'wk-safe-missions-20', name: 'Village Backbone', desc: 'Complete 20 missions.', counter: 'totalMissionsCompleted', target: 20, reward: { ryo: 6500, fateShards: 1 }, eligibility: safeEligibility },
];

// Side goals for several ordinary sessions, with room for normal progression.
// From skill level 1 at common nodes, gathering takes about 66/96 relaxed
// attempts. The hardest fishing+mining pair uses under 30% of the shared
// weekly allowance; players need not spend most Explore actions on the board.
const WEEKLY_REBALANCE: Record<string, Pick<WeeklyMission, 'target' | 'desc'>> = {
    'wk-ranked-3': { target: 15, desc: 'Win 15 ranked matches.' },
    'wk-ranked-7': { target: 25, desc: 'Win 25 ranked matches.' },
    'wk-missions-10': { target: 60, desc: 'Complete 60 missions.' },
    'wk-missions-25': { target: 80, desc: 'Complete 80 missions.' },
    'wk-hollow-warden': { target: 4, desc: 'Defeat the Hollow Hound Alpha 4 times.' },
    'wk-safe-missions-5': { target: 45, desc: 'Complete 45 missions.' },
    'wk-safe-missions-15': { target: 60, desc: 'Complete 60 missions.' },
    'wk-safe-missions-20': { target: 70, desc: 'Complete 70 missions.' },
};

export const WEEKLY_CATALOG: WeeklyMission[] = [
    { id: 'wk-fishing-500', name: 'Gone Fishing', desc: 'Earn 500 fishing skill XP at fishing nodes.', counter: 'fishingXp', target: 500, reward: { ryo: 2500, boneCharms: 1 }, eligibility: safeEligibility },
    { id: 'wk-fishing-750', name: 'Patient Angler', desc: 'Earn 750 fishing skill XP at fishing nodes.', counter: 'fishingXp', target: 750, reward: { ryo: 5500, fateShards: 1 }, eligibility: safeEligibility },
    { id: 'wk-mining-500', name: 'Ore Seeker', desc: 'Earn 500 mining skill XP at mining nodes.', counter: 'miningXp', target: 500, reward: { ryo: 2500, boneCharms: 1 }, eligibility: safeEligibility },
    { id: 'wk-mining-750', name: 'Deep Delver', desc: 'Earn 750 mining skill XP at mining nodes.', counter: 'miningXp', target: 750, reward: { ryo: 5500, fateShards: 1 }, eligibility: safeEligibility },
    ...LEGACY_WEEKLY_CATALOG.map((mission) => ({ ...mission, ...WEEKLY_REBALANCE[mission.id] })),
];

export const WEEKLY_FALLBACK_CATALOG: WeeklyMission[] = LEGACY_FALLBACK_CATALOG.map((mission) => ({
    ...mission, ...WEEKLY_REBALANCE[mission.id],
}));

export const WEEKLY_CLAIMABLE_CATALOG: WeeklyMission[] = [
    ...WEEKLY_CATALOG,
    ...WEEKLY_FALLBACK_CATALOG,
];

export const WEEK_EPOCH_MS = Date.UTC(2024, 0, 1);
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const WEEKLY_BOARD_SIZE = 4;
// Expand the pool at the Monday reset, preserving already-active assignments.
// Week 148 begins 2026-11-02 00:00 UTC.
export const RESOURCE_WEEKLY_START_WEEK = 148;

function expandedRotation(wkKey: string): boolean {
    const week = /^w(\d+)$/.exec(wkKey);
    return !week || Number(week[1]) >= RESOURCE_WEEKLY_START_WEEK;
}

function catalogForWeek(wkKey: string, includeFallbacks = false): WeeklyMission[] {
    const expanded = expandedRotation(wkKey);
    const catalog = expanded ? WEEKLY_CATALOG : LEGACY_WEEKLY_CATALOG;
    const fallbacks = expanded ? WEEKLY_FALLBACK_CATALOG : LEGACY_FALLBACK_CATALOG;
    return includeFallbacks ? [...catalog, ...fallbacks] : catalog;
}

export function weeklyMissionById(wkKey: string, id: string): WeeklyMission | undefined {
    return catalogForWeek(wkKey, true).find((mission) => mission.id === id);
}

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

function pickFromWeeklyPool(pool: WeeklyMission[], seed: string, count: number, diverse = false): WeeklyMission[] {
    const take = Math.min(count, pool.length);
    const rng = mulberry32(stringHash(seed));
    const remaining = [...pool];
    const chosen: WeeklyMission[] = [];
    for (let i = 0; i < take; i += 1) {
        const unusedCounters = diverse ? remaining.filter((mission) => !chosen.some((picked) => picked.counter === mission.counter)) : [];
        const candidates = unusedCounters.length > 0 ? unusedCounters : remaining;
        const mission = candidates[Math.floor(rng() * candidates.length)];
        chosen.push(remaining.splice(remaining.indexOf(mission), 1)[0]);
    }
    return chosen;
}

export function pickWeeklyBoard(wkKey: string, count: number = WEEKLY_BOARD_SIZE): WeeklyMission[] {
    return pickFromWeeklyPool(catalogForWeek(wkKey), wkKey, count, expandedRotation(wkKey));
}

export function pickWeeklyBoardForPlayer(
    wkKey: string,
    character: Record<string, unknown> | null | undefined,
    count: number = WEEKLY_BOARD_SIZE,
    context: MissionEligibilityContext = {},
    claimedIds: readonly string[] = [],
): WeeklyMission[] {
    const selected = pickWeeklyBoard(wkKey, count);
    const catalog = catalogForWeek(wkKey, true);
    // Completed work keeps its slot even when a level/unlock change replaces
    // the remaining eligible objectives. This also bounds payouts to four.
    const claimed = catalog.filter((mission) => claimedIds.includes(mission.id));
    const eligible = selected.filter((mission) => canPlayerReceiveMission(character ?? {}, mission, context).ok);
    const visible = [...claimed, ...eligible.filter((mission) => !claimedIds.includes(mission.id))].slice(0, count);
    const used = new Set(visible.map((mission) => mission.id));
    if (visible.length >= count) return visible.slice(0, count);

    const fillerPool = pickFromWeeklyPool(
        catalog.filter((mission) =>
            !used.has(mission.id) && canPlayerReceiveMission(character ?? {}, mission, context).ok
        ),
        `${wkKey}:fallback`,
        catalog.length,
    );
    while (visible.length < count && fillerPool.length > 0) {
        const expanded = expandedRotation(wkKey);
        const unusedCounter = expanded
            ? fillerPool.findIndex((mission) => !visible.some((picked) => picked.counter === mission.counter))
            : -1;
        const unusedObjective = expanded
            ? fillerPool.findIndex((mission) => !visible.some((picked) => picked.counter === mission.counter && picked.target === mission.target))
            : -1;
        const index = unusedCounter >= 0 ? unusedCounter : unusedObjective >= 0 ? unusedObjective : 0;
        const mission = fillerPool.splice(index, 1)[0];
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
    // A board opened before these activities joined the rotation has no
    // baseline for them yet. Never credit a lifetime of XP as weekly progress.
    if ((mission.counter === 'fishingXp' || mission.counter === 'miningXp')
        && baseline[mission.counter] === undefined) return 0;
    return Math.max(0, snapshotCounters(current)[mission.counter] - n(baseline[mission.counter]));
}

export function snapshotCounters(char: Record<string, unknown>): Record<WeeklyCounter, number> {
    const snap = {} as Record<WeeklyCounter, number>;
    const resources = (char.resourceGathering ?? {}) as Record<string, unknown>;
    for (const c of WEEKLY_COUNTERS) snap[c] = n(c === 'fishingXp' || c === 'miningXp' ? resources[c] : char[c]);
    return snap;
}

/** Keep this week's assignments through level-ups; replace only blocked work. */
export function resolveWeeklyBoardForRecord(
    wkKey: string,
    character: Record<string, unknown>,
    record: { baseline: Record<string, unknown>; claimed: readonly string[]; missionIds?: readonly string[] },
    context: MissionEligibilityContext = {},
): WeeklyMission[] {
    const current = pickWeeklyBoardForPlayer(wkKey, character, WEEKLY_BOARD_SIZE, context, record.claimed);
    if (!Array.isArray(record.missionIds)) return current;
    const assigned = record.missionIds.flatMap((id) => {
        const mission = weeklyMissionById(wkKey, id);
        return mission ? [mission] : [];
    });
    const kept = assigned.filter((mission, index) => assigned.findIndex((m) => m.id === mission.id) === index && (
        record.claimed.includes(mission.id)
        || computeProgress(mission, record.baseline, character) >= mission.target
        || canPlayerReceiveMission(character, mission, context).ok
    ));
    const paid = catalogForWeek(wkKey, true).filter((mission) => record.claimed.includes(mission.id));
    const visible = (paid.every((mission) => kept.some((m) => m.id === mission.id))
        ? kept
        : [...paid, ...kept.filter((mission) => !record.claimed.includes(mission.id))]).slice(0, WEEKLY_BOARD_SIZE);
    const replacements = current.filter((mission) => !visible.some((m) => m.id === mission.id));
    while (visible.length < WEEKLY_BOARD_SIZE && replacements.length > 0) {
        const unusedCounter = replacements.findIndex((mission) => !visible.some((m) => m.counter === mission.counter));
        const unusedObjective = replacements.findIndex((mission) => !visible.some((m) => m.counter === mission.counter && m.target === mission.target));
        const index = unusedCounter >= 0 ? unusedCounter : unusedObjective >= 0 ? unusedObjective : 0;
        visible.push(replacements.splice(index, 1)[0]);
    }
    return visible;
}
