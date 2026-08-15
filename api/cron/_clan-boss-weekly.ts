/*
 * Weekly Clan Boss Gauntlet — cron pass (runs on the daily 03:00 UTC scheduler).
 *
 * Two idempotent jobs each tick:
 *   (a) ensure the CURRENT week has a live boss (spawn + announce once, NX-guarded);
 *   (b) settle any ENDED-but-unsettled week: rank every clan by the composite score,
 *       reward the top 3 (+ a participation payout for other clans that killed their
 *       boss) into the clan TREASURY, archive the standings, announce the winner.
 *
 * Default on and a no-op under the canonical Clan Boss kill switch. Rewards are exactly-once (receipt claimed
 * INSIDE the clan-save lock, so a contended credit is retried, never lost).
 */
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { announce } from '../_announce.js';
import { addClanXpServer, scaledClanXp } from '../clan/_mission-catalog.js';
import {
    CB_REWARDS, CB_PARTICIPATION_REWARD, CB_WEEK_MS, CLAN_BOSS_BY_ID,
    clanBossArchiveKey, clanBossDamageDealt, clanBossEngagedXp, clanBossMemberRewards, clanBossPickId,
    clanBossWeekId, clanBossWeekKey, clanSlug,
    rankClanBoss, type ClanBossProgress, type ClanBossWeek,
} from '../clan-boss/_storage.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { mergePreservingImages } from '../_utils.js';
import { clanBossEnabled } from '../_release-flags.js';

const ARCHIVE_TTL_SEC = 400 * 24 * 60 * 60;

export type ClanBossReward = { ryo: number; fateShards: number; boneCharms: number; clanXp: number };

/** Commit one week's reward and its receipt in the same clan-record mutation. */
export function applyClanBossRewardToRecord(
    rec: Record<string, unknown>,
    reward: ClanBossReward,
    weekId: string,
): { applied: boolean; record: Record<string, unknown> } {
    const receipts = Array.isArray(rec.clanBossRewardReceipts)
        ? (rec.clanBossRewardReceipts as unknown[]).filter((entry): entry is string => typeof entry === 'string')
        : [];
    if (receipts.includes(weekId)) return { applied: false, record: rec };

    const memberCount = Array.isArray(rec.members) ? (rec.members as unknown[]).length : 0;
    const leveled = addClanXpServer(Number(rec.xp ?? 0), Number(rec.level ?? 1), scaledClanXp(reward.clanXp, memberCount));
    const treasury = { ...(rec.treasury as Record<string, unknown> | undefined ?? {}) };
    treasury.ryo = Number(treasury.ryo ?? 0) + reward.ryo;
    treasury.fateShards = Number(treasury.fateShards ?? 0) + reward.fateShards;
    treasury.boneCharms = Number(treasury.boneCharms ?? 0) + reward.boneCharms;
    return {
        applied: true,
        record: {
            ...rec,
            xp: leveled.xp,
            level: leveled.level,
            treasury,
            clanBossRewardReceipts: [...receipts.slice(-127), weekId],
        },
    };
}

export async function runClanBossWeekly(now: number = Date.now()): Promise<{ enabled: boolean; spawned: string | null; settled: string[] }> {
    if (!clanBossEnabled()) return { enabled: false, spawned: null, settled: [] };
    const spawned = await ensureCurrentWeek(now);
    const settled = await settleEndedWeeks(now);
    return { enabled: true, spawned, settled };
}

async function ensureCurrentWeek(now: number): Promise<string | null> {
    const weekId = clanBossWeekId(now);
    if (await kv.get<ClanBossWeek>(clanBossWeekKey(weekId))) return null;
    const week: ClanBossWeek = { weekId, bossId: clanBossPickId(weekId), spawnedAt: now, endsAt: now + CB_WEEK_MS };
    const created = await kv.set(clanBossWeekKey(weekId), week, { nx: true });
    if (created !== 'OK') return null;  // another instance created it first
    const boss = CLAN_BOSS_BY_ID[week.bossId];
    await announce({
        type: 'clan-boss-spawn', importance: 'high',
        title: `${boss?.icon ?? '👹'} Weekly Clan Boss: ${boss?.name ?? 'A great foe'}`,
        message: 'A boss has risen against every clan. Rally a party of 3, bring it down, and compete — the top 3 clans earn treasury rewards when the week ends.',
    });
    return weekId;
}

async function settleEndedWeeks(now: number): Promise<string[]> {
    const keys = await kv.keys('clan-boss:week:*');
    const done: string[] = [];
    for (const k of keys) {
        const w = await kv.get<ClanBossWeek>(k);
        if (!w || w.settled || w.endsAt > now) continue;
        if (await settleWeek(w, now)) done.push(w.weekId);
    }
    return done;
}

async function settleWeek(week: ClanBossWeek, now: number): Promise<boolean> {
    return withKvLock(`clan-boss:settle:${week.weekId}`, async () => {
        const fresh = await kv.get<ClanBossWeek>(clanBossWeekKey(week.weekId));
        if (!fresh || fresh.settled) return false;

        const progressKeys = await kv.keys(`clan-boss:progress:${week.weekId}:*`);
        const progressList = (progressKeys.length ? await kv.mget<ClanBossProgress[]>(...progressKeys) : [])
            .filter(Boolean) as ClanBossProgress[];
        const ranked = rankClanBoss(progressList);
        // Per-clan damage, so clans that chipped the boss but finished off the
        // podium still earn XP-only "engaged" progress toward hall growth.
        const damageByClan = new Map(progressList.map((p) => [p.clanName, clanBossDamageDealt(p)]));

        for (const entry of ranked) {
            let reward: ClanBossReward | null;
            if (entry.rank <= 3) {
                reward = CB_REWARDS[entry.rank as 1 | 2 | 3];
            } else if (entry.killed) {
                reward = CB_PARTICIPATION_REWARD;
            } else {
                const engagedXp = clanBossEngagedXp(damageByClan.get(entry.clanName) ?? 0);
                reward = engagedXp > 0 ? { ryo: 0, fateShards: 0, boneCharms: 0, clanXp: engagedXp } : null;
            }
            if (reward && !(await creditClanTreasury(entry.clanName, reward, week.weekId))) {
                // Keep the week open for a retry. Previously credited clan records
                // replay safely because the receipt lives in the same blob.
                return false;
            }
        }

        // Personal payouts for every clan that fought, podium or not — the clan rewards
        // above are treasury-only and gave individual members nothing to show for a
        // week of assaults. Per-member receipts make a retry safe.
        for (const progress of progressList) {
            if (!(await creditMemberRewards(progress, week.weekId))) return false;
        }

        await kv.set(clanBossArchiveKey(week.weekId), {
            // Keep every clan's placement (small server) so each can see its own result.
            weekId: week.weekId, bossId: week.bossId, endedAt: now, standings: ranked.slice(0, 50),
        }, { ex: ARCHIVE_TTL_SEC });

        const winner = ranked.find(r => r.rank === 1 && r.killed) ?? ranked[0];
        if (winner) {
            await announce({
                type: 'clan-boss-results', importance: 'high',
                title: `🏆 Clan Boss Week Over — ${winner.clanName} takes #1!`,
                message: 'The clan boss week has ended and the top clans have been rewarded. A fresh boss appears now.',
            });
        }

        await kv.set(clanBossWeekKey(week.weekId), { ...fresh, settled: true });
        return true;
    }, { failClosed: true });
}

/**
 * Pay the PERSONAL side of the weekly boss: flat ryo to everyone who assaulted, plus
 * Fate Shards to the clan's top damage dealers.
 *
 * Every other clan-boss reward lands in the clan treasury, which left an individual
 * member with no reason to spend five wipe-by-design assaults a week. Not gated on the
 * kill — chipping is the intended contribution.
 *
 * Idempotent per member per week via a flag on the member's own save record, so a
 * settlement retry (any single failure keeps the week open) never double-pays. Returns
 * false if any member could not be credited, which keeps the week open for that retry.
 */
async function creditMemberRewards(progress: ClanBossProgress, weekId: string): Promise<boolean> {
    const rewards = clanBossMemberRewards(progress);
    for (const reward of rewards) {
        if (reward.ryo <= 0 && reward.fateShards <= 0) continue;
        const saveKey = `save:${reward.slug}`;
        const ok = await withKvLock(saveKey, async () => {
            const rec = await kv.get<Record<string, unknown>>(saveKey);
            const character = rec?.character as Record<string, unknown> | undefined;
            // A member who left the game (no save) is skipped, not retried forever.
            if (!rec || !character) return true;
            const claimed = Array.isArray(character.clanBossWeeksPaid)
                ? (character.clanBossWeeksPaid as unknown[]).filter((v): v is string => typeof v === 'string')
                : [];
            if (claimed.includes(weekId)) return true;
            const nextChar = {
                ...character,
                ryo: Math.max(0, Number(character.ryo) || 0) + reward.ryo,
                fateShards: Math.max(0, Number(character.fateShards) || 0) + reward.fateShards,
                // Keep the last few weeks only — this is a dedupe ledger, not history.
                clanBossWeeksPaid: [...claimed, weekId].slice(-8),
            };
            const versioned = bumpSaveVersion<Record<string, unknown>>({ ...rec, character: nextChar });
            await kv.set(saveKey, mergePreservingImages(versioned, rec));
            return true;
        }, { failClosed: true });
        if (!ok) return false;
    }
    return true;
}

async function creditClanTreasury(clanName: string, reward: ClanBossReward, weekId: string): Promise<boolean> {
    const clanKey = `save:clan-${clanSlug(clanName)}`;
    const receiptKey = `clan-boss-reward:${weekId}:${clanSlug(clanName)}`;
    return withKvLock(clanKey, async () => {
        // Honor receipts written by older deployments before using the embedded,
        // same-record receipt used by the current path.
        if (await kv.get(receiptKey)) return true;
        const rec = await kv.get<Record<string, unknown>>(clanKey);
        if (!rec) return false;
        // Member-scaled clan XP (10–15 members = 1.0×; small clans dampened,
        // capped) so a tiny clan can't rush hall tiers off the weekly boss.
        const applied = applyClanBossRewardToRecord(rec, reward, weekId);
        if (applied.applied) await kv.set(clanKey, applied.record);
        // Preserve the legacy marker for operational visibility. Correctness no
        // longer depends on this best-effort secondary write.
        await kv.set(receiptKey, '1', { ex: ARCHIVE_TTL_SEC }).catch(() => undefined);
        return true;
    }, { failClosed: true });
}
