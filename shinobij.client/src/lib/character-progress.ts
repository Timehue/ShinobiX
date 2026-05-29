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
import { rankFromLevel } from "./stats";
import { DAILY_MISSION_LIMIT, DAILY_HUNT_LIMIT, MAX_LEVEL } from "../constants/game";
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

export function hasDailyHuntSlot(character: Character) {
    return dailyHuntsCompleted(character) < DAILY_HUNT_LIMIT;
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
