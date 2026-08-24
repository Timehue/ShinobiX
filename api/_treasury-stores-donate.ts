// Village Stores routing for the atomic treasury-donation endpoints
// (api/village/treasury/donate.ts + api/clan/treasury/donate.ts). Pure.
//
// applyTreasuryDonation already verified ownership and moved the stack into
// `nextTreasury.items`. This re-routes a ration-pack (→ provisions) or a
// CRAFT_POINTS material / relic (→ materialPoints) OUT of the loose item list
// and into the store, enforces the donor's UTC-day caps, and reports the
// ryo-equivalent used for meritForDonation. Anything else is left untouched.

import type { DonationOutcome, TreasuryDonation } from './_treasury-donate.js';
import { cleanTreasuryItems } from './_treasury-donate.js';
import {
    CRAFT_POINT_RYO_VALUE, DAILY_CRAFT_POINT_DONATION_CAP, DAILY_RATION_DONATION_CAP,
    DONATE_DATE_FIELD, DONATE_POINTS_FIELD, DONATE_RATIONS_FIELD, RATION_RYO_VALUE,
    dailyCounter, stampDailyCounter, storesDonationRouting, utcDay,
} from './_village-stores.js';

export interface StoresRouted {
    store: 'provisions' | 'materialPoints';
    /** Units credited to the store (rations, or craft points). */
    amount: number;
    ryoValue: number;
    stores: { provisions: number; materialPoints: number };
    dailyUsed: number;
    dailyCap: number;
}
export type StoresRouteResult =
    | { ok: true; routed: StoresRouted | null; nextDonorChar: Record<string, unknown>; nextTreasury: Record<string, unknown> }
    | { ok: false; status: number; error: string };

function nonNeg(v: unknown): number {
    const n = Math.floor(Number(v) || 0);
    return n > 0 ? n : 0;
}

export function routeStoresDonation(
    prevTreasury: Record<string, unknown> | null | undefined,
    outcome: Extract<DonationOutcome, { ok: true }>,
    donation: TreasuryDonation,
    craftPoints: Readonly<Record<string, number>>,
    opts: { materialPoints: boolean; now?: number },
): StoresRouteResult {
    if (donation.kind !== 'item') return { ok: true, routed: null, nextDonorChar: outcome.nextDonorChar, nextTreasury: outcome.nextTreasury };
    const route = storesDonationRouting(donation.itemId, donation.count, craftPoints);
    if (!route || (route.store === 'materialPoints' && !opts.materialPoints)) {
        return { ok: true, routed: null, nextDonorChar: outcome.nextDonorChar, nextTreasury: outcome.nextTreasury };
    }
    const today = utcDay(opts.now ?? Date.now());
    const donor = outcome.nextDonorChar;
    const countField = route.store === 'provisions' ? DONATE_RATIONS_FIELD : DONATE_POINTS_FIELD;
    const cap = route.store === 'provisions' ? DAILY_RATION_DONATION_CAP : DAILY_CRAFT_POINT_DONATION_CAP;
    const used = dailyCounter(donor, DONATE_DATE_FIELD, countField, today);
    if (used + route.amount > cap) {
        // Player-facing unit. The two canonical names are PROVISIONS (rations)
        // and MATERIALS (materials) — never "craft points", whatever the
        // internal field is called.
        const unit = route.store === 'provisions' ? 'rations' : 'materials';
        return { ok: false, status: 429, error: `Daily donation limit: ${used}/${cap} ${unit} today; this would add ${route.amount}.` };
    }
    // Take the stack back OUT of the loose items (restore the previous item list).
    const prevItems = cleanTreasuryItems(Array.isArray(prevTreasury?.items) ? prevTreasury!.items : []);
    const prev = (prevTreasury ?? {}) as Record<string, unknown>;
    const stores = {
        provisions: nonNeg(prev.provisions) + (route.store === 'provisions' ? route.amount : 0),
        materialPoints: nonNeg(prev.materialPoints) + (route.store === 'materialPoints' ? route.amount : 0),
    };
    const nextTreasury = { ...outcome.nextTreasury, items: prevItems, provisions: stores.provisions, materialPoints: stores.materialPoints };
    // Both counters share one date stamp; re-stamping to today keeps the other
    // counter only if it was already today's (dailyCounter reads 0 otherwise).
    const otherField = route.store === 'provisions' ? DONATE_POINTS_FIELD : DONATE_RATIONS_FIELD;
    const otherUsed = dailyCounter(donor, DONATE_DATE_FIELD, otherField, today);
    let nextDonor = stampDailyCounter({ ...donor, [otherField]: otherUsed }, DONATE_DATE_FIELD, countField, today, used + route.amount);
    nextDonor = { ...nextDonor, [otherField]: otherUsed };
    const ryoValue = route.store === 'provisions' ? route.amount * RATION_RYO_VALUE : route.amount * CRAFT_POINT_RYO_VALUE;
    return {
        ok: true,
        routed: { store: route.store, amount: route.amount, ryoValue, stores, dailyUsed: used + route.amount, dailyCap: cap },
        nextDonorChar: nextDonor,
        nextTreasury,
    };
}
