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
