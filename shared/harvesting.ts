/**
 * Harvesting rewards (Kama Reaping). Owner-approved 2026-11-06, see
 * docs/harvesting-minigame-plan.md §6. Harvesting pays the plain, ungraded ids
 * that recipes, supply crates and building repair already count. These ids are
 * deliberately NOT in RESOURCE_FAMILIES (shared/resource-items.ts), which would
 * mint graded ids such as `gather-field-herb-fine` that no recipe accepts.
 */
import type { SectorBiome } from './sector-geo.js';

export const HARVEST_COMMON_IDS = ['gather-field-herb', 'gather-binding-fiber'] as const;
export type HarvestCommonId = typeof HARVEST_COMMON_IDS[number];
export type HarvestTraceId = 'gather-heartwood-bark' | 'gather-shadow-thread';
export type HarvestNodeLevel = 1 | 4 | 7;

/** Only forest and shadow meadows carry a trace; the other biomes already have mining traces. */
export const HARVEST_TRACE_BY_BIOME: Readonly<Partial<Record<SectorBiome, HarvestTraceId>>> = {
    forest: 'gather-heartwood-bark', shadow: 'gather-shadow-thread',
};
/** Level 7 matches the 15% exploration finds give today (GATHER_TRACE_CHANCE). */
export const HARVEST_TRACE_CHANCE: Readonly<Record<HarvestNodeLevel, number>> = { 1: 0, 4: 0.08, 7: 0.15 };
/** Every stroke clean and no roots torn: the skill reward that grades give mining. */
export const HARVEST_PERFECT_PERFORMANCE = 10;

export function isHarvestCommonId(value: unknown): value is HarvestCommonId {
    return HARVEST_COMMON_IDS.includes(value as HarvestCommonId);
}
export function harvestTraceFor(biome: SectorBiome, level: HarvestNodeLevel): HarvestTraceId | undefined {
    return level === 1 ? undefined : HARVEST_TRACE_BY_BIOME[biome];
}

export type HarvestPayout = { itemId: HarvestCommonId; count: 1 | 2; traceId?: HarvestTraceId };
/**
 * What one successful harvest pays, from the SEALED rules and draw only. A
 * failure pays nothing, so callers only ask on success. Relaxed (animation) mode
 * always has performance 0, so it never earns the perfect bonus.
 */
export function harvestPayout(input: {
    family: HarvestCommonId; level: HarvestNodeLevel; trace?: HarvestTraceId; performance: number; traceDraw: number;
}): HarvestPayout {
    const count = input.performance >= HARVEST_PERFECT_PERFORMANCE ? 2 : 1;
    const chance = HARVEST_TRACE_CHANCE[input.level] ?? 0;
    const traced = input.trace && Number.isFinite(input.traceDraw) && input.traceDraw < chance;
    return { itemId: input.family, count, ...(traced ? { traceId: input.trace } : {}) };
}
