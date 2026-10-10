/*
 * War Map mercenaries — the war a band is hired FOR (owner redesign 2026-10-08).
 *
 * Every band hired since the redesign is bound to ONE war context and acts only
 * there, and only while that exact war instance is live:
 *   - village: an all-out village war. Identified by its pair-row id plus the
 *     declaration generation, because a rematch reuses the row and bumps the
 *     generation — so a band (and the per-war hire allowance) never carries
 *     over into the next war between the same two villages.
 *   - sector:  a Combat sector-war contest, which only its DEFENDING village may
 *     hire for. Identified by the contest id plus sectorWarInstanceTag, since a
 *     contest id repeats across re-sieges of the same sector.
 *
 * The village-war rows belong to api/world-state.ts. This module only READS
 * them, mirroring that file's predicates (keep in sync, as the retired
 * api/village/hire-mercenary.ts lookup always has).
 */
import { kv, type KvLike } from './_storage.js';
import { warDeclarationFundingMarkerFromRow } from './_war-declaration-funding.js';
import { warHasMercenaryFundingField } from './_war-mercenary-hire.js';
import { isSectorWarActive, sectorWarInstanceTag, type SectorWarSession } from './_sector-war.js';
import type { MercLeaseContext } from './_war-state.js';

/** Mirrors api/world-state.ts VILLAGE_WAR_KEY_PREFIX. */
export const VILLAGE_WAR_ROW_PREFIX = 'world:war:';
/** Mirrors api/world-state.ts VILLAGE_WAR_MAX_DURATION_MS: a war is finalized
 *  this long after it goes hot, whatever its HP. */
export const VILLAGE_WAR_MAX_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

export interface VillageWarInstance {
    key: string;
    id: string;
    generation: number;
    villages: [string, string];
    startedAt: number;
    /** 0 when the war had no pre-war window. */
    pendingUntil: number;
    /** The 14-day lifetime bound. The war may end sooner; it can never run longer. */
    endsAt: number;
    /** Inside the pre-war window: bands may be hired, none acts until it closes. */
    pending: boolean;
    /** A retired Honor-Seal strike is settling on the row; no damage can land. */
    frozen: boolean;
}

/** Mirror of api/world-state.ts declarationGenerationOf. */
export function villageWarGeneration(row: Record<string, unknown>): number {
    const stored = Math.floor(Number(row.declarationGeneration));
    if (Number.isSafeInteger(stored) && stored > 0) return stored;
    const marker = warDeclarationFundingMarkerFromRow(row);
    const parsed = /:g([1-9][0-9]*)$/.exec(String(marker?.declarationId ?? ''));
    const fromId = parsed ? Number(parsed[1]) : 1;
    return Number.isSafeInteger(fromId) && fromId > 0 ? fromId : 1;
}

/** A village-war row as an instance a band may serve, or null when the war is
 *  over, not yet funded, malformed, or past its 14-day lifetime. */
export function villageWarInstanceFromRow(key: string, raw: unknown, now: number): VillageWarInstance | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const row = raw as Record<string, unknown>;
    if (row.endedAt) return null;
    // Gameplay-active (world-state warIsGameplayActive): a legacy row, or a
    // declaration whose debit is durable.
    if (Object.prototype.hasOwnProperty.call(row, 'declarationFunding')
        && warDeclarationFundingMarkerFromRow(row)?.status !== 'active') return null;
    const villages = Array.isArray(row.villages) ? row.villages.map(String) : [];
    if (villages.length !== 2 || !villages[0] || !villages[1] || villages[0] === villages[1]) return null;
    const id = String(row.id ?? '').trim();
    const startedAt = Math.floor(Number(row.startedAt) || 0);
    const pendingUntil = Math.max(0, Math.floor(Number(row.pendingUntil) || 0));
    const effectiveStart = pendingUntil > 0 ? pendingUntil : startedAt;
    if (!id || effectiveStart <= 0) return null;
    const endsAt = effectiveStart + VILLAGE_WAR_MAX_LIFETIME_MS;
    if (now >= endsAt) return null;
    return {
        key,
        id,
        generation: villageWarGeneration(row),
        villages: [villages[0], villages[1]],
        startedAt,
        pendingUntil,
        endsAt,
        pending: pendingUntil > now,
        frozen: warHasMercenaryFundingField(row),
    };
}

/** Every village-war instance a band could serve right now. */
export async function listVillageWarInstances(
    now: number,
    store: Pick<KvLike, 'keys' | 'mget'> = kv,
): Promise<VillageWarInstance[]> {
    const keys = await store.keys(`${VILLAGE_WAR_ROW_PREFIX}*`);
    if (!keys.length) return [];
    const rows = await store.mget<unknown[]>(...keys);
    const out: VillageWarInstance[] = [];
    keys.forEach((key, index) => {
        const war = villageWarInstanceFromRow(key, rows[index], now);
        if (war) out.push(war);
    });
    return out;
}

/** The war `village` is fighting. A village holds one at a time; should a stale
 *  row linger, the newest declaration wins. */
export function villageWarFor(wars: readonly VillageWarInstance[], village: string): VillageWarInstance | null {
    return wars
        .filter((war) => war.villages.includes(village))
        .sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
}

/** Bands act in a village war only once it is hot and not frozen (the same
 *  predicate api/world-state.ts listActiveVillageWars applies). */
export function villageWarActing(war: Pick<VillageWarInstance, 'pending' | 'frozen'>): boolean {
    return !war.pending && !war.frozen;
}

export function villageWarContext(war: Pick<VillageWarInstance, 'id' | 'generation'>): MercLeaseContext {
    return { kind: 'village', warId: war.id, generation: war.generation };
}

export function sectorContestContext(
    contest: Pick<SectorWarSession, 'id' | 'sector' | 'declarationGeneration' | 'startedAt'>,
): MercLeaseContext {
    return { kind: 'sector', contestId: contest.id, instance: sectorWarInstanceTag(contest), sector: contest.sector };
}

/** A Combat contest that is live right now: the only kind a band can serve. */
export function combatContestLive(contest: SectorWarSession | null | undefined, now: number): contest is SectorWarSession {
    return !!contest && contest.winCondition === 'combat' && isSectorWarActive(contest, now);
}
