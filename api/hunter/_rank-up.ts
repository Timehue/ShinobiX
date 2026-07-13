export const HUNTER_RANK_REQUIREMENTS = [
    { itemId: 'hunt-beast-meat', qty: 5 },
    { itemId: 'hunt-wolf-fang', qty: 5 },
    { itemId: 'hunt-ash-scale', qty: 5 },
    { itemId: 'hunt-shadow-pelt', qty: 5 },
    { itemId: 'hunt-legendary-material', qty: 3 },
] as const;

function removeOwnedItem(character: Record<string, unknown>, itemId: string, qty: number) {
    let remaining = qty;
    const inventory = (Array.isArray(character.inventory) ? character.inventory : []).filter((raw) => {
        if (raw === itemId && remaining > 0) { remaining -= 1; return false; }
        return true;
    });
    const itemStacks = (Array.isArray(character.itemStacks) ? character.itemStacks : []).flatMap((raw) => {
        if (!raw || typeof raw !== 'object') return [];
        const row = raw as Record<string, unknown>;
        const id = String(row.itemId ?? '');
        const count = Math.max(0, Math.floor(Number(row.count) || 0));
        if (!id || count <= 0) return [];
        if (id !== itemId || remaining <= 0) return [{ itemId: id, count }];
        const taken = Math.min(count, remaining);
        remaining -= taken;
        return count > taken ? [{ itemId: id, count: count - taken }] : [];
    });
    return remaining === 0 ? { inventory, itemStacks } : null;
}

export function rankUpHunter(character: Record<string, unknown>, actionIdRaw: unknown) {
    const actionId = typeof actionIdRaw === 'string' ? actionIdRaw.trim().slice(0, 80) : '';
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(actionId)) return { ok: false as const, reason: 'invalid-action-id' as const };
    const receipts = Array.isArray(character.redeemedHunterRanks)
        ? (character.redeemedHunterRanks as unknown[]).filter((id): id is string => typeof id === 'string').slice(-31)
        : [];
    if (receipts.includes(actionId)) return { ok: true as const, alreadyApplied: true, character };
    const rank = Math.max(0, Math.floor(Number(character.hunterRank) || 0));
    const requirement = HUNTER_RANK_REQUIREMENTS[rank];
    if (!requirement) return { ok: false as const, reason: 'hunter-rank-max' as const };
    const removed = removeOwnedItem(character, requirement.itemId, requirement.qty);
    if (!removed) return { ok: false as const, reason: 'hunter-rank-materials-required' as const };
    return {
        ok: true as const,
        alreadyApplied: false,
        character: { ...character, ...removed, hunterRank: rank + 1, redeemedHunterRanks: [...receipts, actionId] },
    };
}
