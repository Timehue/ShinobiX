/**
 * Compatibility exports for the historical PvP import path. Hex AOE geometry
 * is runtime-neutral and now lives in combat-core so PvP, Solo and Tower cannot
 * grow separate footprint implementations.
 */
export { filledDiskTiles, ringTiles, spiralTiles } from '../combat-core/aoe.js';
export { axial as axialOf, hexDistance } from '../combat-core/grid.js';
