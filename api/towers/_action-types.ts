import type { TowerAction } from './_engine.js';

/** Public Tower command discriminants. Endpoints validate against this explicit
 * allowlist so malformed or newly introduced client values fail closed before
 * AFK advancement or any engine mutation. */
export const TOWER_ACTION_TYPES = [
    'move', 'dash', 'attack', 'jutsu', 'weapon', 'item', 'heal', 'cleanse', 'clear', 'summon', 'wait',
] as const satisfies readonly TowerAction['type'][];

const TOWER_ACTION_TYPE_SET = new Set<string>(TOWER_ACTION_TYPES);

export function isTowerActionType(value: unknown): value is TowerAction['type'] {
    return typeof value === 'string' && TOWER_ACTION_TYPE_SET.has(value);
}
