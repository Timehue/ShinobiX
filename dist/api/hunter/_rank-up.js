"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HUNTER_RANK_REQUIREMENTS = void 0;
exports.rankUpHunter = rankUpHunter;
exports.HUNTER_RANK_REQUIREMENTS = [
    { itemId: 'hunt-beast-meat', qty: 5 },
    { itemId: 'hunt-wolf-fang', qty: 5 },
    { itemId: 'hunt-ash-scale', qty: 5 },
    { itemId: 'hunt-shadow-pelt', qty: 5 },
    { itemId: 'hunt-legendary-material', qty: 3 },
];
function removeOwnedItem(character, itemId, qty) {
    let remaining = qty;
    const inventory = (Array.isArray(character.inventory) ? character.inventory : []).filter((raw) => {
        if (raw === itemId && remaining > 0) {
            remaining -= 1;
            return false;
        }
        return true;
    });
    const itemStacks = (Array.isArray(character.itemStacks) ? character.itemStacks : []).flatMap((raw) => {
        if (!raw || typeof raw !== 'object')
            return [];
        const row = raw;
        const id = String(row.itemId ?? '');
        const count = Math.max(0, Math.floor(Number(row.count) || 0));
        if (!id || count <= 0)
            return [];
        if (id !== itemId || remaining <= 0)
            return [{ itemId: id, count }];
        const taken = Math.min(count, remaining);
        remaining -= taken;
        return count > taken ? [{ itemId: id, count: count - taken }] : [];
    });
    return remaining === 0 ? { inventory, itemStacks } : null;
}
function rankUpHunter(character, actionIdRaw) {
    const actionId = typeof actionIdRaw === 'string' ? actionIdRaw.trim().slice(0, 80) : '';
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(actionId))
        return { ok: false, reason: 'invalid-action-id' };
    const receipts = Array.isArray(character.redeemedHunterRanks)
        ? character.redeemedHunterRanks.filter((id) => typeof id === 'string').slice(-31)
        : [];
    if (receipts.includes(actionId))
        return { ok: true, alreadyApplied: true, character };
    const rank = Math.max(0, Math.floor(Number(character.hunterRank) || 0));
    const requirement = exports.HUNTER_RANK_REQUIREMENTS[rank];
    if (!requirement)
        return { ok: false, reason: 'hunter-rank-max' };
    const removed = removeOwnedItem(character, requirement.itemId, requirement.qty);
    if (!removed)
        return { ok: false, reason: 'hunter-rank-materials-required' };
    return {
        ok: true,
        alreadyApplied: false,
        character: { ...character, ...removed, hunterRank: rank + 1, redeemedHunterRanks: [...receipts, actionId] },
    };
}
