/*
 * Village Stores — Provisions (rations) + Materials (craft points). Pure core.
 *
 * Two server-owned stockpiles extend the existing village treasury
 * (`villageState.treasury.provisions` / `.materialPoints`). They are fed ONLY by
 * the atomic donation endpoint (ration-pack → provisions 1:1; hunt-* materials
 * and forge relics → material points via api/craft/_forge.ts CRAFT_POINTS), and
 * drained ONLY by the daily village-war pass (api/_war-daily.ts) and the
 * structure purchase endpoint. The client blob may never raise either figure
 * (api/_village-state-validate.ts treats them exactly like the currencies).
 *
 * Daily consumption order (§3 of the design): spoilage first, then each
 * active sector war, then each live merc band, then each fed garrison. A
 * consumer the stock can't cover is UNFED for the day — the war loses half of
 * its Watchtower bonus, the merc band skips one auto-deploy tick, the garrison
 * bonus simply doesn't apply. Material points convert into War Resources at a
 * Supply-Depot-scaled daily cap.
 *
 * IO-free; every number lives here. Kill switch: villageStoresEnabled in
 * api/_release-flags.ts. Underscore-prefixed → a helper, not a route.
 */

export const RATION_ITEM_ID = 'ration-pack';

/** Provisions lost per day before any consumer eats (floored). */
export const PROVISION_SPOIL_RATE = 0.05;
/** Rations each ACTIVE sector war costs a participating village per day. */
export const WAR_RATIONS_PER_DAY = 30;
/** Rations per live mercenary per day (× the band's surviving size). */
export const MERC_RATIONS_PER_MEMBER = 8;
/** Rations a war with the garrison-feed toggle on costs per day. */
export const GARRISON_RATIONS_PER_DAY = 15;
/** Material points burned per 1 War Resource at the Supply Depot. */
export const DEPOT_CONVERSION_POINTS_PER_WR = 10;
/** Provisions burned (once, receipt-keyed) when a HOME sector flips away. */
export const HOME_LOSS_PROVISION_BURN = 0.25;

/** Ryo-equivalents for meritForDonation (cooks/hunters earn merit like ryo donors). */
export const RATION_RYO_VALUE = 6;
export const CRAFT_POINT_RYO_VALUE = 4;

/** Per-player daily donation caps (UTC day, server counter on the save). */
export const DAILY_RATION_DONATION_CAP = 40;
export const DAILY_CRAFT_POINT_DONATION_CAP = 1_500;
/** Per-player daily cook cap (rations produced, UTC day). */
export const DAILY_RATION_COOK_CAP = 40;

/** Garrison points cap while the garrison is fed AND the day's 15 rations were covered. */
export const GARRISON_POINTS_CAP_FED = 200;

/** Materials gate on permanent structures: material points debited when raising
 *  a structure TO the given level (L6..L10). Levels ≤ 5 are unchanged. */
export const STRUCTURE_MATERIALS_BY_LEVEL: Readonly<Record<number, number>> = {
    6: 400, 7: 700, 8: 1_100, 9: 1_600, 10: 2_400,
};
/** Structure levels at/above which the upgrade heralds 'high'. */
export const STRUCTURE_HERALD_MIN_LEVEL = 8;

export const STORES_LEDGER_CAP = 30;
/** How many ledger rows the war-map view ships. */
export const STORES_LEDGER_VIEW_ROWS = 10;

export type StoresLedgerKind = 'spoil' | 'war' | 'merc' | 'garrison' | 'convert' | 'structure' | 'feed-toggle' | 'home-loss';

export interface StoresLedgerEntry {
    at: number;
    kind: StoresLedgerKind;
    amount: number;
    by?: string;
    ref?: string;
}

function nonNeg(v: unknown): number {
    const n = Math.floor(Number(v) || 0);
    return n > 0 ? n : 0;
}

/** Daily material→WR conversion cap by Supply Depot level: 100 + 30×level
 *  (L0 100, L5 250, L10 400). */
export function depotConversionCap(depotLevel: number): number {
    const lvl = Math.max(0, Math.min(10, Math.floor(Number(depotLevel) || 0)));
    return 100 + 30 * lvl;
}

/** Material points required to raise a structure TO `newLevel` (0 below L6). */
export function structureMaterialsCost(newLevel: number): number {
    return STRUCTURE_MATERIALS_BY_LEVEL[Math.floor(Number(newLevel) || 0)] ?? 0;
}

/** Read the two stores off a treasury blob (never negative, always integers). */
export function readStores(treasury: Record<string, unknown> | null | undefined): { provisions: number; materialPoints: number } {
    const t = treasury ?? {};
    return { provisions: nonNeg(t.provisions), materialPoints: nonNeg(t.materialPoints) };
}

/** Append to a ledger, newest LAST, capped at STORES_LEDGER_CAP (oldest dropped). */
export function appendStoresLedger(ledger: unknown, entries: readonly StoresLedgerEntry[]): StoresLedgerEntry[] {
    const cur = parseStoresLedger(ledger);
    return [...cur, ...entries].slice(-STORES_LEDGER_CAP);
}

export function parseStoresLedger(raw: unknown): StoresLedgerEntry[] {
    if (!Array.isArray(raw)) return [];
    const out: StoresLedgerEntry[] = [];
    for (const e of raw) {
        if (!e || typeof e !== 'object') continue;
        const v = e as Record<string, unknown>;
        const kind = String(v.kind ?? '');
        if (!['spoil', 'war', 'merc', 'garrison', 'convert', 'structure', 'feed-toggle', 'home-loss'].includes(kind)) continue;
        out.push({
            at: Math.floor(Number(v.at) || 0),
            kind: kind as StoresLedgerKind,
            amount: Math.floor(Number(v.amount) || 0),
            ...(typeof v.by === 'string' && v.by ? { by: v.by } : {}),
            ...(typeof v.ref === 'string' && v.ref ? { ref: v.ref } : {}),
        });
    }
    return out.slice(-STORES_LEDGER_CAP);
}

/** Where an item donation lands once stores are on: rations → provisions, any
 *  CRAFT_POINTS material/relic → material points, anything else → loose
 *  treasury items (null). `craftPoints` is the api/craft/_forge.ts table. */
export function storesDonationRouting(
    itemId: string,
    count: number,
    craftPoints: Readonly<Record<string, number>>,
): { store: 'provisions'; amount: number } | { store: 'materialPoints'; amount: number; perItem: number } | null {
    const n = nonNeg(count);
    if (itemId === RATION_ITEM_ID) return { store: 'provisions', amount: n };
    const per = craftPoints[itemId];
    if (per && per > 0) return { store: 'materialPoints', amount: n * per, perItem: per };
    return null;
}

// ── Daily step ──────────────────────────────────────────────────────────────

export interface StoresDayWarInput {
    id: string;
    /** Whether this village turned the garrison-feed toggle on for the war. */
    garrisonFed: boolean;
}
export interface StoresDayMercInput {
    tierId: string;
    player: string;
    /** Surviving band size (rations scale with it). */
    size: number;
}
export interface StoresDayInput {
    provisions: number;
    materialPoints: number;
    warResources: number;
    wrPoolCap: number;
    depotLevel: number;
    wars: readonly StoresDayWarInput[];
    mercs: readonly StoresDayMercInput[];
    now: number;
}
export interface StoresDayOutput {
    provisions: number;
    materialPoints: number;
    warResources: number;
    spoiled: number;
    wrConverted: number;
    pointsConverted: number;
    wars: Array<{ id: string; fed: boolean; garrisonCovered: boolean }>;
    mercs: Array<{ tierId: string; player: string; fed: boolean }>;
    /** True when at least one WAR went unfed (drives the herald + Kage notice). */
    anyWarUnfed: boolean;
    ledger: StoresLedgerEntry[];
}

/** One village's daily stores step. Pure; the caller persists the three
 *  balances, the per-war flags, and the merc skips. Order: spoil → wars →
 *  mercs → garrisons → depot conversion. A consumer the stock can't fully cover
 *  is skipped entirely (no partial feeding) and stays unfed for the day. */
export function stepVillageStoresDay(input: StoresDayInput): StoresDayOutput {
    let provisions = nonNeg(input.provisions);
    let materialPoints = nonNeg(input.materialPoints);
    let warResources = nonNeg(input.warResources);
    const ledger: StoresLedgerEntry[] = [];
    const at = Math.floor(Number(input.now) || 0);

    const spoiled = Math.floor(provisions * PROVISION_SPOIL_RATE);
    if (spoiled > 0) {
        provisions -= spoiled;
        ledger.push({ at, kind: 'spoil', amount: spoiled });
    }

    const wars: StoresDayOutput['wars'] = [];
    for (const w of input.wars) {
        const fed = provisions >= WAR_RATIONS_PER_DAY;
        if (fed) {
            provisions -= WAR_RATIONS_PER_DAY;
            ledger.push({ at, kind: 'war', amount: WAR_RATIONS_PER_DAY, ref: w.id });
        }
        wars.push({ id: w.id, fed, garrisonCovered: false });
    }

    const mercs: StoresDayOutput['mercs'] = [];
    for (const m of input.mercs) {
        const need = MERC_RATIONS_PER_MEMBER * nonNeg(m.size);
        const fed = need === 0 || provisions >= need;
        if (fed && need > 0) {
            provisions -= need;
            ledger.push({ at, kind: 'merc', amount: need, by: m.player, ref: m.tierId });
        }
        mercs.push({ tierId: m.tierId, player: m.player, fed });
    }

    input.wars.forEach((w, i) => {
        if (!w.garrisonFed) return;
        if (provisions >= GARRISON_RATIONS_PER_DAY) {
            provisions -= GARRISON_RATIONS_PER_DAY;
            wars[i].garrisonCovered = true;
            ledger.push({ at, kind: 'garrison', amount: GARRISON_RATIONS_PER_DAY, ref: w.id });
        }
    });

    // Depot conversion: whole WR only, capped by depot level AND the pool cap.
    const cap = depotConversionCap(input.depotLevel);
    const room = Math.max(0, nonNeg(input.wrPoolCap) - warResources);
    const affordable = Math.floor(materialPoints / DEPOT_CONVERSION_POINTS_PER_WR);
    const wrConverted = Math.max(0, Math.min(cap, room, affordable));
    const pointsConverted = wrConverted * DEPOT_CONVERSION_POINTS_PER_WR;
    if (wrConverted > 0) {
        materialPoints -= pointsConverted;
        warResources += wrConverted;
        ledger.push({ at, kind: 'convert', amount: pointsConverted, ref: `wr:${wrConverted}` });
    }

    return {
        provisions, materialPoints, warResources, spoiled, wrConverted, pointsConverted,
        wars, mercs, anyWarUnfed: wars.some((w) => !w.fed), ledger,
    };
}

/** Provisions to burn when a home sector is lost (25%, floored). */
export function homeLossBurn(provisions: number): number {
    return Math.floor(nonNeg(provisions) * HOME_LOSS_PROVISION_BURN);
}

/** Halve a structure BONUS (the part above 1×) for an unfed war: 1.15 → 1.075. */
export function unfedStructureMultiplier(mult: number): number {
    const m = Number(mult);
    if (!Number.isFinite(m) || m <= 1) return Math.max(0, m || 1);
    return 1 + (m - 1) / 2;
}

// ── Per-player daily counters (server-mirrored save fields) ─────────────────

export function utcDay(now: number): string {
    return new Date(now).toISOString().slice(0, 10);
}

/** Read a UTC-day-keyed counter off a character (0 on a new day). */
export function dailyCounter(character: Record<string, unknown>, dateField: string, countField: string, today: string): number {
    return String(character[dateField] ?? '') === today ? nonNeg(character[countField]) : 0;
}

/** Stamp a day-keyed counter (monotonic within the day — never below the stored value). */
export function stampDailyCounter(
    character: Record<string, unknown>,
    dateField: string,
    countField: string,
    today: string,
    next: number,
): Record<string, unknown> {
    const cur = dailyCounter(character, dateField, countField, today);
    return { ...character, [dateField]: today, [countField]: Math.max(cur, nonNeg(next)) };
}

export const COOK_DATE_FIELD = 'rationsCookedDate';
export const COOK_COUNT_FIELD = 'rationsCookedToday';
export const DONATE_DATE_FIELD = 'storesDonatedDate';
export const DONATE_RATIONS_FIELD = 'rationsDonatedToday';
export const DONATE_POINTS_FIELD = 'craftPointsDonatedToday';
