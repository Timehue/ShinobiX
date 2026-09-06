/*
 * Per-character daily progress + rank-title display.
 *
 *   • daily missions  — count/slot/mark for the daily mission pool
 *   • daily hunts      — independent Hunter Guild daily pool
 *   • rank titles      — role-title resolution + level→display-title
 *
 * Pure functions depending only on lib/utils, lib/stats, constants/game and the
 * Character type. Extracted from App.tsx (Region A, character cluster).
 */

import { currentDateKey, currentMonthKey } from "./utils";
import { rankFromLevel, earnedForLevel, earnedStatPoints } from "./stats";
import { DAILY_MISSION_LIMIT, DAILY_HUNT_LIMIT, MAX_LEVEL, EXAM_LEVEL_GATES } from "../constants/game";
import type { Character } from "../types/character";

const levelOnlyRankTitles = new Set([
    "Academy Student",
    "Genin",
    "Chunin",
    "Jonin",
    "Elite Jonin",
    "Special Jonin",
    "Kage",
    "Legendary Kage",
]);

export function dailyMissionsCompleted(character: Character) {
    return character.lastDailyReset === currentDateKey() ? character.dailyMissionsCompleted ?? 0 : 0;
}

export { deriveStoryTraits, DERIVED_TRAIT_LEVELS } from "./story-derive";

export function hasDailyMissionSlot(character: Character) {
    return dailyMissionsCompleted(character) < DAILY_MISSION_LIMIT;
}

export function markMissionCompleted(character: Character): Character {
    return {
        ...character,
        clanMissionContrib: (character.clanMissionContrib ?? 0) + 1,
        totalMissionsCompleted: (character.totalMissionsCompleted ?? 0) + 1,
        dailyMissionsCompleted: dailyMissionsCompleted(character) + 1,
        lastDailyReset: currentDateKey(),
        clanContribMonth: currentMonthKey(),
    };
}

// Hunter Guild contracts use a daily pool independent of missions — its own
// counter and reset key (lastHuntReset), so 20 hunts and 20 missions can be
// done in the same day. Clan/lifetime aggregates still tick up like missions.
export function dailyHuntsCompleted(character: Character) {
    return character.lastHuntReset === currentDateKey() ? character.dailyHuntsCompleted ?? 0 : 0;
}

// Hunter Rank QoL perk: base cap + 1 hunt/day per rank (20 → 25 at Warden).
// Mirror of api/missions/_mission-catalog.ts dailyHuntCap. Display + gate use this
// so the shown cap matches what the server enforces.
export function dailyHuntCap(character: Character) {
    return DAILY_HUNT_LIMIT + Math.max(0, Math.min(5, Math.floor(character.hunterRank ?? 0)));
}

export function hasDailyHuntSlot(character: Character) {
    return dailyHuntsCompleted(character) < dailyHuntCap(character);
}

export function markHuntCompleted(character: Character): Character {
    return {
        ...character,
        clanMissionContrib: (character.clanMissionContrib ?? 0) + 1,
        totalMissionsCompleted: (character.totalMissionsCompleted ?? 0) + 1,
        dailyHuntsCompleted: dailyHuntsCompleted(character) + 1,
        lastHuntReset: currentDateKey(),
        clanContribMonth: currentMonthKey(),
    };
}

function roleRankTitle(character: Character) {
    const currentTitle = character.rankTitle?.trim();
    const lowerTitle = currentTitle?.toLowerCase() ?? "";
    const isRoleTitle = lowerTitle.includes("kage") ||
        lowerTitle.includes("elder") ||
        lowerTitle.includes("anbu") ||
        lowerTitle.includes("clan leader") ||
        lowerTitle.includes("clan head");

    if (currentTitle && isRoleTitle && !levelOnlyRankTitles.has(currentTitle)) return currentTitle;
    if (character.clanFounder) return "Clan Leader";
    return "";
}

export function rankTitleForLevel(character: Character, level: number) {
    if (level < MAX_LEVEL) return rankFromLevel(level);
    return roleRankTitle(character) || "Special Jonin";
}

// ── Level progress (docs/leveling-without-xp-map.md) ────────────────────────
// Every level bar in the game reads this so they agree, and so none of them
// lies during a rank-exam hold. The hold is the exact moment a player asks
// "why am I not leveling?" — earned points keep climbing past the next
// threshold while the level is frozen, so a naive "points to next level"
// readout would proudly report 0 while nothing happens. `heldBy` names the
// exam instead, and the points are truthfully described as banked.
export type LevelProgress = {
    /** Total stat points earned — the number the level is derived from. */
    earned: number;
    /** Points still needed for the next level (0 when maxed or exam-held). */
    remaining: number;
    /** 0-100 bar fill. */
    percent: number;
    /** Numeric readout, e.g. "1,840 / 2,240 pts", "MAX", or "3,410 pts banked". */
    label: string;
    maxed: boolean;
    /** The exam label ("Genin Advancement Exam") when the level is frozen behind it. */
    heldBy: string | null;
};

export function levelProgress(character: Pick<Character, "level" | "stats" | "unspentStats" | "examsPassed">): LevelProgress {
    const level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(character.level ?? 1)));
    const earned = earnedStatPoints(character);
    if (level >= MAX_LEVEL) {
        return { earned, remaining: 0, percent: 100, label: "MAX", maxed: true, heldBy: null };
    }
    const passed = character.examsPassed ?? [];
    const gate = EXAM_LEVEL_GATES.find((g) => !passed.includes(g.exam));
    if (gate && level >= gate.level) {
        return {
            earned,
            remaining: 0,
            percent: 100,
            label: `${earned.toLocaleString()} pts banked`,
            maxed: false,
            heldBy: gate.label,
        };
    }
    const floor = earnedForLevel(level);
    const next = earnedForLevel(level + 1);
    const span = Math.max(1, next - floor);
    const into = Math.max(0, Math.min(span, earned - floor));
    return {
        earned,
        remaining: Math.max(0, next - earned),
        percent: Math.min(100, Math.round((into / span) * 100)),
        label: `${earned.toLocaleString()} / ${next.toLocaleString()} pts`,
        maxed: false,
        heldBy: null,
    };
}
