import { ITEM_CATALOG } from './pvp/_item-catalog.js';
import { effectiveItemLevelReq } from '../shared/item-level-gate.js';

/** Fixed server-owned equipment progression. No player HP, build or input is
 * read. Only explicit veteran ordinary/named challenges and the final Kage
 * opt in; this is not a gear buff for all profiles sharing a catalog identity. */
export function pveChallengeWeapon(level: number, difficulty: unknown, classified: boolean, roleId?: unknown) {
    if (!classified || level < 61 || !['standard', 'dangerous', 'elite', 'final-kage'].includes(String(difficulty))) return null;
    // The defensive specialist keeps Absorb. Other veteran roles carry a
    // counter blade: its public Reflect punishes attacking through the stance,
    // with the same EP/range/cooldown as the defensive blade. Clear and waiting
    // out the stance remain legal answers; selection never reads a player kit.
    const id = level >= 80 ? roleId === 'builtin-ai-mist-sentinel' ? 'ashen-dragon-katana' : 'worldsplitter-katana'
        : level >= 65 ? 'elderbranch-katana' : 'frostbite-cleaver';
    const item = ITEM_CATALOG[id];
    return item && effectiveItemLevelReq(item) <= level ? { ...item } : null;
}
