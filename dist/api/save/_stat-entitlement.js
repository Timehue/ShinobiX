"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STAT_RESPEC_FATE_COST = void 0;
exports.applyPaidStatRespec = applyPaidStatRespec;
exports.preserveStatPointEntitlement = preserveStatPointEntitlement;
const _xp_engine_js_1 = require("../_xp-engine.js");
exports.STAT_RESPEC_FATE_COST = 50;
function normalizedStats(value) {
    const raw = value && typeof value === 'object' ? value : {};
    return Object.fromEntries(_xp_engine_js_1.STAT_KEYS.map((key) => {
        const parsed = Number(raw[key]);
        return [key, Number.isFinite(parsed) ? Math.max(10, Math.min(_xp_engine_js_1.MAX_STAT, Math.floor(parsed))) : 10];
    }));
}
function unspent(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}
function allocated(stats) {
    return _xp_engine_js_1.STAT_KEYS.reduce((total, key) => total + Math.max(0, stats[key] - 10), 0);
}
function applyPaidStatRespec(character) {
    const stats = normalizedStats(character.stats);
    const refund = allocated(stats);
    const shards = Math.max(0, Math.floor(Number(character.fateShards) || 0));
    if (refund <= 0 || shards < exports.STAT_RESPEC_FATE_COST)
        return null;
    return {
        ...character,
        stats: Object.fromEntries(_xp_engine_js_1.STAT_KEYS.map((key) => [key, 10])),
        unspentStats: unspent(character.unspentStats) + refund,
        fateShards: shards - exports.STAT_RESPEC_FATE_COST,
    };
}
/**
 * Ordinary saves may allocate the server-owned stat-point pool, or perform the
 * existing paid full respec. They may never create stat points. Training and
 * combat rewards write their grants directly to the stored save first.
 */
function preserveStatPointEntitlement(incoming, existing) {
    const exStats = normalizedStats(existing.stats);
    const inStats = normalizedStats(incoming.stats);
    const exUnspent = unspent(existing.unspentStats);
    const inUnspent = unspent(incoming.unspentStats);
    const exTotal = allocated(exStats) + exUnspent;
    const inTotal = allocated(inStats) + inUnspent;
    if (inTotal !== exTotal)
        return { stats: exStats, unspentStats: exUnspent, accepted: 'rejected' };
    const deltas = _xp_engine_js_1.STAT_KEYS.map((key) => inStats[key] - exStats[key]);
    if (deltas.every((delta) => delta === 0) && inUnspent === exUnspent) {
        return { stats: inStats, unspentStats: inUnspent, accepted: 'unchanged' };
    }
    const gained = deltas.reduce((total, delta) => total + Math.max(0, delta), 0);
    if (deltas.every((delta) => delta >= 0) && exUnspent - inUnspent === gained) {
        return { stats: inStats, unspentStats: inUnspent, accepted: 'allocation' };
    }
    const isFullReset = _xp_engine_js_1.STAT_KEYS.every((key) => inStats[key] === 10);
    const fateBefore = Math.max(0, Number(existing.fateShards) || 0);
    const fateAfter = Math.max(0, Number(incoming.fateShards) || 0);
    if (isFullReset && inUnspent === exUnspent + allocated(exStats) && fateBefore - fateAfter >= exports.STAT_RESPEC_FATE_COST) {
        return { stats: inStats, unspentStats: inUnspent, accepted: 'respec' };
    }
    return { stats: exStats, unspentStats: exUnspent, accepted: 'rejected' };
}
