/*
 * Sector Contracts — the day's posted work, and the reason to pick THIS sector.
 *
 * A handful of wild sectors carry a contract each UTC day: gather there enough
 * times and the sector pays a bounty on top of what the ground itself gives.
 * The point is direction, not income — the shared pool already says where the
 * ground is still rich (lib/sector-richness), and this says where it is worth
 * extra today, so "which sector" becomes a question with an answer.
 *
 * DETERMINISTIC BY DESIGN. Which sectors are posted, what they ask, and what
 * they pay are all derived from (sector, UTC day) by pure hash — no storage, no
 * round trip, and no way for a client to choose its own contract. Client and
 * server import THIS module and independently agree. Only progress and the
 * claim are server-owned state (api/_sector-contracts.ts), because those are
 * the parts a client could otherwise lie about.
 *
 * Rewards rule (docs + owner ruling): a contract is a MISSION, so it may pay.
 * The payout is recomputed here at claim time from the sealed day and sector —
 * never read from the request body.
 */
import { WILD_SECTOR_IDS } from "./sector-geo.js";
import { isWorldNight, worldNightWindowLabel } from "./world-phase.js";

/** How many sectors carry a contract on any given day. */
export const SECTOR_CONTRACT_SLOTS = 6;

/*
 * ── Balance, in one place, deliberately conservative ──────────────────────
 * An explore pays ~20-35 ryo (api/world/_explore.ts sectorExploreReward), and
 * a player's global ceiling is 150 explores/day. A contract therefore asks for
 * 8-12 explores in one sector and pays roughly 8-15 explores' worth on top:
 * chasing all six slots costs at most 72 of the 150 daily explores, so it
 * directs a player's day without consuming it.
 *
 * These four numbers are the whole dial. They are a first pass and have NOT
 * been owner-tuned — retune here, not at the call sites.
 */
export const CONTRACT_TARGET_MIN = 8;
export const CONTRACT_TARGET_SPREAD = 5;       // → 8..12 explores
export const CONTRACT_RYO_BASE = 200;
export const CONTRACT_RYO_PER_SECTOR = 4;      // → 204 (s1) .. 464 (s66)
/*
 * Roughly a third of each day's board is NIGHT WORK: progress on it only counts
 * while the world is in night (shared/world-phase, the same window the visible
 * sky uses). This is the one axis that makes "which sector" into "which sector,
 * RIGHT NOW" — weather cannot, because it rotates per UTC day rather than
 * within one, so a weather requirement would be either always true or always
 * impossible for a given sector that day.
 *
 * Deliberately a minority of the board, and it pays no more: a player who only
 * ever logs in during daylight still has four ordinary contracts to chase, so
 * this adds a choice rather than a tax on someone's timezone.
 */
export const CONTRACT_NIGHT_SHARE = 3;         // 1 in N postings is night work

export type SectorContract = {
    sector: number;
    /** UTC day the contract belongs to, `YYYY-MM-DD`. */
    day: string;
    /** Explores needed in this sector, today. */
    target: number;
    /** Ryo paid once, on claim. */
    ryo: number;
    /** Progress only counts while the world is in night. */
    nightOnly: boolean;
};

/** FNV-1a over a string — stable across machines, unlike any hash of object order. */
function hash(text: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

export function utcDayOf(now: number): string {
    return new Date(now).toISOString().slice(0, 10);
}

/**
 * The sectors posted on `day`, ascending.
 *
 * Deterministic shuffle-and-take rather than "hash each sector, keep the low
 * ones": a threshold over independent hashes gives a COUNT that drifts day to
 * day (some days two sectors, some days eleven), and the promise this makes to
 * the player is that there are always exactly SECTOR_CONTRACT_SLOTS to find.
 */
export function contractSectorsForDay(day: string, pool: readonly number[] = WILD_SECTOR_IDS): readonly number[] {
    // Memoised for the default pool, and it matters: the world map asks whether
    // each of ~67 markers is posted, several times per marker, on every render.
    // Unmemoised that is hundreds of 66-element sorts per frame on the heaviest
    // screen in the game. A day's board never changes, so compute it once.
    if (pool === WILD_SECTOR_IDS) {
        const cached = boardCache.get(day);
        if (cached) return cached;
        const board = rankBoard(day, pool);
        // One day in, one day out: the board rolls at midnight UTC and yesterday's
        // is never asked for again, so the cache can never grow.
        if (boardCache.size > 1) boardCache.clear();
        boardCache.set(day, board);
        return board;
    }
    return rankBoard(day, pool);
}

// `readonly` on the return type is load-bearing, not decoration: the memo hands
// every caller the SAME array, so an in-place sort by one of them would silently
// rewrite the board for all of them.
const boardCache = new Map<string, readonly number[]>();

function rankBoard(day: string, pool: readonly number[]): readonly number[] {
    const ranked = [...pool]
        .map((sector) => ({ sector, rank: hash(`${day}:${sector}`) }))
        .sort((a, b) => (a.rank - b.rank) || (a.sector - b.sector));
    return ranked.slice(0, Math.min(SECTOR_CONTRACT_SLOTS, ranked.length))
        .map((entry) => entry.sector)
        .sort((a, b) => a - b);
}

/** Today's contract for a sector, or null when it is not posted. */
export function sectorContractFor(
    sector: number,
    day: string,
    pool: readonly number[] = WILD_SECTOR_IDS,
): SectorContract | null {
    const id = Math.floor(Number(sector));
    if (!Number.isFinite(id) || !contractSectorsForDay(day, pool).includes(id)) return null;
    const seed = hash(`${day}:contract:${id}`);
    return {
        sector: id,
        day,
        target: CONTRACT_TARGET_MIN + (seed % CONTRACT_TARGET_SPREAD),
        ryo: CONTRACT_RYO_BASE + id * CONTRACT_RYO_PER_SECTOR,
        // Its own hash, not a slice of `seed`: the target already consumes the
        // low bits, and reusing them would tie night work to specific targets.
        nightOnly: hash(`${day}:night:${id}`) % CONTRACT_NIGHT_SHARE === 0,
    };
}

/**
 * Validate a contract that arrived over the wire.
 *
 * The server only ever sends what `sectorContractFor` produced, so in practice
 * this always passes — but the card multiplies by `target` and calls
 * `.toLocaleString()` on `ryo`, so a half-formed object would not render wrong,
 * it would THROW and take the whole sector panel with it. Parse at the boundary
 * (the same rule `parseScars` follows for the other payload on this screen),
 * and a bad row simply becomes "no contract".
 */
export function parseSectorContract(value: unknown): SectorContract | null {
    if (!value || typeof value !== "object") return null;
    const raw = value as Record<string, unknown>;
    const sector = Math.floor(Number(raw.sector));
    const target = Math.floor(Number(raw.target));
    const ryo = Math.floor(Number(raw.ryo));
    const day = typeof raw.day === "string" ? raw.day : "";
    if (!Number.isFinite(sector) || sector <= 0) return null;
    if (!Number.isFinite(target) || target <= 0) return null;
    if (!Number.isFinite(ryo) || ryo < 0) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    return { sector, day, target, ryo, nightOnly: raw.nightOnly === true };
}

/** Can work on this contract count right now? Night contracts only count at night. */
export function contractAcceptsWorkAt(contract: SectorContract, nowMs: number): boolean {
    return !contract.nightOnly || isWorldNight(nowMs);
}

/** Player-facing one-liner. Kept here so client and server word it identically. */
export function sectorContractObjective(contract: SectorContract): string {
    return contract.nightOnly
        ? `Work this ground ${contract.target} times after dark (${worldNightWindowLabel()}).`
        : `Work this ground ${contract.target} times today.`;
}
