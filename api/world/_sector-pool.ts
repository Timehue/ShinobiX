import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';

/**
 * Shared per-sector daily gathering pool.
 *
 * Explore (`api/world/explore.ts`) and Ancient Chest opening
 * (`api/world/open-chest.ts`) used to be PRIVATE faucets: each player had a
 * daily ceiling (150 explores / 23 chests) but nothing in the sector itself ever
 * ran dry, so two hundred players could each drain the same tile in parallel.
 * This pool is the contested half: one counter per sector per UTC day, shared
 * by everyone standing there, ADDITIVE to the per-player limits (which stay
 * exactly as they were — a player still cannot exceed their own daily count).
 *
 * Owner ruling: contested and visible, but generous — the numbers are sized so
 * a quiet sector never bites a normal player, and only a genuinely crowded one
 * gets picked clean. The village that OWNS the sector
 * (`world:territory:<sector>.ownerVillage`) gets a 50% larger pool for its own
 * members, so holding ground is worth something to every villager, not only
 * the clan that took it.
 *
 * ── Sizing (raised 2026-08-22; the first pass at 500/75 was far too tight) ──
 * The per-player explore ceiling (DAILY_SECTOR_EXPLORE_LIMIT, 150/day) is
 * GLOBAL, not per-sector, so one maxed player can spend all 150 on one tile.
 *   • 1,500 / 150 = 10 maxed players to drain a non-owner sector (was 3⅓).
 *   • 2,250 / 150 = 15 for a village standing on ground it owns.
 *   • World capacity 66 wild sectors × 1,500 = 99,000 explore slots against a
 *     200-player ceiling × 150 = 30,000 explores of demand — 30% utilization,
 *     i.e. 3.3× headroom for clustering (500 left only 9%).
 * The chest pool tracks the explore pool at exactly the authored chest rate
 * (SECTOR_EXPLORE_CHEST_CHANCE, 0.15): 1,500 × 0.15 = 225 expected discoveries
 * against a 225 chest cap, so chests are never the tighter constraint in
 * expectation. Chests are also reserved at DISCOVERY (api/world/explore.ts),
 * and a sector whose chest pool is spent simply stops rolling chests — the
 * tile falls through to the battle/quiet branches exactly as it does at the
 * per-player chest ceiling, so a discovered chest is never refused at open.
 *
 * Reservation happens under `withKvLock` on the pool key with `failClosed`, so
 * two explorers racing for the last slot cannot both win it. The lock budget is
 * deliberately many-short-attempts (SECTOR_POOL_LOCK): these run NESTED inside
 * `lock:save:<name>` (5s TTL), so the whole wait has to finish well inside it —
 * 7 attempts at a 15ms base is ~1.9s worst case against the old 5 × 25ms
 * (~0.78s), which is more patience under a crowd without risking the save lock.
 */

export const SECTOR_EXPLORE_POOL_PER_DAY = 1500;
export const SECTOR_CHEST_POOL_PER_DAY = 225;
export const OWNER_VILLAGE_POOL_BONUS = 0.5;
/** Pool rows outlive the day they count so a just-past-midnight reader still sees yesterday. */
export const SECTOR_POOL_TTL_SECONDS = 2 * 24 * 60 * 60;

export const SECTOR_POOL_KEY_PREFIX = 'world:sector-pool:';

export type SectorPoolKind = 'explores' | 'chests';
export type SectorPoolRow = { explores: number; chests: number };
export type SectorPoolView = {
    exploresUsed: number;
    exploresCap: number;
    chestsUsed: number;
    chestsCap: number;
};

export function utcDateOf(now: number): string {
    return new Date(now).toISOString().slice(0, 10);
}

export function sectorPoolKey(sector: number, now: number): string {
    return `${SECTOR_POOL_KEY_PREFIX}${Math.floor(sector)}:${utcDateOf(now)}`;
}

export function cleanSectorPoolRow(value: unknown): SectorPoolRow {
    const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const count = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
    return { explores: count(raw.explores), chests: count(raw.chests) };
}

/** Pool size for one gatherer: base cap, +50% when their village owns the sector. */
export function sectorPoolCap(kind: SectorPoolKind, ownerVillage: string | undefined, explorerVillage: string | undefined): number {
    const base = kind === 'explores' ? SECTOR_EXPLORE_POOL_PER_DAY : SECTOR_CHEST_POOL_PER_DAY;
    const owner = String(ownerVillage ?? '').trim();
    const mine = String(explorerVillage ?? '').trim();
    return owner && mine && owner === mine ? Math.floor(base * (1 + OWNER_VILLAGE_POOL_BONUS)) : base;
}

export function sectorPoolView(row: SectorPoolRow, ownerVillage: string | undefined, explorerVillage: string | undefined): SectorPoolView {
    return {
        exploresUsed: row.explores,
        exploresCap: sectorPoolCap('explores', ownerVillage, explorerVillage),
        chestsUsed: row.chests,
        chestsCap: sectorPoolCap('chests', ownerVillage, explorerVillage),
    };
}

/**
 * Who owns the sector today. ONE KV read — hoist it out of any `lock:save:<name>`
 * critical section and pass the result down as `owner` (see
 * {@link SectorPoolOwner}); a read inside the save lock burns part of that
 * lock's 5s TTL under exactly the crowd the pool exists for.
 */
export async function readSectorOwnerVillage(sector: number): Promise<string | undefined> {
    const territory = await kv.get<Record<string, unknown>>(`world:territory:${Math.floor(sector)}`);
    const owner = typeof territory?.ownerVillage === 'string' ? territory.ownerVillage.trim() : '';
    return owner || undefined;
}

/**
 * A pre-resolved owner village, cached once per request frame. Presence of the
 * wrapper (not the string) is what marks it resolved, so `undefined` can still
 * mean "unowned sector" rather than "not looked up yet".
 */
export type SectorPoolOwner = { ownerVillage: string | undefined };

/** Resolve the owner once, for a whole request's worth of pool calls. */
export async function loadSectorPoolOwner(sector: number): Promise<SectorPoolOwner> {
    return { ownerVillage: await readSectorOwnerVillage(sector) };
}

/**
 * One request frame's worth of pool state: the owner plus a lock-free snapshot
 * of today's counters. Load it BEFORE entering `lock:save:<name>` and pass it
 * to {@link sectorPoolHasRoom} / {@link reserveSectorPool}, so the save lock
 * never pays for the two territory/pool reads.
 *
 * The snapshot is advisory — it decides whether a tile is even allowed to ROLL
 * a chest. Every actual debit still goes through the locked reservation, which
 * is the authority.
 */
export type SectorPoolFrame = { sector: number; owner: SectorPoolOwner; row: SectorPoolRow; now: number };

export async function loadSectorPoolFrame(sector: number, now: number = Date.now()): Promise<SectorPoolFrame> {
    const [row, owner] = await Promise.all([
        kv.get(sectorPoolKey(sector, now)).then(cleanSectorPoolRow),
        loadSectorPoolOwner(sector),
    ]);
    return { sector: Math.floor(sector), owner, row, now };
}

/** Advisory "is there still room" against a loaded frame, for the gatherer's cap. */
export function sectorPoolHasRoom(frame: SectorPoolFrame, kind: SectorPoolKind, explorerVillage: string | undefined): boolean {
    return frame.row[kind] < sectorPoolCap(kind, frame.owner.ownerVillage, explorerVillage);
}

/**
 * Lock budget for the pool row. See the module docstring: more attempts than
 * the 5×25ms default so a crowd retries instead of 500ing, but a SHORTER base
 * so the total (~1.9s) still fits inside the enclosing save lock's 5s TTL. The
 * pool row's own TTL is generous — its critical section is one get + one set.
 */
export const SECTOR_POOL_LOCK = Object.freeze({ failClosed: true as const, maxAttempts: 7, baseBackoffMs: 15, ttlSec: 10 });

export type SectorPoolReservation =
    | { ok: true; used: number; cap: number; view: SectorPoolView; release: () => Promise<void> }
    | { ok: false; used: number; cap: number; view: SectorPoolView };

/**
 * Take one slot of `kind` from the sector's pool for today. Refuses once the
 * gatherer's cap (owner-bonused or not) is reached. The returned `release`
 * hands the slot back if the caller's own settlement fails AFTER the
 * reservation — the pool must never leak a slot nobody was paid for.
 *
 * Pass `owner` when the caller already resolved it (see
 * {@link loadSectorPoolOwner}) to keep the territory read out of the enclosing
 * save lock.
 */
export async function reserveSectorPool(
    sector: number,
    kind: SectorPoolKind,
    explorerVillage: string | undefined,
    now: number = Date.now(),
    owner?: SectorPoolOwner,
): Promise<SectorPoolReservation> {
    const key = sectorPoolKey(sector, now);
    const ownerVillage = owner ? owner.ownerVillage : await readSectorOwnerVillage(sector);
    const cap = sectorPoolCap(kind, ownerVillage, explorerVillage);
    return withKvLock(key, async () => {
        const row = cleanSectorPoolRow(await kv.get(key));
        const used = row[kind];
        if (used >= cap) {
            return { ok: false as const, used, cap, view: sectorPoolView(row, ownerVillage, explorerVillage) };
        }
        const next = { ...row, [kind]: used + 1 };
        await kv.set(key, next, { ex: SECTOR_POOL_TTL_SECONDS });
        return {
            ok: true as const,
            used: used + 1,
            cap,
            view: sectorPoolView(next, ownerVillage, explorerVillage),
            release: () => releaseSectorPool(sector, kind, now),
        };
    }, SECTOR_POOL_LOCK);
}

/** Give back one slot (settlement failed after reserving). Never goes below zero. */
export async function releaseSectorPool(sector: number, kind: SectorPoolKind, now: number = Date.now()): Promise<void> {
    const key = sectorPoolKey(sector, now);
    await withKvLock(key, async () => {
        const row = cleanSectorPoolRow(await kv.get(key));
        await kv.set(key, { ...row, [kind]: Math.max(0, row[kind] - 1) }, { ex: SECTOR_POOL_TTL_SECONDS });
    }, SECTOR_POOL_LOCK);
}

/** Display read — no lock, no write. */
export async function readSectorPool(
    sector: number,
    explorerVillage: string | undefined,
    now: number = Date.now(),
    owner?: SectorPoolOwner,
): Promise<SectorPoolView> {
    const [row, ownerVillage] = await Promise.all([
        kv.get(sectorPoolKey(sector, now)).then(cleanSectorPoolRow),
        owner ? Promise.resolve(owner.ownerVillage) : readSectorOwnerVillage(sector),
    ]);
    return sectorPoolView(row, ownerVillage, explorerVillage);
}

/**
 * Every sector's raw usage for today, for the shared world-state GET. Village
 * is per-viewer, so this ships the raw counts plus the cap constants and lets
 * the client apply the owner bonus against its own village.
 */
export async function readAllSectorPoolUsage(now: number = Date.now()): Promise<Record<number, SectorPoolRow>> {
    const suffix = `:${utcDateOf(now)}`;
    const keys = (await kv.keys(`${SECTOR_POOL_KEY_PREFIX}*${suffix}`)).filter((k) => k.endsWith(suffix));
    if (!keys.length) return {};
    const values = await kv.mget<unknown[]>(...keys);
    const out: Record<number, SectorPoolRow> = {};
    keys.forEach((key, i) => {
        const sector = Math.floor(Number(key.slice(SECTOR_POOL_KEY_PREFIX.length, -suffix.length)));
        if (Number.isFinite(sector) && values[i]) out[sector] = cleanSectorPoolRow(values[i]);
    });
    return out;
}

export const SECTOR_POOL_CAPS = Object.freeze({
    explores: SECTOR_EXPLORE_POOL_PER_DAY,
    chests: SECTOR_CHEST_POOL_PER_DAY,
    ownerBonus: OWNER_VILLAGE_POOL_BONUS,
});
