"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runClanBossWeekly = runClanBossWeekly;
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
const _storage_js_1 = require("../_storage.js");
const _lock_js_1 = require("../_lock.js");
const _announce_js_1 = require("../_announce.js");
const _mission_catalog_js_1 = require("../clan/_mission-catalog.js");
const _storage_js_2 = require("../clan-boss/_storage.js");
const ARCHIVE_TTL_SEC = 400 * 24 * 60 * 60;
async function runClanBossWeekly(now = Date.now()) {
    if (process.env.ENABLE_CLAN_BOSS !== '1')
        return { enabled: false, spawned: null, settled: [] };
    const spawned = await ensureCurrentWeek(now);
    const settled = await settleEndedWeeks(now);
    return { enabled: true, spawned, settled };
}
async function ensureCurrentWeek(now) {
    const weekId = (0, _storage_js_2.clanBossWeekId)(now);
    if (await _storage_js_1.kv.get((0, _storage_js_2.clanBossWeekKey)(weekId)))
        return null;
    const week = { weekId, bossId: (0, _storage_js_2.clanBossPickId)(weekId), spawnedAt: now, endsAt: now + _storage_js_2.CB_WEEK_MS };
    const created = await _storage_js_1.kv.set((0, _storage_js_2.clanBossWeekKey)(weekId), week, { nx: true });
    if (created !== 'OK')
        return null; // another instance created it first
    const boss = _storage_js_2.CLAN_BOSS_BY_ID[week.bossId];
    await (0, _announce_js_1.announce)({
        type: 'clan-boss-spawn', importance: 'high',
        title: `${boss?.icon ?? '👹'} Weekly Clan Boss: ${boss?.name ?? 'A great foe'}`,
        message: 'A boss has risen against every clan. Rally a party of 3, bring it down, and compete — the top 3 clans earn treasury rewards when the week ends.',
    });
    return weekId;
}
async function settleEndedWeeks(now) {
    const keys = await _storage_js_1.kv.keys('clan-boss:week:*');
    const done = [];
    for (const k of keys) {
        const w = await _storage_js_1.kv.get(k);
        if (!w || w.settled || w.endsAt > now)
            continue;
        if (await settleWeek(w, now))
            done.push(w.weekId);
    }
    return done;
}
async function settleWeek(week, now) {
    return (0, _lock_js_1.withKvLock)(`clan-boss:settle:${week.weekId}`, async () => {
        const fresh = await _storage_js_1.kv.get((0, _storage_js_2.clanBossWeekKey)(week.weekId));
        if (!fresh || fresh.settled)
            return false;
        const progressKeys = await _storage_js_1.kv.keys(`clan-boss:progress:${week.weekId}:*`);
        const progressList = (progressKeys.length ? await _storage_js_1.kv.mget(...progressKeys) : [])
            .filter(Boolean);
        const ranked = (0, _storage_js_2.rankClanBoss)(progressList);
        for (const entry of ranked) {
            const reward = entry.rank <= 3
                ? _storage_js_2.CB_REWARDS[entry.rank]
                : (entry.killed ? _storage_js_2.CB_PARTICIPATION_REWARD : null);
            if (reward)
                await creditClanTreasury(entry.clanName, reward, week.weekId);
        }
        await _storage_js_1.kv.set((0, _storage_js_2.clanBossArchiveKey)(week.weekId), {
            // Keep every clan's placement (small server) so each can see its own result.
            weekId: week.weekId, bossId: week.bossId, endedAt: now, standings: ranked.slice(0, 50),
        }, { ex: ARCHIVE_TTL_SEC });
        const winner = ranked.find(r => r.rank === 1 && r.killed) ?? ranked[0];
        if (winner) {
            await (0, _announce_js_1.announce)({
                type: 'clan-boss-results', importance: 'high',
                title: `🏆 Clan Boss Week Over — ${winner.clanName} takes #1!`,
                message: 'The clan boss week has ended and the top clans have been rewarded. A fresh boss appears now.',
            });
        }
        await _storage_js_1.kv.set((0, _storage_js_2.clanBossWeekKey)(week.weekId), { ...fresh, settled: true });
        return true;
    }, { failClosed: true });
}
async function creditClanTreasury(clanName, reward, weekId) {
    const clanKey = `save:clan-${(0, _storage_js_2.clanSlug)(clanName)}`;
    const receiptKey = `clan-boss-reward:${weekId}:${(0, _storage_js_2.clanSlug)(clanName)}`;
    await (0, _lock_js_1.withKvLock)(clanKey, async () => {
        // Claim the once-only receipt INSIDE the lock, so a contended/failed credit
        // is retried on the next cron tick rather than silently lost.
        const claimed = await _storage_js_1.kv.set(receiptKey, '1', { nx: true, ex: ARCHIVE_TTL_SEC });
        if (claimed !== 'OK')
            return;
        const rec = await _storage_js_1.kv.get(clanKey);
        if (!rec)
            return;
        const leveled = (0, _mission_catalog_js_1.addClanXpServer)(Number(rec.xp ?? 0), Number(rec.level ?? 1), reward.clanXp);
        const treasury = { ...(rec.treasury ?? {}) };
        treasury.ryo = Number(treasury.ryo ?? 0) + reward.ryo;
        treasury.fateShards = Number(treasury.fateShards ?? 0) + reward.fateShards;
        treasury.boneCharms = Number(treasury.boneCharms ?? 0) + reward.boneCharms;
        await _storage_js_1.kv.set(clanKey, { ...rec, xp: leveled.xp, level: leveled.level, treasury });
    }, { failClosed: true });
}
