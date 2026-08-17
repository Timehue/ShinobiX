/*
 * Clan XP on war settle — shared by both war-ending endpoints
 * (api/clan/war/report.ts's two-phase report + api/clan/war/tilecards.ts's
 * card-clash finalize), which both settle a war through applyFinalResult.
 *
 * A finished war feeds the winner + loser CLAN records XP toward hall-tier
 * growth (the leveling faucet). This is separate from the per-player Clan-Point
 * awards and lands on the shared clan record, not a personal save.
 */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
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

type PvpWarXpReceipt = { fingerprint: string; settledAt: number };
const PVP_WAR_XP_RECEIPT_LIMIT = 2_048;
const PVP_WAR_XP_RETENTION_MS = 60 * 24 * 60 * 60 * 1_000;

function pvpWarXpReceipts(record: Record<string, unknown>): Record<string, PvpWarXpReceipt> {
    const raw = record.pvpWarXpReceipts;
    if (raw === undefined) return {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('pvp-clan-war-xp-ledger-invalid');
    const out: Record<string, PvpWarXpReceipt> = {};
    for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
        if (!/^[a-f0-9]{64}$/.test(id) || !entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new Error('pvp-clan-war-xp-ledger-invalid');
        }
        const receipt = entry as Partial<PvpWarXpReceipt>;
        if (typeof receipt.fingerprint !== 'string'
            || !Number.isSafeInteger(receipt.settledAt)
            || Number(receipt.settledAt) <= 0) throw new Error('pvp-clan-war-xp-ledger-invalid');
        out[id] = receipt as PvpWarXpReceipt;
    }
    return out;
}

/** PvP variant: clan XP and its battle proof land in one exact clan-row CAS. */
export async function awardPvpWarEndClanXp(
    war: ClanWar | null | undefined,
    battleId: string,
    eventAt: number,
): Promise<void> {
    if (!war || !war.endedAt || !Array.isArray(war.clans)) return;
    if (!battleId || !Number.isSafeInteger(eventAt) || eventAt <= 0) {
        throw new Error('pvp-clan-war-xp-input-invalid');
    }
    const receiptId = createHash('sha256').update(battleId).digest('hex');
    for (const clanName of war.clans) {
        const slug = clanBareSlug(clanName);
        if (!slug) throw new Error('pvp-clan-war-xp-clan-invalid');
        const clanKey = clanRecordKey(clanName);
        const amount = war.winnerClan === clanName ? WAR_WIN_CLAN_XP : WAR_LOSS_CLAN_XP;
        const fingerprint = `${war.id}:${slug}:${amount}`;
        await withKvLock(clanKey, async () => {
            for (let attempt = 0; attempt < 12; attempt += 1) {
                const current = await kv.get<Record<string, unknown>>(clanKey);
                if (!current) throw new Error(`pvp-clan-war-xp-row-missing:${slug}`);
                const receipts = pvpWarXpReceipts(current);
                const prior = receipts[receiptId];
                if (prior) {
                    if (prior.fingerprint !== fingerprint) throw new Error('pvp-clan-war-xp-fingerprint-conflict');
                    return;
                }
                const retained = Object.fromEntries(Object.entries(receipts).filter(([, receipt]) => (
                    receipt.settledAt >= eventAt - PVP_WAR_XP_RETENTION_MS
                )));
                if (Object.keys(retained).length >= PVP_WAR_XP_RECEIPT_LIMIT) {
                    throw new Error('pvp-clan-war-xp-ledger-full');
                }
                const memberCount = Array.isArray(current.members) ? current.members.length : 0;
                const leveled = addClanXpServer(
                    Number(current.xp ?? 0) || 0,
                    Number(current.level ?? 1) || 1,
                    scaledClanXp(amount, memberCount),
                );
                const candidate = {
                    ...current,
                    xp: leveled.xp,
                    level: leveled.level,
                    pvpWarXpReceipts: {
                        ...retained,
                        [receiptId]: { fingerprint, settledAt: eventAt },
                    },
                };
                try {
                    if (await kv.compareSet(clanKey, current, candidate)) return;
                } catch (error) {
                    const recovered = await kv.get<unknown>(clanKey).catch(() => null);
                    if (isDeepStrictEqual(recovered, candidate)) return;
                    throw error;
                }
            }
            throw new Error('pvp-clan-war-xp-contended');
        }, { failClosed: true });
    }
}
