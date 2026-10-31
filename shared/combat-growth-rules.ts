/** Shared display and settlement limits; changing these changes progression balance. */
/** Maximum of the uniform 1–6 stat-point roll for an eligible PvP win. */
export const PVP_STAT_POINTS_PER_WIN = 6;
export const DAILY_PVP_STAT_CAP = 50;
/** Maximum of the uniform 0–3 stat-point roll for an eligible PvE win. */
export const AI_PVE_STAT_POINTS_PER_WIN = 3;
/**
 * Hunt claims, field claims and PvE wins share this daily stat-point budget.
 * PvP has its own DAILY_PVP_STAT_CAP. Boost events scale eligible mission
 * requests, never these caps or the combat-win rolls. Idle training and one-time grants (story,
 * Academy, Story Tower, Apex, weekly bosses) stay outside it. This is the code
 * default of the server dial DAILY_STAT_POINT_CAP (api/_stat-growth.ts).
 */
export const DAILY_STAT_POINT_CAP = 120;
/** The combat name is kept for existing imports; combat draws from the one budget. */
export const DAILY_COMBAT_STAT_CAP = DAILY_STAT_POINT_CAP;
