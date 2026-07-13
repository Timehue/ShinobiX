/*
 * Clan XP on war settle — shared by both war-ending endpoints
 * (api/clan/war/report.ts's two-phase report + api/clan/war/tilecards.ts's
 * card-clash finalize), which both settle a war through applyFinalResult.
 *
 * A finished war feeds the winner + loser CLAN records XP toward hall-tier
 * growth (the leveling faucet). This is separate from the per-player Clan-Point
 * awards and lands on the shared clan record, not a personal save.
 */
import { kv } from '../../_storage.js';
import { withKvLock } from '../../_lock.js';
import { clanRecordKey, clanBareSlug } from '../../_utils.js';
import { addClanXpServer, scaledClanXp } from '../_mission-catalog.js';
import type { ClanWar } from './_storage.js';

const WAR_WIN_CLAN_XP = 1_200;
const WAR_LOSS_CLAN_XP = 400; // also the draw payout for both sides.
const WAR_XP_RECEIPT_TTL = 60 * 24 * 60 * 60;

// Credit a single clan's record. Member-scaled (10–15 members = 1.0×; small
// clans dampened, capped at 1.0×) so a tiny clan can't rush hall tiers.
// Idempotent via a per-clan NX receipt so a re-report / concurrent finalize
// can't double-credit.
async function creditWarClanXp(clanName: string, warId: string, amount: number): Promise<void> {
    const slug = clanBareSlug(clanName);
    if (!slug) return;
    const clanKey = clanRecordKey(clanName);
    const receiptKey = `clan-war-xp:${warId}:${slug}`;
    await withKvLock(clanKey, async () => {
        const claimed = await kv.set(receiptKey, '1', { nx: true, ex: WAR_XP_RECEIPT_TTL });
        if (claimed !== 'OK') return; // already credited for this war
        const rec = await kv.get<Record<string, unknown>>(clanKey);
        if (!rec) return;
        const memberCount = Array.isArray(rec.members) ? (rec.members as unknown[]).length : 0;
        const leveled = addClanXpServer(Number(rec.xp ?? 0) || 0, Number(rec.level ?? 1) || 1, scaledClanXp(amount, memberCount));
        await kv.set(clanKey, { ...rec, xp: leveled.xp, level: leveled.level });
    }, { failClosed: true });
}

// Award clan XP to both participants of an ENDED war: winner 1200, loser 400;
// a drawn war (no winnerClan) pays 400 to each. No-op until the war has ended
// (endedAt set). Safe to call more than once — the per-clan receipt makes it
// exactly-once. Best-effort by convention: callers should not fail their
// response on a rejection here (the war settle is already persisted).
export async function awardWarEndClanXp(war: ClanWar | null | undefined): Promise<void> {
    if (!war || !war.endedAt || !Array.isArray(war.clans)) return;
    const winner = war.winnerClan;
    for (const clanName of war.clans) {
        if (!clanName || !String(clanName).trim()) continue;
        const amount = winner ? (clanName === winner ? WAR_WIN_CLAN_XP : WAR_LOSS_CLAN_XP) : WAR_LOSS_CLAN_XP;
        await creditWarClanXp(clanName, war.id, amount);
    }
}
