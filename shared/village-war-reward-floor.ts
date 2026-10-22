/**
 * The collusive-surrender floor (2026-10 rebalance, framework I-5).
 *
 * A village war that ends by surrender or by an agreed peace before this many
 * hours of LIVE war pays no crates, purses or MVP rewards to either side; its
 * stats still count. Shared so the War Hall's confirm copy names the floor the
 * server applies (api/war/_early-end.ts reads the WAR_MIN_DURATION_HOURS dial,
 * whose code default is this constant).
 */
export const VILLAGE_WAR_REWARD_MIN_DURATION_HOURS = 72;
