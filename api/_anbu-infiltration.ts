/*
 * Anbu Vault Infiltration — pure, IO-free reward/economy core.
 *
 * The L100 sector-attrition raid (docs/anbu-infiltration-plan.md). Split out from
 * the endpoints so the *balance math* is unit-testable without storage — same
 * pattern as api/_territory-supply.ts, api/_war-role.ts, api/_sector-war.ts.
 *
 * On a verified win the server rolls one of three outcomes and skims 1% of the
 * enemy's war economy into cache items:
 *   - 1% of the target SECTOR's `warSupply`  (per-sector clan income), OR
 *   - 1% of the target VILLAGE's `warResources` (village-wide war budget), OR
 *   - both (the rare "jackpot" roll).
 * Each pool has an INDEPENDENT 50%/day loss floor so it can never be drained to
 * nothing or go negative. The skim becomes stackable caches the raider later turns
 * in — War Supply cache → CLAN at 2:1, War Resource cache → VILLAGE at 1:1
 * (type-locked; docs plan §8, decision B).
 *
 * EVERYTHING HERE IS PROPOSED AND PENDING BALANCE SIGN-OFF. The feature ships
 * behind `anbuInfiltration.v1` (OFF) + `ENABLE_VILLAGE_WAR`, so these numbers can
 * never touch live players until the balance pass flips the flag.
 */

// ── Balance knobs (all pending sign-off) ─────────────────────────────────────
/** Percent of a pool's *current* balance skimmed on a successful skim of it. */
export const SKIM_PCT = 1;
/** A pool can lose at most this % of its day-opening balance per UTC day. */
export const DAILY_LOSS_CAP_PCT = 50;
/** Reward-roll weights (must sum to 1). "Both" is the rare jackpot. */
export const ROLL_BOTH_WEIGHT = 0.10;
export const ROLL_SUPPLY_WEIGHT = 0.45;
export const ROLL_WR_WEIGHT = 0.45;
/** Turn-in ratios (caches : points). War Supply → clan 2:1, War Resource → village 1:1. */
export const CLAN_CACHES_PER_POINT = 2;
export const VILLAGE_CACHES_PER_POINT = 1;
/** Flat personal ryo granted on any successful raid (before the endpoint's daily cap). */
export const RAID_RYO_REWARD = 500;
/** Endpoint-enforced ceiling on raids/day per attacker (heavy activity — deliberately low). */
export const MAX_RAID_ATTEMPTS_PER_DAY = 8;
/** Inventory stack ceiling for each cache item (user-specified). */
export const CACHE_STACK_CAP = 9999;
/** Max village merit creditable per turn-in call (mirrors MAX_CLAN_POINTS_AWARD's 250 on
 *  the clan side, so one dump can't spike either standing track). */
export const VILLAGE_TURNIN_MAX_POINTS = 250;

// ── Types ────────────────────────────────────────────────────────────────────
/** The two skimmable pools / the two cache item types (1:1 with their origin pool). */
export type WarPool = 'warSupply' | 'warResources';
export type TurnInDest = 'clan' | 'village';

/** Per-pool daily-loss ledger. Lives on the pool's record (territory / village-war). */
export interface DailyLossLedger {
    /** 'YYYY-MM-DD' UTC — the day `openingBalance` / `lostToday` describe. */
    date: string;
    /** The pool balance at the start of `date` (the base for the 50% floor). */
    openingBalance: number;
    /** Cumulative amount drained from the pool during `date`. */
    lostToday: number;
}

function num(v: unknown, fallback = 0): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

/** UTC 'YYYY-MM-DD' for a wall-clock ms value (the handler passes `now`, keeping this pure). */
export function utcDateKey(now: number): string {
    return new Date(num(now)).toISOString().slice(0, 10);
}

// ── Reward roll ──────────────────────────────────────────────────────────────
/**
 * Decide which pool(s) a win skims, from a roll in [0,1) supplied by the handler
 * (server-side crypto RNG — never the client). "Both" occupies the first, smallest
 * band so it stays the rare jackpot; the two singles split the rest evenly.
 * A pool the roll *selects* may still skim 0 if it's tapped out for the day
 * (that is applySkim's job, not this one).
 */
export function rollRewardPools(roll: number): { supply: boolean; wr: boolean } {
    const r = Math.min(0.999999999, Math.max(0, num(roll)));
    if (r < ROLL_BOTH_WEIGHT) return { supply: true, wr: true };
    if (r < ROLL_BOTH_WEIGHT + ROLL_SUPPLY_WEIGHT) return { supply: true, wr: false };
    return { supply: false, wr: true };
}

// ── Daily-loss ledger + skim ─────────────────────────────────────────────────
/**
 * Return a ledger valid for the UTC day of `now`. On a new day (or a missing/blank
 * ledger) it resets: `openingBalance` re-anchors to the pool's CURRENT balance and
 * `lostToday` zeroes. Same-day ledgers are returned as-is (clamped to sane numbers).
 */
export function rolloverLedger(
    ledger: DailyLossLedger | null | undefined,
    currentBalance: number,
    now: number,
): DailyLossLedger {
    const today = utcDateKey(now);
    const bal = Math.max(0, Math.floor(num(currentBalance)));
    if (!ledger || ledger.date !== today) {
        return { date: today, openingBalance: bal, lostToday: 0 };
    }
    return {
        date: today,
        openingBalance: Math.max(0, Math.floor(num(ledger.openingBalance, bal))),
        lostToday: Math.max(0, Math.floor(num(ledger.lostToday))),
    };
}

/**
 * Compute the actual skim from a pool and the ledger it leaves behind. The raw
 * skim is `SKIM_PCT`% of the current balance, then clamped by BOTH the pool
 * balance (never negative) AND the day's remaining allowance
 * (`openingBalance * DAILY_LOSS_CAP_PCT%` − already `lostToday`). If the pool is
 * tapped out for the day the skim is 0. Rolls the ledger over first.
 */
export function applySkim(
    ledger: DailyLossLedger | null | undefined,
    currentBalance: number,
    now: number,
    pct: number = SKIM_PCT,
): { skim: number; ledger: DailyLossLedger } {
    const rolled = rolloverLedger(ledger, currentBalance, now);
    const bal = Math.max(0, Math.floor(num(currentBalance)));
    const dailyAllowance = Math.floor((rolled.openingBalance * clampPct(pctCapForDay())) / 100);
    const remaining = Math.max(0, dailyAllowance - rolled.lostToday);
    const raw = Math.floor((bal * clampPct(pct)) / 100);
    const skim = Math.max(0, Math.min(raw, bal, remaining));
    return {
        skim,
        ledger: { ...rolled, lostToday: rolled.lostToday + skim },
    };
}

function clampPct(p: number): number {
    return Math.max(0, Math.min(100, num(p)));
}
function pctCapForDay(): number {
    return DAILY_LOSS_CAP_PCT;
}

// ── Caches ───────────────────────────────────────────────────────────────────
/** Cache count minted for a skim — 1 cache per unit skimmed (docs plan §7). */
export function cachesForSkim(skim: number): number {
    return Math.max(0, Math.floor(num(skim)));
}

/** The cache type minted by skimming a given pool. */
export function cacheTypeForPool(pool: WarPool): WarPool {
    return pool;
}

/** The itemStacks item ids for the two caches (the client's event-inventory entries). */
export const CACHE_ITEM_IDS = {
    warSupply: 'war-supply-cache',
    warResources: 'war-resource-cache',
} as const satisfies Record<WarPool, string>;

export function cacheItemIdForPool(pool: WarPool): string {
    return CACHE_ITEM_IDS[pool];
}

/** Reverse lookup: itemStacks id → pool ('war-supply-cache' → 'warSupply'); null for other items. */
export function poolForCacheItemId(itemId: unknown): WarPool | null {
    if (itemId === CACHE_ITEM_IDS.warSupply) return 'warSupply';
    if (itemId === CACHE_ITEM_IDS.warResources) return 'warResources';
    return null;
}

// ── Turn-in (type-locked) ────────────────────────────────────────────────────
/** War Supply cache → clan; War Resource cache → village (decision B). */
export function turnInDestination(cache: WarPool): TurnInDest {
    return cache === 'warSupply' ? 'clan' : 'village';
}

/**
 * Convert held caches of one type into standing points at the type's locked ratio.
 * Clan (War Supply) is 2:1, so an odd cache is left un-consumed; village (War
 * Resource) is 1:1. Returns the points granted, the caches actually consumed, and
 * the destination — so the endpoint credits + decrements atomically and correctly.
 */
export function turnInCaches(cache: WarPool, count: number): { points: number; consumed: number; dest: TurnInDest } {
    const have = Math.max(0, Math.floor(num(count)));
    const dest = turnInDestination(cache);
    const per = dest === 'clan' ? CLAN_CACHES_PER_POINT : VILLAGE_CACHES_PER_POINT;
    const points = Math.floor(have / per);
    const consumed = points * per;
    return { points, consumed, dest };
}

// ── Full reward (win → skims + caches + ryo) ─────────────────────────────────
export interface RaidPoolState {
    /** the pool's current balance */
    balance: number;
    /** the pool's stored daily-loss ledger (or null on first raid of the day) */
    ledger: DailyLossLedger | null | undefined;
}

export interface RaidRewardResult {
    /** which pools the roll selected (for telemetry / the client summary) */
    rolled: { supply: boolean; wr: boolean };
    supplySkim: number;
    wrSkim: number;
    /** ledgers to persist — ONLY for pools that were skimmed (skim > 0 sites debit) */
    supplyLedger: DailyLossLedger;
    wrLedger: DailyLossLedger;
    /** caches minted into the raider's inventory (1:1 with the skims) */
    supplyCaches: number;
    wrCaches: number;
    /** flat personal ryo (the endpoint still applies its own daily cap on top) */
    ryo: number;
}

/**
 * The heart of the settle: given the roll and both pools' authoritative balances +
 * ledgers, compute the skims (each clamped by its own 50%/day floor), the caches,
 * and the ryo. Unselected pools skim 0 and keep their ledger untouched. Pure — the
 * handler supplies `roll` (server RNG) and `now`, then persists the returned
 * ledgers under lock and mints the caches server-side.
 */
export function computeRaidReward(params: {
    roll: number;
    now: number;
    supply: RaidPoolState;
    wr: RaidPoolState;
    ryo?: number;
}): RaidRewardResult {
    const rolled = rollRewardPools(params.roll);

    const supply = rolled.supply
        ? applySkim(params.supply.ledger, params.supply.balance, params.now)
        : { skim: 0, ledger: rolloverLedger(params.supply.ledger, params.supply.balance, params.now) };
    const wr = rolled.wr
        ? applySkim(params.wr.ledger, params.wr.balance, params.now)
        : { skim: 0, ledger: rolloverLedger(params.wr.ledger, params.wr.balance, params.now) };

    return {
        rolled,
        supplySkim: supply.skim,
        wrSkim: wr.skim,
        supplyLedger: supply.ledger,
        wrLedger: wr.ledger,
        supplyCaches: cachesForSkim(supply.skim),
        wrCaches: cachesForSkim(wr.skim),
        ryo: Math.max(0, Math.floor(num(params.ryo, RAID_RYO_REWARD))),
    };
}
