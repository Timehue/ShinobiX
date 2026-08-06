import type { ClanBossContributionResult } from '../../shared/clan-boss-operation.js';
import { sectorName, sectorRegionLabel } from '../../shared/sector-geo.js';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import type { ClanBossDef } from './_storage.js';

export type ClanBossSectorState = {
    weekId: string;
    bossId: string;
    sectorId: number;
    sectorName: string;
    regionName: string;
    pressure: number;
    version: number;
    updatedAt: number;
    runReceipts: string[];
};

export const sectorStateKey = (weekId: string) => `clan-boss:sector-state:${weekId}`;
export const SECTOR_PRESSURE_MILESTONES = [75, 50, 25, 0] as const;

/** Returns the single herald threshold crossed by a bounded operation update. */
export function sectorPressureMilestone(before: number, after: number): number | undefined {
    const safeBefore = Math.max(0, Math.min(100, before));
    const safeAfter = Math.max(0, Math.min(safeBefore, after));
    return SECTOR_PRESSURE_MILESTONES.find((milestone) => safeBefore > milestone && safeAfter <= milestone);
}

export function newSectorState(weekId: string, boss: ClanBossDef, now = Date.now()): ClanBossSectorState {
    return {
        weekId,
        bossId: boss.id,
        sectorId: boss.sectorId,
        sectorName: sectorName(boss.sectorId) ?? `Sector ${boss.sectorId}`,
        regionName: sectorRegionLabel(boss.sectorId) ?? 'the wilderness',
        pressure: 100,
        version: 1,
        updatedAt: now,
        runReceipts: [],
    };
}

export async function loadSectorState(weekId: string, boss: ClanBossDef): Promise<ClanBossSectorState> {
    return (await kv.get<ClanBossSectorState>(sectorStateKey(weekId))) ?? newSectorState(weekId, boss);
}

export function operationPressureReduction(damage: number, contributions: Record<string, ClanBossContributionResult>): number {
    const active = Object.values(contributions).filter((entry) => entry.active).length;
    if (Math.max(0, damage) <= 0 || active <= 0) return 0;
    return Math.min(8, 1 + Math.floor(Math.max(0, damage) / 3_000) + Math.min(3, active - 1));
}

export async function applyOperationPressure(input: {
    weekId: string;
    boss: ClanBossDef;
    runId: string;
    damage: number;
    contributions: Record<string, ClanBossContributionResult>;
    now?: number;
}): Promise<{ state: ClanBossSectorState; reducedBy: number; replayed: boolean; crossedMilestone?: number }> {
    const key = sectorStateKey(input.weekId);
    return withKvLock(key, async () => {
        const current = (await kv.get<ClanBossSectorState>(key)) ?? newSectorState(input.weekId, input.boss, input.now);
        if (current.runReceipts.includes(input.runId)) return { state: current, reducedBy: 0, replayed: true };
        const reducedBy = operationPressureReduction(input.damage, input.contributions);
        const next: ClanBossSectorState = {
            ...current,
            pressure: Math.max(0, current.pressure - reducedBy),
            version: current.version + 1,
            updatedAt: input.now ?? Date.now(),
            runReceipts: [input.runId, ...current.runReceipts].slice(0, 500),
        };
        await kv.set(key, next, { ex: 9 * 24 * 60 * 60 });
        return {
            state: next,
            reducedBy,
            replayed: false,
            crossedMilestone: sectorPressureMilestone(current.pressure, next.pressure),
        };
    }, { failClosed: true });
}
