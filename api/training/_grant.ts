import { gainXp } from '../_xp-engine.js';
import { statCapForLevel } from '../_stat-growth.js';

export function applyTrainingGrant(
    character: Record<string, unknown>,
    stat: string,
    sealedGain: number,
    sealedXp: number,
): { character: Record<string, unknown>; applied: number; cap: number } {
    const leveled = gainXp(character, Math.max(0, Math.floor(sealedXp))) as Record<string, unknown>;
    const cap = statCapForLevel(Math.max(1, Number(leveled.level) || 1));
    const stats = { ...(leveled.stats as Record<string, number> | undefined ?? {}) };
    const current = Math.max(10, Math.floor(Number(stats[stat]) || 10));
    const next = Math.min(cap, current + Math.max(0, Math.floor(sealedGain)));
    const applied = Math.max(0, next - current);
    stats[stat] = next;
    return {
        character: {
            ...leveled,
            stats,
            totalStatsTrained: Math.max(0, Math.floor(Number(leveled.totalStatsTrained) || 0)) + applied,
        },
        applied,
        cap,
    };
}
