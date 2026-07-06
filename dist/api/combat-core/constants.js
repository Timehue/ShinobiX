"use strict";
// Shared PvP combat constants that are not balance formulas.
// Formula constants stay in api/pvp/move.ts while parity tests still read that
// file as the server source of truth.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SESSION_TTL = exports.SPIRAL_RADIUS = exports.MAX_ACTIONS = exports.MAX_ROUNDS = exports.GRID_H = exports.GRID_W = void 0;
exports.GRID_W = 12;
exports.GRID_H = 10;
exports.MAX_ROUNDS = 25;
exports.MAX_ACTIONS = 5;
// AOE_SPIRAL ground-nova footprint radius. Mirror in the client preview
// (shinobij.client/src/screens/PvpBattleScreen.tsx PVP_SPIRAL_RADIUS).
exports.SPIRAL_RADIUS = 2;
// Must match api/pvp/session.ts. Each successful move refreshes the session TTL.
exports.SESSION_TTL = 15 * 60;
