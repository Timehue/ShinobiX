/**
 * Sector traces — pure logic for the three "the world remembers you" systems:
 *
 *   • footfall — per-sector daily arrival counters ("N shinobi passed through
 *     today"), bumped once per authoritative travel arrival (settleTravelLease).
 *   • trail signs — short player-authored notes pinned to a tile in a wild
 *     sector. Moderated upstream, name-attributed, capped and TTL'd so a sector
 *     never accretes junk: one active sign per player per sector (leaving again
 *     replaces yours), oldest evicted past the sector cap, 72h expiry.
 *   • shrine offerings — the ledger math for the sector shrines (shared/shrines.ts):
 *     lifetime total (drives the cosmetic tier) + weekly top-offerer board that
 *     rolls over on the ISO week. Pure ryo sink — no payouts exist.
 *
 * Everything here is deterministic and storage-free; the handlers own KV and
 * locking. KV keys used by the handlers:
 *   world:footfall:<sector>:<YYYY-MM-DD>   (atomic incr, ~48h TTL)
 *   world:trail-signs:<sector>             (sign array under withKvLock)
 *   world:shrine:<id>                      (ShrineState under withKvLock)
 */

export const TRAIL_SIGN_TTL_MS = 72 * 60 * 60 * 1000;
export const MAX_SIGNS_PER_SECTOR = 8;
export const TRAIL_SIGNS_PER_DAY = 5;
export const FOOTFALL_TTL_SEC = 48 * 60 * 60;
const MAX_SPARKERS_TRACKED = 400;
// Weekly board: track enough offerers that a mid-board player's cumulative week
// total survives falling off the podium; handlers slice to the display size.
const TOP_OFFERERS_KEPT = 25;
export const TOP_OFFERERS_SHOWN = 5;

export type TrailSign = {
    id: string;
    name: string;
    tile: number;
    text: string;
    at: number;
    sparks: number;
    sparkedBy: string[];
};

export type ShrineOffering = { name: string; amount: number };

export type ShrineState = {
    total: number;
    week: string;
    weekTotal: number;
    topWeek: ShrineOffering[];
    lastWeek: { week: string; topWeek: ShrineOffering[] } | null;
    updatedAt: number;
};

/** UTC calendar-day key, e.g. "2026-07-16". */
export function utcDayKey(now: number = Date.now()): string {
    return new Date(now).toISOString().slice(0, 10);
}

export function footfallKey(sector: number, now: number = Date.now()): string {
    return `world:footfall:${Math.floor(sector)}:${utcDayKey(now)}`;
}

export function trailSignsKey(sector: number): string {
    return `world:trail-signs:${Math.floor(sector)}`;
}

export function shrineKey(shrineId: string): string {
    return `world:shrine:${shrineId}`;
}

/** Wild-sector guard for traces (the safe zone has no wilderness to mark). */
export function isTraceSector(sector: unknown): sector is number {
    const n = Number(sector);
    return Number.isInteger(n) && n >= 1 && n <= 60;
}

/** ISO-8601 week key, e.g. "2026-W29" — the shrine board's reset boundary. */
export function isoWeekKey(now: number = Date.now()): string {
    const d = new Date(now);
    const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    // ISO weeks belong to the year containing their Thursday.
    const weekday = day.getUTCDay() || 7;
    day.setUTCDate(day.getUTCDate() + 4 - weekday);
    const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
    const week = Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
    return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function parseSigns(value: unknown): TrailSign[] {
    if (!Array.isArray(value)) return [];
    const out: TrailSign[] = [];
    for (const raw of value) {
        if (!raw || typeof raw !== 'object') continue;
        const s = raw as Partial<TrailSign>;
        const tile = Math.floor(Number(s.tile));
        const at = Math.floor(Number(s.at));
        if (typeof s.id !== 'string' || typeof s.name !== 'string' || typeof s.text !== 'string') continue;
        if (!Number.isFinite(at) || at <= 0) continue;
        out.push({
            id: s.id,
            name: s.name,
            tile: Number.isFinite(tile) && tile >= 0 && tile <= 143 ? tile : 77,
            text: s.text,
            at,
            sparks: Math.max(0, Math.floor(Number(s.sparks)) || 0),
            sparkedBy: Array.isArray(s.sparkedBy) ? s.sparkedBy.filter((n): n is string => typeof n === 'string').slice(0, MAX_SPARKERS_TRACKED) : [],
        });
    }
    return out;
}

export function pruneSigns(signs: TrailSign[], now: number = Date.now()): TrailSign[] {
    return signs.filter((s) => now - s.at < TRAIL_SIGN_TTL_MS);
}

/**
 * Add (or replace) a player's sign in a sector. One active sign per player per
 * sector; past the sector cap the OLDEST sign is evicted so fresh traces win.
 */
export function addSign(signs: TrailSign[], sign: TrailSign, now: number = Date.now()): TrailSign[] {
    const next = pruneSigns(signs, now).filter((s) => s.name !== sign.name);
    next.push(sign);
    next.sort((a, b) => a.at - b.at);
    return next.slice(Math.max(0, next.length - MAX_SIGNS_PER_SECTOR));
}

export type SparkResult = { ok: true; signs: TrailSign[]; sparks: number } | { ok: false; reason: 'not-found' | 'own-sign' | 'already-sparked' };

/** One appreciation tap per player per sign; you cannot spark your own. */
export function applySpark(signs: TrailSign[], signId: string, player: string, now: number = Date.now()): SparkResult {
    const next = pruneSigns(signs, now);
    const sign = next.find((s) => s.id === signId);
    if (!sign) return { ok: false, reason: 'not-found' };
    if (sign.name === player) return { ok: false, reason: 'own-sign' };
    if (sign.sparkedBy.includes(player)) return { ok: false, reason: 'already-sparked' };
    sign.sparks += 1;
    if (sign.sparkedBy.length < MAX_SPARKERS_TRACKED) sign.sparkedBy.push(player);
    return { ok: true, signs: next, sparks: sign.sparks };
}

export function parseShrineState(value: unknown): ShrineState {
    const raw = (value && typeof value === 'object' ? value : {}) as Partial<ShrineState>;
    const offerings = (list: unknown): ShrineOffering[] => Array.isArray(list)
        ? list
            .filter((o): o is ShrineOffering => !!o && typeof o === 'object' && typeof (o as ShrineOffering).name === 'string')
            .map((o) => ({ name: o.name, amount: Math.max(0, Math.floor(Number(o.amount)) || 0) }))
            .slice(0, TOP_OFFERERS_KEPT)
        : [];
    const lastWeekRaw = raw.lastWeek && typeof raw.lastWeek === 'object' ? raw.lastWeek : null;
    return {
        total: Math.max(0, Math.floor(Number(raw.total)) || 0),
        week: typeof raw.week === 'string' ? raw.week : '',
        weekTotal: Math.max(0, Math.floor(Number(raw.weekTotal)) || 0),
        topWeek: offerings(raw.topWeek),
        lastWeek: lastWeekRaw && typeof lastWeekRaw.week === 'string'
            ? { week: lastWeekRaw.week, topWeek: offerings(lastWeekRaw.topWeek) }
            : null,
        updatedAt: Math.max(0, Math.floor(Number(raw.updatedAt)) || 0),
    };
}

/** Fold an offering into the ledger, rolling the weekly board on ISO-week change. */
export function applyOffering(state: ShrineState, name: string, amount: number, now: number = Date.now()): ShrineState {
    const week = isoWeekKey(now);
    let { weekTotal, topWeek, lastWeek } = state;
    if (state.week !== week) {
        lastWeek = state.week ? { week: state.week, topWeek: state.topWeek } : state.lastWeek;
        weekTotal = 0;
        topWeek = [];
    }
    const board = [...topWeek];
    const mine = board.find((o) => o.name === name);
    if (mine) mine.amount += amount;
    else board.push({ name, amount });
    board.sort((a, b) => b.amount - a.amount);
    return {
        total: state.total + amount,
        week,
        weekTotal: weekTotal + amount,
        topWeek: board.slice(0, TOP_OFFERERS_KEPT),
        lastWeek,
        updatedAt: now,
    };
}
