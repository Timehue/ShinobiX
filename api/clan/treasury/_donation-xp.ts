import { kv } from '../../_storage.js';
import { SaveDebitRefusal } from '../../_save-debit-saga.js';
import { inspectSettlementReceipt } from '../../_settlement-receipts.js';

export const CLAN_DONATION_XP_DAILY_CAP = 2_000;
export type ClanDonationXpQuota = { day: string; used: number };

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const dayStamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;

function needsReview(): never {
    throw new SaveDebitRefusal(409, 'Your daily clan donation XP history needs review. No resources were taken.', { review: true });
}

/**
 * Called only for a fresh donation, under the donor save lock. The caller
 * commits the returned quota WITH the debit and its sealed settlement plan.
 * Pending credits therefore consume their admission day's quota immediately;
 * retries and admin reconciliation use that plan without reserving again.
 */
export async function reserveClanDonationXp(
    character: Record<string, unknown>, playerName: string, requested: number, now: number,
): Promise<{ clanXp: number; quota: ClanDonationXpQuota }> {
    const day = new Date(now).toISOString().slice(0, 10);
    const stored = character.clanDonationXp;
    let used: number;
    if (stored !== undefined) {
        if (!object(stored) || !dayStamp(stored.day) || !count(stored.used) || stored.day > day) needsReview();
        if (stored.day === day) {
            used = stored.used;
            const clanXp = Math.min(requested, Math.max(0, CLAN_DONATION_XP_DAILY_CAP - used));
            return { clanXp, quota: { day, used: used + clanXp } };
        }
    }

    // FIRST-ROLLOUT CONTRACT: this correction must ship with the newly added
    // cap, before its old post-credit-counter implementation reaches players.
    // Earlier uncapped donations do not retroactively consume the new budget.
    // This is initialization, not a reconstruction from rolling receipt lists:
    // even a short list may have lost receipts through eviction and refunds.
    const legacy = await kv.get<unknown>(`clan-donate-xp:${playerName}:${day}`);
    if (legacy !== null) {
        // Unexpected partial rollout: a saturated counter proves no new XP is
        // available. Anything below the cap cannot account for pending credits
        // or lost counter writes, so hold new admission explicitly for review.
        if (!count(legacy) || legacy < CLAN_DONATION_XP_DAILY_CAP) needsReview();
        used = legacy;
    } else {
        const inspection = inspectSettlementReceipt(character, '', '');
        if (inspection.status === 'invalid') needsReview();
        for (const receipt of inspection.receipts) {
            if (receipt.value.kind !== 'clan-treasury-donate') continue;
            const plan = receipt.value.plan;
            if (!object(plan) || plan.clanXpDay === undefined) continue; // pre-cap plan
            if (!dayStamp(plan.clanXpDay)) {
                if (receipt.settledAt >= Date.parse(`${day}T00:00:00.000Z`)) needsReview();
                continue;
            }
            // This protocol co-writes the quota with every capped debit. A
            // current-day receipt without it is an invariant failure, not an
            // empty budget. An older day's pending credit keeps its own day.
            if (plan.clanXpDay >= day) needsReview();
        }
        used = 0;
    }
    const clanXp = Math.min(requested, Math.max(0, CLAN_DONATION_XP_DAILY_CAP - used));
    return { clanXp, quota: { day, used: used + clanXp } };
}
