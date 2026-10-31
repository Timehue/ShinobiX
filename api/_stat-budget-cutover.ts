/**
 * Event-day cutover, not request/deployment time. Deploy and drain the old
 * workers before this UTC boundary; otherwise move the boundary forward.
 * Old event days always retain their shared counter and original 60 cap so
 * delayed claims and crash retries cannot acquire a second allocation.
 */
import { DAILY_PVP_STAT_CAP } from '../shared/combat-growth-rules.js';

export const STAT_BUDGET_SPLIT_DAY = '2026-11-02';
export const LEGACY_SHARED_STAT_CAP = 60;

export function splitStatBudgetDay(day: string): boolean {
    return day >= STAT_BUDGET_SPLIT_DAY;
}

export function effectiveStatBudgetCap(day: string, cap: number, pvp = false): number {
    if (splitStatBudgetDay(day)) return cap;
    return pvp && cap === DAILY_PVP_STAT_CAP ? LEGACY_SHARED_STAT_CAP : Math.min(cap, LEGACY_SHARED_STAT_CAP);
}
