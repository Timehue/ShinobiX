"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BLOODLINE_FORGE_COSTS = exports.BLOODLINE_FORGE_RANKS = void 0;
exports.parseBloodlineForgeRank = parseBloodlineForgeRank;
exports.readPendingBloodlineForges = readPendingBloodlineForges;
exports.applyBloodlineForgePurchase = applyBloodlineForgePurchase;
exports.BLOODLINE_FORGE_RANKS = ['B Rank', 'A Rank', 'S Rank'];
exports.BLOODLINE_FORGE_COSTS = {
    'B Rank': { currency: 'boneCharms', cost: 100 },
    'A Rank': { currency: 'auraStones', cost: 100 },
    'S Rank': { currency: 'mythicSeals', cost: 100 },
};
const PENDING_FORGE_CAP = 3;
function parseBloodlineForgeRank(value) {
    return typeof value === 'string' && exports.BLOODLINE_FORGE_RANKS.includes(value)
        ? value
        : null;
}
function readPendingBloodlineForges(value) {
    if (!Array.isArray(value))
        return [];
    const out = [];
    const seen = new Set();
    for (const raw of value) {
        if (!raw || typeof raw !== 'object')
            continue;
        const item = raw;
        const id = typeof item.id === 'string' && /^[a-f0-9-]{16,64}$/i.test(item.id) ? item.id : '';
        const rank = parseBloodlineForgeRank(item.rank);
        const issuedAt = Math.max(0, Math.floor(Number(item.issuedAt) || 0));
        if (!id || !rank || !issuedAt || seen.has(id))
            continue;
        out.push({ id, rank, issuedAt });
        seen.add(id);
        if (out.length >= PENDING_FORGE_CAP)
            break;
    }
    return out;
}
function applyBloodlineForgePurchase(character, pendingRaw, rankRaw, entitlementId, now) {
    const rank = parseBloodlineForgeRank(rankRaw);
    if (!rank)
        return { ok: false, status: 400, error: 'Invalid bloodline rank.' };
    const pending = readPendingBloodlineForges(pendingRaw);
    if (pending.length >= PENDING_FORGE_CAP) {
        return { ok: false, status: 409, error: 'Finish a pending bloodline forge before purchasing another.' };
    }
    const { currency, cost } = exports.BLOODLINE_FORGE_COSTS[rank];
    const balance = Math.max(0, Math.floor(Number(character[currency]) || 0));
    if (balance < cost)
        return { ok: false, status: 409, error: `Not enough ${currency}.` };
    const entitlement = { id: entitlementId, rank, issuedAt: Math.floor(now) };
    return {
        ok: true,
        character: { ...character, [currency]: balance - cost },
        pending: [...pending, entitlement],
        entitlement,
        currency,
        cost,
        balance: balance - cost,
    };
}
