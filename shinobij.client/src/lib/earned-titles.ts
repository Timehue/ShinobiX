/*
 * Earned-titles sync — pure helper for the achievement-grant pass in App.tsx.
 *
 * Keeps character.earnedTitles in union-sync with the title-granting
 * achievements the player has unlocked: backfills silently for existing players
 * (earnedTitles undefined) and merges any newly earned title. Titles are
 * permanent once earned (never removed) and — unlike the one-time ryo/shard
 * reward — ARE backfilled retroactively, since a title isn't currency.
 */
import { titlesForAchievementIds } from "../constants/achievements";
import type { Character } from "../types/character";

/**
 * The next earnedTitles array if it should change, or null when no update is
 * needed (so the caller can skip a redundant setState and the effect settles).
 */
export function nextEarnedTitles(character: Character, eligibleIds: string[]): string[] | null {
    const current = titlesForAchievementIds(eligibleIds);
    const existing = character.earnedTitles;
    if (existing === undefined) return current;
    const merged = Array.from(new Set([...existing, ...current]));
    return merged.length !== existing.length ? merged : null;
}
