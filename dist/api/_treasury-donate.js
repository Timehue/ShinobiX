"use strict";
// Shared, IO-free core for the atomic treasury-donation endpoints
// (api/clan/treasury/donate.ts + api/village/treasury/donate.ts).
//
// Both endpoints move a currency amount OR an inventory item FROM a donor's
// save INTO a shared treasury (the clan save blob / the village-state blob).
// The security-critical property is that the debit (donor) and the credit
// (treasury) are decided TOGETHER, so a caller can never credit a treasury
// without a matching debit it actually has the funds/items for. The handlers
// wrap this in dual KV locks + the real reads/writes; this module is the
// IO-free decision core so it can be unit-tested without mocking storage —
// the same split used by _clan-save-validate.ts / _village-state-validate.ts.
//
// Incidental gameplay rewards for donating (clan XP, clanEventContrib,
// village contributionPoints, notice-board posts) are intentionally NOT
// handled here. They remain client-side exactly as before, written through
// the normal save path on top of the server-credited treasury this returns
// (the client re-asserts the treasury at the value returned here, so the
// per-field save validators see a zero delta and leave it untouched).
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanTreasuryItems = cleanTreasuryItems;
exports.applyTreasuryDonation = applyTreasuryDonation;
function num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}
// Merge stacked treasury item entries, dropping empties — mirrors the client
// cleanTreasuryItems() in shinobij.client/src/lib/items.ts so the treasury we
// write back is the same shape the client renders.
function cleanTreasuryItems(items) {
    const counts = new Map();
    if (Array.isArray(items)) {
        for (const raw of items) {
            const s = (raw ?? {});
            const id = typeof s.itemId === 'string' ? s.itemId : '';
            if (!id)
                continue;
            counts.set(id, (counts.get(id) ?? 0) + Math.max(0, Math.floor(num(s.count))));
        }
    }
    return [...counts.entries()]
        .filter(([, count]) => count > 0)
        .map(([itemId, count]) => ({ itemId, count }));
}
function countOwned(inventory, itemId) {
    if (!Array.isArray(inventory))
        return 0;
    return inventory.filter((i) => i === itemId).length;
}
function removeFromInventory(inventory, itemId, n) {
    const inv = Array.isArray(inventory) ? inventory.slice() : [];
    let remaining = n;
    return inv.filter((i) => {
        if (i === itemId && remaining > 0) {
            remaining--;
            return false;
        }
        return true;
    });
}
/**
 * Decide a single treasury donation. Pure: no IO, no clocks. Returns the
 * next donor character and next treasury on success, or an error with an
 * HTTP-style status the handler can pass straight through.
 *
 * Caller is responsible for authentication + membership checks; this only
 * enforces the economic rules (allowed currency, per-call caps, sufficient
 * balance / item ownership).
 */
function applyTreasuryDonation(treasury, donorChar, donation, rules) {
    if (!donorChar)
        return { ok: false, status: 404, error: 'Donor save not found.' };
    const prevTreasury = (treasury ?? {});
    const nextTreasury = { ...prevTreasury };
    const nextDonorChar = { ...donorChar };
    if (donation.kind === 'currency') {
        const { currency } = donation;
        if (!rules.allowedCurrencies.includes(currency)) {
            return { ok: false, status: 400, error: `Unsupported currency: ${currency}` };
        }
        if (!Number.isFinite(donation.amount) || donation.amount < 1) {
            return { ok: false, status: 400, error: 'amount must be at least 1.' };
        }
        const amount = Math.floor(donation.amount);
        const cap = rules.currencyCaps[currency] ?? 0;
        if (amount > cap) {
            return { ok: false, status: 400, error: `amount exceeds per-call cap of ${cap}.` };
        }
        const balance = num(donorChar[currency]);
        if (balance < amount) {
            return { ok: false, status: 400, error: `Insufficient ${currency} (have ${balance}, need ${amount}).` };
        }
        nextDonorChar[currency] = balance - amount;
        nextTreasury[currency] = num(prevTreasury[currency]) + amount;
        return { ok: true, nextDonorChar, nextTreasury };
    }
    // item donation
    const { itemId } = donation;
    if (!itemId || typeof itemId !== 'string') {
        return { ok: false, status: 400, error: 'Missing itemId.' };
    }
    if (!Number.isFinite(donation.count) || donation.count < 1) {
        return { ok: false, status: 400, error: 'count must be at least 1.' };
    }
    const count = Math.floor(donation.count);
    if (count > rules.itemCountCap) {
        return { ok: false, status: 400, error: `count exceeds per-call cap of ${rules.itemCountCap}.` };
    }
    const owned = countOwned(donorChar.inventory, itemId);
    if (owned < count) {
        return { ok: false, status: 400, error: `You do not own ${count} of that item (have ${owned}).` };
    }
    nextDonorChar.inventory = removeFromInventory(donorChar.inventory, itemId, count);
    nextTreasury.items = cleanTreasuryItems([...(Array.isArray(prevTreasury.items) ? prevTreasury.items : []), { itemId, count }]);
    return { ok: true, nextDonorChar, nextTreasury };
}
