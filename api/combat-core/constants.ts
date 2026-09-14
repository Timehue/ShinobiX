// Shared PvP combat constants that are not balance formulas.
// Formula constants stay in api/pvp/move.ts while parity tests still read that
// file as the server source of truth.

export const GRID_W = 12;
export const GRID_H = 10;
export const MAX_ROUNDS = 25;
export const MAX_ACTIONS = 5;

// AOE_SPIRAL ground-nova footprint radius. Mirror in the client preview
// (shinobij.client/src/screens/PvpBattleScreen.tsx PVP_SPIRAL_RADIUS).
export const SPIRAL_RADIUS = 2;

// Must match api/pvp/session.ts. Each successful move refreshes the session TTL.
export const SESSION_TTL = 15 * 60;
/**
 * How long an ACTIVE PvP row stays in storage PAST its gameplay expiry (F08).
 * `SESSION_TTL` of silence is when a duel lapses; the row outlives that so the
 * lapse is recorded as a draw from the session's own evidence
 * (api/pvp/_lapse.ts) instead of vanishing untouched.
 */
export const PVP_LAPSED_RETENTION_SECONDS = 24 * 60 * 60;
export const PVP_ACTIVE_ROW_TTL = SESSION_TTL + PVP_LAPSED_RETENTION_SECONDS;
/** Terminal PvP rows outlive the active-turn TTL so lost reward responses and
 * completion ACKs can be repaired for the full durable claim window. */
export const PVP_TERMINAL_REPLAY_TTL = 48 * 60 * 60;
