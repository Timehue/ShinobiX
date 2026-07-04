/*
 * Weekly Clan Boss Gauntlet — cron pass (runs on the daily 03:00 UTC scheduler).
 *
 * Two idempotent jobs each tick:
 *   (a) ensure the CURRENT week has a live boss (spawn + announce once, NX-guarded);
 *   (b) settle any ENDED-but-unsettled week: rank every clan by the composite score,
 *       reward the top 3 (+ a participation payout for other clans that killed their
 *       boss) into the clan TREASURY, archive the standings, announce the winner.
 *
 * No-op unless ENABLE_CLAN_BOSS==='1'. Rewards are exactly-once (receipt claimed
 * INSIDE the clan-save lock, so a contended credit is retried, never lost).
 */
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { announce } from '../_announce.js';
import { addClanXpServer } from '../clan/_mission-catalog.js';
import {
    CB_REWARDS, CB_PARTICIPATION_REWARD, CB_WEEK_MS, CLAN_BOSS_BY_ID,
    clanBossArchiveKey, clanBossPickId, clanBossWeekId, clanBossWeekKey, clanSlug,
    rankClanBoss, type ClanBossProgress, type ClanBossWeek,
} from '../clan-boss/_storage.js';

const ARCHIVE_TTL_SEC = 400 * 24 * 60 * 60;

type Reward = { ryo: number; fateShards: number; boneCharms: number; clanXp: number };

export async function runClanBossWeekly(now: number = Date.now()): Promise<{ enabled: boolean; spawned: string | null; settled: string[] }> {
    if (process.env.ENABLE_CLAN_BOSS !== '1') return { enabled: false, spawned: null, settled: [] };
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

        for (const entry of ranked) {
            const reward: Reward | null = entry.rank <= 3
                ? CB_REWARDS[entry.rank as 1 | 2 | 3]
                : (entry.killed ? CB_PARTICIPATION_REWARD : null);
            if (reward) await creditClanTreasury(entry.clanName, reward, week.weekId);
        }

        await kv.set(clanBossArchiveKey(week.weekId), {
            weekId: week.weekId, bossId: week.bossId, endedAt: now, standings: ranked.slice(0, 10),
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

async function creditClanTreasury(clanName: string, reward: Reward, weekId: string): Promise<void> {
    const clanKey = `save:clan-${clanSlug(clanName)}`;
    const receiptKey = `clan-boss-reward:${weekId}:${clanSlug(clanName)}`;
    await withKvLock(clanKey, async () => {
        // Claim the once-only receipt INSIDE the lock, so a contended/failed credit
        // is retried on the next cron tick rather than silently lost.
        const claimed = await kv.set(receiptKey, '1', { nx: true, ex: ARCHIVE_TTL_SEC });
        if (claimed !== 'OK') return;
        const rec = await kv.get<Record<string, unknown>>(clanKey);
        if (!rec) return;
        const leveled = addClanXpServer(Number(rec.xp ?? 0), Number(rec.level ?? 1), reward.clanXp);
        const treasury = { ...(rec.treasury as Record<string, unknown> | undefined ?? {}) };
        treasury.ryo = Number(treasury.ryo ?? 0) + reward.ryo;
        treasury.fateShards = Number(treasury.fateShards ?? 0) + reward.fateShards;
        treasury.boneCharms = Number(treasury.boneCharms ?? 0) + reward.boneCharms;
        await kv.set(clanKey, { ...rec, xp: leveled.xp, level: leveled.level, treasury });
    }, { failClosed: true });
}
