/** Shared display and settlement limits; changing these changes progression balance. */
export const PVP_STAT_POINTS_PER_WIN = 6;
export const AI_PVE_STAT_POINTS_PER_WIN = 3;
/**
 * The ONE shared daily stat-point budget (owner ruling A1, 2026-10 rebalance):
 * hunt claims, field claims, PvE wins and PvP wins all pay their stat points
 * until this many have been granted in the UTC day. Boost events scale each
 * activity's request, never this cap. Idle training and one-time grants (story,
 * Academy, Story Tower, Apex, weekly bosses) stay outside it. This is the code
 * default of the server dial DAILY_STAT_POINT_CAP (api/_stat-growth.ts).
 */
export const DAILY_STAT_POINT_CAP = 60;
/** The combat name is kept for existing imports; combat draws from the one budget. */
export const DAILY_COMBAT_STAT_CAP = DAILY_STAT_POINT_CAP;
