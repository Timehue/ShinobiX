/** Shared display and server balance for individual-war preparations. */
import { preparationBoneCharmsForWr, RYO_PER_WR, treasuryRyoForWr } from './war-treasury-costs.js';

export const WAR_PREPARATION_KEYS = ['watchtower', 'barracks', 'warAcademy'] as const;
export type WarPreparationKey = typeof WAR_PREPARATION_KEYS[number];
export const WAR_PREPARATION_MAX_TIER = 3;
export function preparationMaxTier(kind: 'village' | 'sector', key: WarPreparationKey): number {
    return kind === 'sector' && key === 'watchtower' ? 1 : WAR_PREPARATION_MAX_TIER;
}
export const WAR_PREPARATION_DEFS = [
    { key: 'watchtower', name: 'Watchtower', description: 'Stronghold attack alerts. Village campaigns: +1 intel per tier on each player’s first successful Espionage order of the campaign day.' },
    { key: 'barracks', name: 'Barracks', description: '10% less temporary-building upkeep per tier. Combat sector defense: 5% cheaper mercenary hires per tier.' },
    { key: 'warAcademy', name: 'War Academy', description: '10% more raw supporting points per tier. Village PvE stays below the 20% effective-score ceiling; sector garrison support keeps its existing point cap.' },
] as const;
export interface WarPreparationContext {
    instance: string; rowKey: string; kind: 'village' | 'sector'; id: string;
    enemy: string; startsAt: number; endsAt: number; sector?: number;
}
export interface WarPreparation extends WarPreparationContext {
    levels: Record<WarPreparationKey, number>;
    alerts: Array<{ id: string; at: number; sector: number; mode: 'combat' | 'pet' | 'card' }>;
}
export const emptyPreparationLevels = (): WarPreparation['levels'] => ({ watchtower: 0, barracks: 0, warAcademy: 0 });
export function preparationTier(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(3, Math.floor(n))) : 0;
}
export function preparationCost(current: number): number { return 40 * (preparationTier(current) + 1); }
/** The whole price of the next tier above `current` (2026-10 rebalance, #6): its
 *  WR, plus treasury ryo and Bone Charms per WR (shared/war-treasury-costs.ts).
 *  At the default rate: 40 WR + 10,000 ryo + 20 BC, then 80 / 20,000 / 40 and
 *  120 / 30,000 / 60. `ryoPerWr` 0 is the WR-only price. */
export function preparationTreasuryCost(current: number, ryoPerWr: number = RYO_PER_WR): { wr: number; ryo: number; boneCharms: number } {
    const wr = preparationCost(current);
    return { wr, ryo: treasuryRyoForWr(wr, ryoPerWr), boneCharms: preparationBoneCharmsForWr(wr, ryoPerWr) };
}
export function preparationUpkeep(levels: WarPreparation['levels']): number {
    const raw = WAR_PREPARATION_KEYS.reduce((sum, key) => sum + 2 * preparationTier(levels[key]), 0);
    return Math.ceil(raw * (1 - preparationTier(levels.barracks) / 10));
}
export function supportPoints(base: number, academy: number): number {
    return Math.round(base * (1 + preparationTier(academy) / 10));
}
export function normalizeWarPreparations(raw: unknown): WarPreparation[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    return raw.flatMap((p): WarPreparation[] => {
        if (!p || typeof p !== 'object' || !['village', 'sector'].includes(p.kind)
            || typeof p.instance !== 'string' || !p.instance.startsWith(`${p.kind}:`)
            || typeof p.rowKey !== 'string' || typeof p.id !== 'string' || typeof p.enemy !== 'string'
            || !Number.isSafeInteger(p.startsAt) || !Number.isSafeInteger(p.endsAt) || p.endsAt <= p.startsAt
            || seen.has(p.instance)) return [];
        seen.add(p.instance);
        const levels = emptyPreparationLevels();
        for (const key of WAR_PREPARATION_KEYS) levels[key] = preparationTier(p.levels?.[key]);
        const alerts = Array.isArray(p.alerts) ? p.alerts.filter((a: WarPreparation['alerts'][number]) => a
            && typeof a.id === 'string' && Number.isSafeInteger(a.at) && Number.isSafeInteger(a.sector)
            && ['combat', 'pet', 'card'].includes(a.mode)).slice(-30) : [];
        return [{ instance: p.instance, rowKey: p.rowKey, kind: p.kind, id: p.id, enemy: p.enemy,
            startsAt: p.startsAt, endsAt: p.endsAt, ...(p.kind === 'sector' ? { sector: p.sector } : {}), levels, alerts }];
    }).slice(-32);
}
