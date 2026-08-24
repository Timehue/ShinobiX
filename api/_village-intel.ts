/*
 * Village Stores — INTEL.
 *
 * Intel is EARNED, never donated: every explore (1) and every Ancient Chest
 * opened (3) on a sector your village does NOT own credits intel on that sector
 * to your village. Unowned sectors count as "not yours", so they still earn.
 * The hook sits where the shared sector pool reservation succeeds
 * (api/world/explore.ts, api/world/open-chest.ts) and is best-effort — a
 * storage blip must never fail the explore that earned it.
 *
 * Storage: one row per village, `village:intel:<villageSlug>`, OUTSIDE the
 * villageState blob (it is high-churn — every explore touches it):
 *   { village, sectors: { [sector]: { points, lastAt, expiresAt } } }
 * Points decay by expiry: 7 days after the LAST credit on that sector the whole
 * entry is dropped (pruned on read). Per-sector cap 2,000.
 *
 * Tiers (pure, `intelTierFor`):
 *   100 → scouted      the War Map may reveal the sector's garrison state,
 *                      today's pool usage and the defender's structure levels
 *   250 → mapped       sector-war declare costs 175 WR instead of 250
 *   500 → infiltrated  declare costs 125 WR
 * The declare discount is applied to the BASE cost before the comeback
 * multiplier (api/_war-economy.ts discountedWrCost), which stacks on top.
 *
 * Zeroing: when a sector war on S resolves (api/_sector-war-settle.ts, either
 * outcome), both villages' intel on S is deleted. Deletion is idempotent.
 *
 * Kill switch: DISABLE_VILLAGE_STORES=1 (api/_release-flags.ts).
 */

import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';
import { villageStoresEnabled } from './_release-flags.js';
import { villageWarSlug, villageWarKey, normalizeVillageWarRecord, STRUCTURE_KEYS, type StructureKey } from './_war-state.js';
import { isGarrisonAssaultable, isSectorWarActive, type SectorWarSession } from './_sector-war.js';
import type { SectorPoolRow } from './world/_sector-pool.js';

export const VILLAGE_INTEL_KEY_PREFIX = 'village:intel:';
export const INTEL_PER_EXPLORE = 1;
export const INTEL_PER_CHEST = 3;
export const INTEL_CAP_PER_SECTOR = 2_000;
export const INTEL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Row TTL: a day past the longest possible sector expiry so a dead row self-cleans. */
const INTEL_ROW_TTL_SECONDS = 8 * 24 * 60 * 60;

export type IntelTier = 'none' | 'scouted' | 'mapped' | 'infiltrated';
export const INTEL_TIER_THRESHOLDS = Object.freeze({ scouted: 100, mapped: 250, infiltrated: 500 });
/** Declare-cost multipliers per tier (250 → 175 / 125). */
export const INTEL_DECLARE_MULTIPLIER: Readonly<Record<IntelTier, number>> = Object.freeze({
    none: 1, scouted: 1, mapped: 0.7, infiltrated: 0.5,
});

export type IntelEntry = { points: number; lastAt: number; expiresAt: number };
export type VillageIntelRow = { village: string; sectors: Record<string, IntelEntry> };

export function villageIntelKey(village: string): string {
    return `${VILLAGE_INTEL_KEY_PREFIX}${villageWarSlug(village)}`;
}

export function intelTierFor(points: number): IntelTier {
    const p = Math.floor(Number(points) || 0);
    if (p >= INTEL_TIER_THRESHOLDS.infiltrated) return 'infiltrated';
    if (p >= INTEL_TIER_THRESHOLDS.mapped) return 'mapped';
    if (p >= INTEL_TIER_THRESHOLDS.scouted) return 'scouted';
    return 'none';
}

/** Base declare cost after the intel discount (BEFORE the comeback multiplier). */
export function intelDeclareCost(base: number, tier: IntelTier): number {
    const b = Math.max(0, Math.floor(Number(base) || 0));
    return Math.round(b * (INTEL_DECLARE_MULTIPLIER[tier] ?? 1));
}

/** Drop expired sectors and clamp points. Pure. */
export function pruneIntelRow(value: unknown, village: string, now: number): VillageIntelRow {
    const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const rawSectors = raw.sectors && typeof raw.sectors === 'object' && !Array.isArray(raw.sectors)
        ? raw.sectors as Record<string, unknown> : {};
    const sectors: Record<string, IntelEntry> = {};
    for (const [key, entry] of Object.entries(rawSectors)) {
        const sector = Math.floor(Number(key));
        if (!Number.isFinite(sector) || sector <= 0 || !entry || typeof entry !== 'object') continue;
        const e = entry as Record<string, unknown>;
        const points = Math.min(INTEL_CAP_PER_SECTOR, Math.max(0, Math.floor(Number(e.points) || 0)));
        const lastAt = Math.floor(Number(e.lastAt) || 0);
        const expiresAt = Math.floor(Number(e.expiresAt) || (lastAt ? lastAt + INTEL_TTL_MS : 0));
        if (points <= 0 || expiresAt <= now) continue;
        sectors[String(sector)] = { points, lastAt, expiresAt };
    }
    const name = typeof raw.village === 'string' && raw.village.trim() ? raw.village.trim() : village;
    return { village: name, sectors };
}

async function readOwnerVillage(sector: number): Promise<string> {
    const territory = await kv.get<Record<string, unknown>>(`world:territory:${Math.floor(sector)}`);
    return typeof territory?.ownerVillage === 'string' ? territory.ownerVillage.trim() : '';
}

/**
 * An owner village the CALLER already read this request, so the credit does not
 * re-read `world:territory:<sector>` a second time.
 *
 * Both hooks (api/world/explore.ts, api/world/open-chest.ts) resolve the sector
 * owner before they get here — explore holds a `SectorPoolFrame`, whose
 * `frame.owner` is exactly this shape, and open-chest holds `poolOwner`. Passing
 * it turns the second read of the identical row into a field access: one saved
 * KV round-trip per explore and per chest-open, on the hottest write path in the
 * world loop.
 *
 * The shape is structural on purpose (`{ ownerVillage }`), matching
 * `SectorPoolOwner` in api/world/_sector-pool.ts without importing it, so this
 * module stays free of the pool layer. `ownerVillage: undefined` means
 * "resolved, and the sector is UNOWNED" — a real answer, not a cache miss — so
 * an unowned sector still earns intel without a read. Omit the argument
 * entirely (or pass null) to keep the original read-it-yourself behaviour.
 */
export type PreReadSectorOwner = { ownerVillage: string | undefined };

export type IntelCreditResult =
    | { credited: true; points: number; tier: IntelTier }
    | { credited: false; reason: 'disabled' | 'no-village' | 'owned' | 'invalid' };

/**
 * Credit `amount` intel on `sector` to `village`, unless that village already
 * owns the sector. Locks the village's intel row (failClosed — the caller treats
 * a throw as "not credited", never as a failed explore).
 *
 * Pass `preReadOwner` when you already hold this sector's territory row (see
 * PreReadSectorOwner) to skip the duplicate `world:territory:<sector>` read. The
 * credit RULES are unchanged either way: the owning village earns nothing on its
 * own ground, an unowned sector still earns.
 */
export async function creditSectorIntel(
    village: string | undefined,
    sector: number,
    amount: number,
    now: number = Date.now(),
    preReadOwner?: PreReadSectorOwner | null,
): Promise<IntelCreditResult> {
    if (!villageStoresEnabled()) return { credited: false, reason: 'disabled' };
    const name = String(village ?? '').trim();
    const s = Math.floor(Number(sector));
    const add = Math.floor(Number(amount) || 0);
    if (!name) return { credited: false, reason: 'no-village' };
    if (!Number.isFinite(s) || s <= 0 || add <= 0) return { credited: false, reason: 'invalid' };
    // A supplied frame is authoritative for this request — including when it says
    // "unowned" (ownerVillage: undefined). Only a MISSING argument falls back.
    const owner = preReadOwner
        ? String(preReadOwner.ownerVillage ?? '').trim()
        : await readOwnerVillage(s);
    if (owner && owner === name) return { credited: false, reason: 'owned' };
    const key = villageIntelKey(name);
    return withKvLock(key, async () => {
        const row = pruneIntelRow(await kv.get(key), name, now);
        const prev = row.sectors[String(s)]?.points ?? 0;
        const points = Math.min(INTEL_CAP_PER_SECTOR, prev + add);
        row.sectors[String(s)] = { points, lastAt: now, expiresAt: now + INTEL_TTL_MS };
        await kv.set(key, row, { ex: INTEL_ROW_TTL_SECONDS });
        return { credited: true as const, points, tier: intelTierFor(points) };
    }, { failClosed: true });
}

/** A village's pruned intel row (display read, no write). */
export async function readVillageIntel(village: string, now: number = Date.now()): Promise<VillageIntelRow> {
    const name = String(village ?? '').trim();
    if (!name) return { village: '', sectors: {} };
    return pruneIntelRow(await kv.get(villageIntelKey(name)), name, now);
}

/** Points + tier a village holds on one sector. Honors the kill switch (→ none). */
export async function sectorIntelFor(village: string, sector: number, now: number = Date.now()): Promise<{ points: number; tier: IntelTier }> {
    if (!villageStoresEnabled()) return { points: 0, tier: 'none' };
    const row = await readVillageIntel(village, now);
    const points = row.sectors[String(Math.floor(Number(sector)))]?.points ?? 0;
    return { points, tier: intelTierFor(points) };
}

/**
 * Delete every listed village's intel on `sector`. Naturally idempotent — a
 * second call finds nothing to remove. Best-effort per village; never throws.
 */
export async function zeroSectorIntel(sector: number, villages: readonly string[], now: number = Date.now()): Promise<void> {
    const s = String(Math.floor(Number(sector)));
    for (const village of new Set(villages.map((v) => String(v ?? '').trim()).filter(Boolean))) {
        const key = villageIntelKey(village);
        try {
            await withKvLock(key, async () => {
                const raw = await kv.get(key);
                if (!raw) return;
                const row = pruneIntelRow(raw, village, now);
                if (!(s in row.sectors)) return;
                delete row.sectors[s];
                await kv.set(key, row, { ex: INTEL_ROW_TTL_SECONDS });
            }, { failClosed: true });
        } catch { /* best-effort */ }
    }
}

/** Every village's pruned intel, keyed by village slug (for the world-state frame). */
export async function readAllVillageIntel(now: number = Date.now()): Promise<Record<string, VillageIntelRow>> {
    const keys = await kv.keys(`${VILLAGE_INTEL_KEY_PREFIX}*`);
    if (!keys.length) return {};
    const values = await kv.mget<unknown[]>(...keys);
    const out: Record<string, VillageIntelRow> = {};
    keys.forEach((key, i) => {
        if (!values[i]) return;
        const slug = key.slice(VILLAGE_INTEL_KEY_PREFIX.length);
        const row = pruneIntelRow(values[i], slug, now);
        if (Object.keys(row.sectors).length) out[slug] = row;
    });
    return out;
}

/** Structure levels per village slug — the defender half of a reveal. */
export async function readVillageStructureLevels(villages: readonly string[]): Promise<Record<string, Record<StructureKey, number>>> {
    const names = [...new Set(villages.map((v) => String(v ?? '').trim()).filter(Boolean))];
    if (!names.length) return {};
    const raws = await kv.mget<unknown[]>(...names.map((v) => villageWarKey(v)));
    const out: Record<string, Record<StructureKey, number>> = {};
    names.forEach((name, i) => {
        const rec = normalizeVillageWarRecord(name, (raws[i] ?? undefined) as never);
        out[villageWarSlug(name)] = Object.fromEntries(STRUCTURE_KEYS.map((k) => [k, rec.structures[k]])) as Record<StructureKey, number>;
    });
    return out;
}

// ── World-state view (pure) ────────────────────────────────────────────────────

export type IntelGarrisonState = 'none' | 'locked' | 'open';
export type RevealedSectorIntel = {
    sector: number;
    points: number;
    tier: IntelTier;
    expiresAt: number;
    owner: string | null;
    revealed: {
        /** 'none' = no active Combat contest; 'locked' = contest live, defence still turning up; 'open' = garrison assaultable. */
        garrison: IntelGarrisonState;
        poolUsage: SectorPoolRow;
        /** The owner village's structure levels (null for an unowned sector). */
        structures: Record<StructureKey, number> | null;
    };
};
export type ScoutedBy = { village: string; tier: IntelTier; points: number };
export type VillageIntelView = {
    village: string;
    /** Sectors this village holds >= 100 intel on (scouted+). */
    revealed: RevealedSectorIntel[];
    /** Per sector this village OWNS: rival villages with >= 100 intel on it. */
    scoutedBy: Record<string, ScoutedBy[]>;
    thresholds: typeof INTEL_TIER_THRESHOLDS;
};

export function buildVillageIntelView(input: {
    viewerVillage: string;
    allIntel: Record<string, VillageIntelRow>;
    ownerBySector: Record<string, string | undefined>;
    contests: readonly Pick<SectorWarSession, 'sector' | 'startedAt' | 'flipped' | 'expiredAt' | 'endsAt' | 'lastLiveBattleAt' | 'winCondition'>[];
    structuresByVillageSlug: Record<string, Record<StructureKey, number>>;
    sectorPools: Record<number, SectorPoolRow>;
    now: number;
}): VillageIntelView {
    const viewer = String(input.viewerVillage ?? '').trim();
    const viewerSlug = villageWarSlug(viewer);
    const mine = input.allIntel[viewerSlug] ?? { village: viewer, sectors: {} };
    const revealed: RevealedSectorIntel[] = [];
    for (const [key, entry] of Object.entries(mine.sectors)) {
        const tier = intelTierFor(entry.points);
        if (tier === 'none') continue;
        const sector = Math.floor(Number(key));
        const owner = String(input.ownerBySector[key] ?? '').trim() || null;
        const contest = input.contests.find((c) => c.sector === sector && isSectorWarActive(c, input.now));
        const garrison: IntelGarrisonState = !contest || contest.winCondition !== 'combat'
            ? 'none'
            : isGarrisonAssaultable(contest, input.now) ? 'open' : 'locked';
        const pool = input.sectorPools[sector] ?? { explores: 0, chests: 0 };
        revealed.push({
            sector,
            points: entry.points,
            tier,
            expiresAt: entry.expiresAt,
            owner,
            revealed: {
                garrison,
                poolUsage: { explores: pool.explores, chests: pool.chests },
                structures: owner ? (input.structuresByVillageSlug[villageWarSlug(owner)] ?? null) : null,
            },
        });
    }
    revealed.sort((a, b) => a.sector - b.sector);

    const scoutedBy: Record<string, ScoutedBy[]> = {};
    const owned = new Set(Object.entries(input.ownerBySector)
        .filter(([, owner]) => String(owner ?? '').trim() === viewer && viewer)
        .map(([sector]) => String(Math.floor(Number(sector)))));
    for (const [slug, row] of Object.entries(input.allIntel)) {
        if (slug === viewerSlug) continue;
        for (const [key, entry] of Object.entries(row.sectors)) {
            if (!owned.has(key)) continue;
            const tier = intelTierFor(entry.points);
            if (tier === 'none') continue;
            (scoutedBy[key] ??= []).push({ village: row.village, tier, points: entry.points });
        }
    }
    for (const list of Object.values(scoutedBy)) list.sort((a, b) => b.points - a.points);
    return { village: viewer, revealed, scoutedBy, thresholds: INTEL_TIER_THRESHOLDS };
}
