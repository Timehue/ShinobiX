"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_WAR_ECO_TXNS = exports.WAR_ECO_TXN_LIST_KEY = exports.SEAL_SINK_KINDS = exports.WR_SINK_KINDS = exports.WAR_ECO_KINDS = void 0;
exports.villageSlug = villageSlug;
exports.warEcoAggKey = warEcoAggKey;
exports.applyEventToAgg = applyEventToAgg;
exports.summarizeVillageAgg = summarizeVillageAgg;
exports.duplicateEventIds = duplicateEventIds;
exports.recordWarEcoEvent = recordWarEcoEvent;
exports.readWarEcoSnapshot = readWarEcoSnapshot;
const _storage_js_1 = require("./_storage.js");
exports.WAR_ECO_KINDS = [
    'wr.earn', 'wr.spend.declare', 'wr.spend.maintenance', 'wr.spend.merc',
    'seals.earn', 'seals.spend.structure',
    'tax.collect', 'tax.burn', 'tax.treasury',
    'dormancy.enter', 'dormancy.exit', 'sector.capture',
];
// The WR sink kinds — summed into "WR out" for the faucet-vs-sink view.
exports.WR_SINK_KINDS = [
    'wr.spend.declare', 'wr.spend.maintenance', 'wr.spend.merc',
];
// The treasury-seal sink kinds — summed into "seals out".
exports.SEAL_SINK_KINDS = [
    'seals.spend.structure',
];
exports.WAR_ECO_TXN_LIST_KEY = 'war:eco:txns';
exports.MAX_WAR_ECO_TXNS = 5000;
function villageSlug(village) {
    return String(village).trim().toLowerCase().replace(/\s+/g, '-');
}
function warEcoAggKey(village) {
    return `war:eco:agg:${villageSlug(village)}`;
}
function isWarEcoKind(v) {
    return typeof v === 'string' && exports.WAR_ECO_KINDS.includes(v);
}
// Pure: fold one event's amount into a per-village aggregate (additive per kind).
function applyEventToAgg(agg, kind, amount) {
    if (!Number.isFinite(amount) || amount <= 0)
        return agg;
    return { ...agg, [kind]: (agg[kind] ?? 0) + Math.round(amount) };
}
function summarizeVillageAgg(agg) {
    const get = (k) => Math.max(0, Math.round(Number(agg[k] ?? 0)));
    const sum = (ks) => ks.reduce((acc, k) => acc + get(k), 0);
    const wrIn = get('wr.earn');
    const wrOut = sum(exports.WR_SINK_KINDS);
    const sealsIn = get('seals.earn');
    const sealsOut = sum(exports.SEAL_SINK_KINDS);
    return {
        wrIn,
        wrOut,
        wrNet: wrIn - wrOut,
        sealsIn,
        sealsOut,
        sealsNet: sealsIn - sealsOut,
        taxCollected: get('tax.collect'),
        taxBurned: get('tax.burn'),
        taxTreasury: get('tax.treasury'),
        maintenancePaid: get('wr.spend.maintenance'),
        dormancyEnters: get('dormancy.enter'),
        sectorsCaptured: get('sector.capture'),
        byKind: { ...agg },
    };
}
// Pure: eventIds seen more than once in a recent list (replay / dup).
function duplicateEventIds(events) {
    const counts = new Map();
    for (const e of events)
        counts.set(e.eventId, (counts.get(e.eventId) ?? 0) + 1);
    return [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
}
// Record one war-economy event. Best-effort, never throws into the war write.
// No-op for a non-positive amount or an unknown kind. The aggregate update is a
// lock-free read-modify-write — at tens of players a rare lost update only
// slightly understates a trend counter; the capped txn list is the precise
// drill-down.
async function recordWarEcoEvent(ev, opts = {}) {
    const store = opts.kv ?? _storage_js_1.kv;
    try {
        const amount = Number(ev.amount);
        if (!Number.isFinite(amount) || amount <= 0)
            return;
        if (!isWarEcoKind(ev.kind))
            return;
        const village = String(ev.village ?? '').trim();
        if (!village)
            return;
        const full = {
            ts: ev.ts ?? Date.now(),
            eventId: String(ev.eventId).slice(0, 120),
            village: village.slice(0, 48),
            kind: ev.kind,
            amount: Math.round(amount),
            ...(ev.meta ? { meta: String(ev.meta).slice(0, 64) } : {}),
        };
        // Per-village running aggregate.
        const aggK = warEcoAggKey(full.village);
        const agg = (await store.get(aggK)) ?? {};
        await store.set(aggK, applyEventToAgg(agg, full.kind, full.amount));
        // Capped recent list (newest-first).
        const list = (await store.get(exports.WAR_ECO_TXN_LIST_KEY)) ?? [];
        await store.set(exports.WAR_ECO_TXN_LIST_KEY, [full, ...list].slice(0, exports.MAX_WAR_ECO_TXNS));
    }
    catch (e) {
        console.error('[war-telemetry] recordWarEcoEvent failed:', e);
    }
}
// Read per-village derived views + a slice of recent events for the admin panel.
async function readWarEcoSnapshot(villages, recentLimit = 200, opts = {}) {
    const store = opts.kv ?? _storage_js_1.kv;
    const out = {};
    try {
        for (const v of villages) {
            const agg = (await store.get(warEcoAggKey(v))) ?? {};
            if (Object.keys(agg).length === 0)
                continue;
            out[v] = summarizeVillageAgg(agg);
        }
    }
    catch { /* best-effort */ }
    let recent = [];
    try {
        const list = (await store.get(exports.WAR_ECO_TXN_LIST_KEY)) ?? [];
        recent = list.slice(0, Math.max(1, Math.min(recentLimit, exports.MAX_WAR_ECO_TXNS)));
    }
    catch { /* best-effort */ }
    return { villages: out, recent, duplicateEventIds: duplicateEventIds(recent) };
}
