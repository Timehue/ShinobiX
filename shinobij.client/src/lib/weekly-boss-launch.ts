/*
 * "Stand & Fight" against the roaming Weekly Boss, handed from the World Map to
 * the Weekly Boss screen.
 *
 * The roaming boss is fought where it stands: the map's encounter prompt is the
 * ONLY way to challenge it (the Weekly Boss screen is a tracker in roaming mode,
 * and its button just points back at the map). The prompt used to call App's
 * launchWeeklyBossFight, which started the fight. When Weekly Boss combat moved
 * onto the Solo PvE runtime that function was deleted and the prop became a bare
 * `navigate("weeklyBoss")` — so "Stand & Fight" opened the tracker, the tracker
 * sent the player back to the map, and the boss could not be fought at all.
 *
 * The map now STAGES a launch here before navigating, and the Weekly Boss screen
 * picks it up on mount: it starts (or resumes — the server's startFight replays
 * a live run and never charges twice) the fight, and sends the player back to
 * the screen they fought from when it ends. Nothing is persisted: a reload lands
 * on the tracker, whose recovery button resumes an interrupted fight.
 */
import type { Screen } from "../types/core";

export type WeeklyBossLaunch = { returnScreen: Screen; stagedAt: number };

/** A launch is consumed by the very next mount; anything older is stale. */
export const WEEKLY_BOSS_LAUNCH_TTL_MS = 30_000;

let staged: WeeklyBossLaunch | null = null;

export function stageWeeklyBossFight(returnScreen: Screen, now: number = Date.now()): void {
    staged = { returnScreen, stagedAt: now };
}

/**
 * The staged launch, if a fresh one exists. Read-only on purpose: a state
 * initializer runs twice under StrictMode, and a consuming read would hand the
 * launch to the discarded call. The screen clears it once it has acted on it.
 */
export function peekWeeklyBossLaunch(now: number = Date.now()): WeeklyBossLaunch | null {
    if (!staged || now - staged.stagedAt > WEEKLY_BOSS_LAUNCH_TTL_MS) return null;
    return staged;
}

/** Drop the launch once acted on. A newer launch staged meanwhile is kept. */
export function clearWeeklyBossLaunch(launch: WeeklyBossLaunch): void {
    if (staged === launch) staged = null;
}
