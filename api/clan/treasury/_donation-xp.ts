import { kv } from '../../_storage.js';
import { SaveDebitRefusal } from '../../_save-debit-saga.js';
import { inspectSettlementReceipt } from '../../_settlement-receipts.js';
import { clanPointWeekKey } from '../../_clan-points.js';

export const CLAN_DONATION_XP_DAILY_CAP = 2_000;
/**
 * Clan XP a donor's donations can add per ISO week, summed across EVERY kind:
 * ryo, the other currencies, items and scrolls (economy rebalance 2026-10, #39).
 * Before it, ryo bought clan levels at any speed and the non-ryo door allowed
 * 14,000 a week per member, so a clan could buy its way to the Citadel shelves
 * in weeks. The non-ryo daily cap above stays as the inner bound it always was.
 */
export const CLAN_DONATION_XP_WEEKLY_CAP = 2_000;
/** `day`/`used` are the non-ryo daily reservation; `week`/`weekUsed` the shared weekly one. */
export type ClanDonationXpQuota = { day?: string; used?: number; week?: string; weekUsed?: number };

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const dayStamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
const weekStamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(value);
const has = (row: Record<string, unknown>, field: string) => Object.prototype.hasOwnProperty.call(row, field);

function needsReview(): never {
    throw new SaveDebitRefusal(409, 'Your daily clan donation XP history needs review. No resources were taken.', { review: true });
}

/** The stored quota object, or undefined before the first capped donation. Anything else needs review. */
function storedQuota(character: Record<string, unknown>): Record<string, unknown> | undefined {
    const stored = character.clanDonationXp;
    if (stored === undefined) return undefined;
    if (!object(stored)) needsReview();
    return stored;
}

/**
 * This ISO week's already-reserved donation XP. A quota written before the
 * weekly budget existed has no week stamp and starts the week at 0: earlier
 * donations do not retroactively consume the new budget (the same first-rollout
 * contract as the daily cap). A malformed or future stamp needs review.
 */
function weeklyUsed(stored: Record<string, unknown> | undefined, week: string): number {
    if (!stored || (!has(stored, 'week') && !has(stored, 'weekUsed'))) return 0;
    if (!weekStamp(stored.week) || !count(stored.weekUsed) || stored.week > week) needsReview();
    return stored.week === week ? stored.weekUsed : 0;
}

/**
 * Ryo donations reserve from the weekly budget only (they never had a daily
 * cap: their gifts are taxed). The daily `day`/`used` fields are carried as
 * stored and never set by a ryo donation, so the non-ryo daily initialization
 * audit below keeps skipping ryo receipts. Called only for a fresh donation,
 * under the donor save lock; the caller commits the quota with the debit.
 */
export function reserveClanRyoDonationXp(
    character: Record<string, unknown>, requested: number, now: number,
): { clanXp: number; quota: ClanDonationXpQuota } {
    const week = clanPointWeekKey(new Date(now));
    const stored = storedQuota(character);
    const used = weeklyUsed(stored, week);
    const clanXp = Math.min(Math.max(0, Math.floor(requested)), Math.max(0, CLAN_DONATION_XP_WEEKLY_CAP - used));
    return { clanXp, quota: { ...(stored ?? {}), week, weekUsed: used + clanXp } };
}

/**
 * Called only for a fresh non-ryo donation, under the donor save lock. The
 * caller commits the returned quota WITH the debit and its sealed settlement
 * plan. Pending credits therefore consume their admission day's (and week's)
 * quota immediately; retries and admin reconciliation use that plan without
 * reserving again. The grant is the smaller of the daily and weekly headroom.
 */
export async function reserveClanDonationXp(
    character: Record<string, unknown>, playerName: string, requested: number, now: number,
): Promise<{ clanXp: number; quota: ClanDonationXpQuota }> {
    const day = new Date(now).toISOString().slice(0, 10);
    const week = clanPointWeekKey(new Date(now));
    const stored = storedQuota(character);
    const usedThisWeek = weeklyUsed(stored, week);
    const grant = (usedToday: number) => {
        const clanXp = Math.min(
            requested,
            Math.max(0, CLAN_DONATION_XP_DAILY_CAP - usedToday),
            Math.max(0, CLAN_DONATION_XP_WEEKLY_CAP - usedThisWeek),
        );
        return { clanXp, quota: { day, used: usedToday + clanXp, week, weekUsed: usedThisWeek + clanXp } };
    };
    // A quota a ryo donation wrote first carries only the weekly fields: no
    // daily reservation exists yet, so it initializes below like no quota at all.
    if (stored && (has(stored, 'day') || has(stored, 'used'))) {
        if (!dayStamp(stored.day) || !count(stored.used) || stored.day > day) needsReview();
        if (stored.day === day) return grant(stored.used);
    }

    // FIRST-ROLLOUT CONTRACT: this correction must ship with the newly added
    // cap, before its old post-credit-counter implementation reaches players.
    // Earlier uncapped donations do not retroactively consume the new budget.
    // This is initialization, not a reconstruction from rolling receipt lists:
    // even a short list may have lost receipts through eviction and refunds.
    let used: number;
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
            if (!object(plan) || plan.clanXpDay === undefined) continue; // pre-cap plan, or a ryo plan
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
    return grant(used);
}
