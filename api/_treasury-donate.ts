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

export type TreasuryItemStack = { itemId: string; count: number };

export type TreasuryDonation =
    | { kind: 'currency'; currency: string; amount: number }
    | { kind: 'item'; itemId: string; count: number };

export type DonationRules = {
    /** Currencies a player is allowed to donate into this treasury. */
    allowedCurrencies: readonly string[];
    /** Hard per-call ceiling per currency. Bounds a single request's blast radius. */
    currencyCaps: Record<string, number>;
    /** Hard per-call ceiling on item count. */
    itemCountCap: number;
};

export type DonationOutcome =
    | { ok: true; nextDonorChar: Record<string, unknown>; nextTreasury: Record<string, unknown> }
    | { ok: false; status: number; error: string };

function num(v: unknown, fallback = 0): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

// Merge stacked treasury item entries, dropping empties — mirrors the client
// cleanTreasuryItems() in shinobij.client/src/lib/items.ts so the treasury we
// write back is the same shape the client renders.
export function cleanTreasuryItems(items: unknown): TreasuryItemStack[] {
    const counts = new Map<string, number>();
    if (Array.isArray(items)) {
        for (const raw of items) {
            const s = (raw ?? {}) as Record<string, unknown>;
            const id = typeof s.itemId === 'string' ? s.itemId : '';
            if (!id) continue;
            counts.set(id, (counts.get(id) ?? 0) + Math.max(0, Math.floor(num(s.count))));
        }
    }
    return [...counts.entries()]
        .filter(([, count]) => count > 0)
        .map(([itemId, count]) => ({ itemId, count }));
}

// Stackable bulk items live in donorChar.itemStacks ([{itemId,count}]); unique
// gear lives in donorChar.inventory (string[]). Ownership + removal must span
// BOTH stores (mirrors the client's lib/inventory helpers).
type ItemStack = { itemId: string; count: number };

function readStacks(donorChar: Record<string, unknown>): ItemStack[] {
    if (!Array.isArray(donorChar.itemStacks)) return [];
    return (donorChar.itemStacks as unknown[])
        .map((s) => ({
            itemId: String((s as Record<string, unknown>)?.itemId ?? ''),
            count: Math.max(0, Math.floor(Number((s as Record<string, unknown>)?.count ?? 0))),
        }))
        .filter((s) => s.itemId && s.count > 0);
}

function countOwned(donorChar: Record<string, unknown>, itemId: string): number {
    const inv = Array.isArray(donorChar.inventory) ? donorChar.inventory : [];
    let n = inv.filter((i) => i === itemId).length;
    for (const s of readStacks(donorChar)) if (s.itemId === itemId) n += s.count;
    return n;
}

// Remove `n` of itemId across both stores (counted stack first, then array).
// Returns the next inventory[] and itemStacks[] to write back on the donor.
function removeOwned(donorChar: Record<string, unknown>, itemId: string, n: number): { inventory: string[]; itemStacks: ItemStack[] } {
    let remaining = n;
    const nextStacks: ItemStack[] = [];
    for (const s of readStacks(donorChar)) {
        if (s.itemId === itemId && remaining > 0) {
            const take = Math.min(s.count, remaining);
            remaining -= take;
            if (s.count - take > 0) nextStacks.push({ itemId: s.itemId, count: s.count - take });
        } else {
            nextStacks.push(s);
        }
    }
    const inv = Array.isArray(donorChar.inventory) ? (donorChar.inventory as unknown[]).slice() : [];
    const nextInventory = inv.filter((i) => {
        if (i === itemId && remaining > 0) { remaining--; return false; }
        return true;
    }) as string[];
    return { inventory: nextInventory, itemStacks: nextStacks };
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
export function applyTreasuryDonation(
    treasury: Record<string, unknown> | null | undefined,
    donorChar: Record<string, unknown> | null | undefined,
    donation: TreasuryDonation,
    rules: DonationRules,
): DonationOutcome {
    if (!donorChar) return { ok: false, status: 404, error: 'Donor save not found.' };

    const prevTreasury = (treasury ?? {}) as Record<string, unknown>;
    const nextTreasury: Record<string, unknown> = { ...prevTreasury };
    const nextDonorChar: Record<string, unknown> = { ...donorChar };

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
    const owned = countOwned(donorChar, itemId);
    if (owned < count) {
        return { ok: false, status: 400, error: `You do not own ${count} of that item (have ${owned}).` };
    }
    const removed = removeOwned(donorChar, itemId, count);
    nextDonorChar.inventory = removed.inventory;
    nextDonorChar.itemStacks = removed.itemStacks;
    nextTreasury.items = cleanTreasuryItems([...(Array.isArray(prevTreasury.items) ? prevTreasury.items : []), { itemId, count }]);
    return { ok: true, nextDonorChar, nextTreasury };
}
