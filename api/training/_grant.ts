import { applyDerivedLevel } from '../_xp-engine.js';
import { statCapForLevel } from '../_stat-growth.js';

// Apply a sealed training gain to the chosen stat. Stat-derived leveling
// (docs/leveling-without-xp-map.md): the rank cap still bounds the STAT, but
// cap-truncated overflow rolls into unspentStats instead of being destroyed —
// earned points are level progress now, so a cap-blocked trainer keeps
// progressing (same never-wasted rule as computeCombatStatGrowth). Character XP
// is retired; the third parameter is kept so call sites read naturally but no
// XP is granted. Ends with the rise-only derived-level recompute (level-ups +
// vitals refill happen here, where the earned ledger just moved).
export function applyTrainingGrant(
    character: Record<string, unknown>,
    stat: string,
    sealedGain: number,
    _retiredSealedXp: number,
): { character: Record<string, unknown>; applied: number; overflow: number; cap: number } {
    const cap = statCapForLevel(Math.max(1, Number(character.level) || 1));
    const stats = { ...(character.stats as Record<string, number> | undefined ?? {}) };
    const gain = Math.max(0, Math.floor(sealedGain));
    const current = Math.max(10, Math.floor(Number(stats[stat]) || 10));
    const next = Math.min(cap, current + gain);
    const applied = Math.max(0, next - current);
    const overflow = Math.max(0, gain - applied);
    stats[stat] = next;
    const granted = {
        ...character,
        stats,
        unspentStats: Math.max(0, Math.floor(Number(character.unspentStats) || 0)) + overflow,
        totalStatsTrained: Math.max(0, Math.floor(Number(character.totalStatsTrained) || 0)) + applied,
    };
    return { character: applyDerivedLevel(granted) as Record<string, unknown>, applied, overflow, cap };
}
