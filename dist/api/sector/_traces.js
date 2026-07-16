"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOP_OFFERERS_SHOWN = exports.FOOTFALL_TTL_SEC = exports.TRAIL_SIGNS_PER_DAY = exports.MAX_SIGNS_PER_SECTOR = exports.TRAIL_SIGN_TTL_MS = void 0;
exports.utcDayKey = utcDayKey;
exports.footfallKey = footfallKey;
exports.trailSignsKey = trailSignsKey;
exports.shrineKey = shrineKey;
exports.isTraceSector = isTraceSector;
exports.isoWeekKey = isoWeekKey;
exports.parseSigns = parseSigns;
exports.pruneSigns = pruneSigns;
exports.addSign = addSign;
exports.applySpark = applySpark;
exports.parseShrineState = parseShrineState;
exports.applyOffering = applyOffering;
exports.TRAIL_SIGN_TTL_MS = 72 * 60 * 60 * 1000;
exports.MAX_SIGNS_PER_SECTOR = 8;
exports.TRAIL_SIGNS_PER_DAY = 5;
exports.FOOTFALL_TTL_SEC = 48 * 60 * 60;
const MAX_SPARKERS_TRACKED = 400;
// Weekly board: track enough offerers that a mid-board player's cumulative week
// total survives falling off the podium; handlers slice to the display size.
const TOP_OFFERERS_KEPT = 25;
exports.TOP_OFFERERS_SHOWN = 5;
/** UTC calendar-day key, e.g. "2026-07-16". */
function utcDayKey(now = Date.now()) {
    return new Date(now).toISOString().slice(0, 10);
}
function footfallKey(sector, now = Date.now()) {
    return `world:footfall:${Math.floor(sector)}:${utcDayKey(now)}`;
}
function trailSignsKey(sector) {
    return `world:trail-signs:${Math.floor(sector)}`;
}
function shrineKey(shrineId) {
    return `world:shrine:${shrineId}`;
}
/** Wild-sector guard for traces (the safe zone has no wilderness to mark). */
function isTraceSector(sector) {
    const n = Number(sector);
    return Number.isInteger(n) && n >= 1 && n <= 60;
}
/** ISO-8601 week key, e.g. "2026-W29" — the shrine board's reset boundary. */
function isoWeekKey(now = Date.now()) {
    const d = new Date(now);
    const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    // ISO weeks belong to the year containing their Thursday.
    const weekday = day.getUTCDay() || 7;
    day.setUTCDate(day.getUTCDate() + 4 - weekday);
    const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
    const week = Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
    return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
function parseSigns(value) {
    if (!Array.isArray(value))
        return [];
    const out = [];
    for (const raw of value) {
        if (!raw || typeof raw !== 'object')
            continue;
        const s = raw;
        const tile = Math.floor(Number(s.tile));
        const at = Math.floor(Number(s.at));
        if (typeof s.id !== 'string' || typeof s.name !== 'string' || typeof s.text !== 'string')
            continue;
        if (!Number.isFinite(at) || at <= 0)
            continue;
        out.push({
            id: s.id,
            name: s.name,
            tile: Number.isFinite(tile) && tile >= 0 && tile <= 143 ? tile : 77,
            text: s.text,
            at,
            sparks: Math.max(0, Math.floor(Number(s.sparks)) || 0),
            sparkedBy: Array.isArray(s.sparkedBy) ? s.sparkedBy.filter((n) => typeof n === 'string').slice(0, MAX_SPARKERS_TRACKED) : [],
        });
    }
    return out;
}
function pruneSigns(signs, now = Date.now()) {
    return signs.filter((s) => now - s.at < exports.TRAIL_SIGN_TTL_MS);
}
/**
 * Add (or replace) a player's sign in a sector. One active sign per player per
 * sector; past the sector cap the OLDEST sign is evicted so fresh traces win.
 */
function addSign(signs, sign, now = Date.now()) {
    const next = pruneSigns(signs, now).filter((s) => s.name !== sign.name);
    next.push(sign);
    next.sort((a, b) => a.at - b.at);
    return next.slice(Math.max(0, next.length - exports.MAX_SIGNS_PER_SECTOR));
}
/** One appreciation tap per player per sign; you cannot spark your own. */
function applySpark(signs, signId, player, now = Date.now()) {
    const next = pruneSigns(signs, now);
    const sign = next.find((s) => s.id === signId);
    if (!sign)
        return { ok: false, reason: 'not-found' };
    if (sign.name === player)
        return { ok: false, reason: 'own-sign' };
    if (sign.sparkedBy.includes(player))
        return { ok: false, reason: 'already-sparked' };
    sign.sparks += 1;
    if (sign.sparkedBy.length < MAX_SPARKERS_TRACKED)
        sign.sparkedBy.push(player);
    return { ok: true, signs: next, sparks: sign.sparks };
}
function parseShrineState(value) {
    const raw = (value && typeof value === 'object' ? value : {});
    const offerings = (list) => Array.isArray(list)
        ? list
            .filter((o) => !!o && typeof o === 'object' && typeof o.name === 'string')
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
function applyOffering(state, name, amount, now = Date.now()) {
    const week = isoWeekKey(now);
    let { weekTotal, topWeek, lastWeek } = state;
    if (state.week !== week) {
        lastWeek = state.week ? { week: state.week, topWeek: state.topWeek } : state.lastWeek;
        weekTotal = 0;
        topWeek = [];
    }
    const board = [...topWeek];
    const mine = board.find((o) => o.name === name);
    if (mine)
        mine.amount += amount;
    else
        board.push({ name, amount });
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
