/**
 * Shared per-sector daily gathering pool — client mirror.
 *
 * The server (`api/world/_sector-pool.ts`) owns the counters: every explore and
 * every Ancient Chest opened in a sector draws from ONE pool shared by everyone
 * standing there, on top of the unchanged per-player daily limits. This module
 * only caches what the server reported so the selected-sector plate can show
 * "Gathered today: N / M" and a depleted state.
 *
 * Two producers feed the cache: the world-state poll (raw counts for every
 * sector plus the cap constants) and the explore / open-chest responses (an
 * exact per-viewer view for the sector just gathered). The viewer applies the
 * owner-village bonus itself because the polled payload is shared by all
 * players and cannot know who is reading it.
 */

export type SectorPoolView = {
    exploresUsed: number;
    exploresCap: number;
    chestsUsed: number;
    chestsCap: number;
};

/**
 * A pool view sized for one viewer, carrying whether it is REAL yet.
 *
 * `hydrated` is false until the first world-state poll (or a gather response)
 * has landed. Before that the numbers are placeholders built from the mirrored
 * default caps, and a plate that renders them says "Gathered today: 0 / 1,500"
 * for every sector on the board — indistinguishable from a genuinely untouched
 * one, and simply wrong if the server ships different caps. Anything that shows
 * or acts on a pool must check this flag first.
 */
export type SectorPoolPlateView = SectorPoolView & { hydrated: boolean };

export type SectorPoolUsage = { explores: number; chests: number };
export type SectorPoolCaps = { explores: number; chests: number; ownerBonus: number };

// Mirrors the server defaults (api/world/_sector-pool.ts); replaced by whatever
// the world-state GET ships. 1,500 explores = 10 maxed players (150/day each)
// to drain a non-owner sector, 15 for the owning village; 1,500 × the authored
// 0.15 chest rate = the 225 chest cap exactly, so chests never bind first.
const DEFAULT_CAPS: SectorPoolCaps = { explores: 1500, chests: 225, ownerBonus: 0.5 };

let usageCache: Record<number, SectorPoolUsage> = {};
let capsCache: SectorPoolCaps = DEFAULT_CAPS;
let exactViews: Record<number, { view: SectorPoolView; day: string }> = {};
/** Has any real pool payload landed yet? See SectorPoolPlateView.hydrated. */
let polled = false;

const count = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));
const num = (value: number) => value.toLocaleString();
const utcDay = () => new Date().toISOString().slice(0, 10);

export function cleanSectorPoolView(value: unknown): SectorPoolView | null {
    if (!value || typeof value !== "object") return null;
    const raw = value as Record<string, unknown>;
    const view = {
        exploresUsed: count(raw.exploresUsed),
        exploresCap: count(raw.exploresCap),
        chestsUsed: count(raw.chestsUsed),
        chestsCap: count(raw.chestsCap),
    };
    return view.exploresCap > 0 && view.chestsCap > 0 ? view : null;
}

/** Feed from the world-state poll. Returns true when anything changed. */
export function hydrateSectorPools(data: { sectorPools?: unknown; sectorPoolCaps?: unknown }): boolean {
    const before = JSON.stringify([usageCache, capsCache, exactViews, polled]);
    const next: Record<number, SectorPoolUsage> = {};
    const hasPools = !!data.sectorPools && typeof data.sectorPools === "object";
    const pools = hasPools ? data.sectorPools as Record<string, unknown> : {};
    for (const [key, row] of Object.entries(pools)) {
        const sector = Math.floor(Number(key));
        if (!Number.isFinite(sector) || sector < 1 || !row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        next[sector] = { explores: count(r.explores), chests: count(r.chests) };
    }
    usageCache = next;
    const caps = data.sectorPoolCaps && typeof data.sectorPoolCaps === "object" ? data.sectorPoolCaps as Record<string, unknown> : null;
    if (caps && count(caps.explores) > 0 && count(caps.chests) > 0) {
        capsCache = { explores: count(caps.explores), chests: count(caps.chests), ownerBonus: Math.max(0, Number(caps.ownerBonus) || 0) };
    }
    // The world-state payload always carries `sectorPools` (possibly `{}`, when
    // nobody has gathered anywhere today) and `sectorPoolCaps`, so either one
    // arriving means the numbers below are now real rather than placeholders.
    if (hasPools || caps) polled = true;
    // A poll supersedes an exact view only when it is at least as NEW.
    //
    // `sectorPools` deliberately rides outside the world-state ETag (it moves
    // whenever anyone explores anywhere, so hashing it meant the 304 fast path
    // never fired), which means a 304 replays a body captured BEFORE this
    // viewer's last explore. Dropping the exact view unconditionally therefore
    // made the counter run backwards on screen: the explore answered
    // "1,201 / 1,500", the next poll reverted the plate to 1,200, the one after
    // that put it back. Keep the exact view until the shared counts have caught
    // up with it (and only for today — the pools reset at midnight UTC).
    const today = utcDay();
    const kept: typeof exactViews = {};
    for (const [key, entry] of Object.entries(exactViews)) {
        const id = Math.floor(Number(key));
        const fresh = next[id];
        // No row at all means the poll thinks nobody has gathered here, which is
        // strictly older than an exact view that counted this viewer's own take.
        const superseded = !!fresh && fresh.explores >= entry.view.exploresUsed && fresh.chests >= entry.view.chestsUsed;
        if (entry.day === today && !superseded) kept[id] = entry;
    }
    exactViews = kept;
    return JSON.stringify([usageCache, capsCache, exactViews, polled]) !== before;
}

/** Feed from an explore / open-chest response: the server's exact per-viewer view. */
export function noteSectorPoolView(sector: number, view: unknown): void {
    const clean = cleanSectorPoolView(view);
    const id = Math.floor(Number(sector));
    if (!clean || !Number.isFinite(id) || id < 1) return;
    exactViews[id] = { view: clean, day: utcDay() };
    usageCache[id] = { explores: clean.exploresUsed, chests: clean.chestsUsed };
}

/** The viewer's pool for a sector, owner bonus applied against their own village. */
export function sectorPoolViewFor(sector: number, ownerVillage: string | undefined, viewerVillage: string | undefined): SectorPoolPlateView {
    const exact = exactViews[sector];
    // An exact view is the server's own answer for THIS sector, so it counts as
    // hydrated even before a poll has landed — but only for that sector.
    if (exact && exact.day === utcDay()) return { ...exact.view, hydrated: true };
    const usage = usageCache[sector] ?? { explores: 0, chests: 0 };
    const owner = String(ownerVillage ?? "").trim();
    const mine = String(viewerVillage ?? "").trim();
    const bonus = owner && mine && owner === mine ? 1 + capsCache.ownerBonus : 1;
    return {
        exploresUsed: usage.explores,
        exploresCap: Math.floor(capsCache.explores * bonus),
        chestsUsed: usage.chests,
        chestsCap: Math.floor(capsCache.chests * bonus),
        hydrated: polled,
    };
}

export function sectorPoolDepleted(view: SectorPoolView): boolean {
    return view.exploresUsed >= view.exploresCap;
}

export const SECTOR_DEPLETED_MESSAGE =
    "Picked clean — this sector gives nothing more today. It refills at midnight UTC; other sectors are still rich.";

/** The gathering readout on the selected-sector plate. */
export type SectorGatherLine = {
    /** "Gathered today · Explores 12 / 1,500 · Chests 3 / 225" — both pairs labelled. */
    text: string;
    /** The actionable next step when the pool is spent; null otherwise. */
    note: string | null;
    depleted: boolean;
    /** True while the counts are still unknown (no poll yet) — show, don't fake. */
    pending: boolean;
};

/**
 * Project a pool view into the plate's gathering line.
 *
 * Before the first poll the caller gets an explicit "checking…" line rather
 * than a fabricated "0 / 1,500", and never a depleted verdict — the Explore
 * button hangs off `depleted`, and refusing the game's core verb on a guess is
 * worse than letting the server refuse it a moment later.
 */
export function sectorGatherLineFor(view: SectorPoolPlateView | null | undefined): SectorGatherLine | null {
    if (!view) return null;
    if (!view.hydrated) return { text: "Gathered today · checking…", note: null, depleted: false, pending: true };
    const depleted = sectorPoolDepleted(view);
    return {
        text: `Gathered today · Explores ${num(view.exploresUsed)} / ${num(view.exploresCap)} · Chests ${num(view.chestsUsed)} / ${num(view.chestsCap)}`,
        note: depleted ? SECTOR_DEPLETED_MESSAGE : null,
        depleted,
        pending: false,
    };
}

/**
 * Pre-flight for the explore button: the refusal message, or null to proceed.
 *
 * This has to run BEFORE the wild-pet / free-dungeon probes, not after. Those
 * probes commit real server state (a pet-encounter pointer with a 32-day TTL, a
 * free dungeon run) and the explore that settles them runs afterwards — so a
 * probe hit in a depleted sector used to mint a discovery the settle could not
 * clear, and every later explore in EVERY sector answered
 * `pending-pet-discovery` for the rest of the day.
 */
export function sectorExploreRefusal(
    sector: number,
    ownerVillage: string | undefined,
    viewerVillage: string | undefined,
): string | null {
    const view = sectorPoolViewFor(sector, ownerVillage, viewerVillage);
    // Never refuse on placeholder numbers: pre-hydration the counts are zeros
    // against mirrored caps, so a stale cap could invent a refusal the server
    // would not make.
    if (!view.hydrated) return null;
    return sectorPoolDepleted(view) ? SECTOR_DEPLETED_MESSAGE : null;
}

/** Test-only reset. */
export function __resetSectorPoolCache(): void {
    usageCache = {};
    capsCache = DEFAULT_CAPS;
    exactViews = {};
    polled = false;
}
