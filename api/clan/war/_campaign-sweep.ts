import { kv } from '../../_storage.js';
import { safeLogValue } from '../../_safe-log.js';
import { CLAN_WAR_KEY_PREFIX, isClanWarRowKey, type ClanWar } from './_storage.js';
import { reconcileClanWarCampaign } from './_campaign-reconcile.js';

/** Campaign rewards stop paying 60 days after the campaign's end (_campaign-rewards.ts). */
const PAYOUT_WINDOW_MS = 60 * 86_400_000;

export type ClanWarCampaignSweepResult = { scanned: number; reconciled: string[]; failures: string[] };

/*
 * Daily pass over clan-war campaigns whose clock has run out.
 *
 * A campaign's timeout close, its match and victory rewards, and the release of
 * its reservations all live in reconcileClanWarCampaign, and only a READ ran it
 * (the war list for participants, queue, declare, dissolve). A finished campaign
 * whose members never opened the Council Hall again was never closed, and once
 * 60 days passed its victory points and war-end clan XP could no longer be paid
 * at all. The reconcile is idempotent (receipts per match and per war end), so
 * running it here as well as on read pays nothing twice.
 */
export async function runClanWarCampaignSweep(now: number = Date.now()): Promise<ClanWarCampaignSweepResult> {
    const result: ClanWarCampaignSweepResult = { scanned: 0, reconciled: [], failures: [] };
    const keys = (await kv.keys(`${CLAN_WAR_KEY_PREFIX}*`)).filter(isClanWarRowKey);
    for (const key of keys) {
        result.scanned += 1;
        try {
            const war = await kv.get<ClanWar>(key);
            const endsAt = Number(war?.campaign?.endsAt);
            if (!war?.campaign || !Number.isFinite(endsAt) || now < endsAt || now > endsAt + PAYOUT_WINDOW_MS) continue;
            await reconcileClanWarCampaign(war.id, now);
            result.reconciled.push(war.id);
        } catch (err) {
            result.failures.push(`${key}: ${safeLogValue(err)}`);
        }
    }
    return result;
}
