import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { kv } from '../../_storage.js';
import { cors, safeName, mergePreservingImages } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { withKvLock } from '../../_lock.js';
import { bumpSaveVersion } from '../../save/_save-version.js';
import { addClanXpServer } from '../_mission-catalog.js';
import {
    RAID_KILL_CLAN_XP, RAID_KILL_TREASURY_RYO, RAID_TOP_CONTRIB_BONUS,
    clanSlug, loadRaid, raidPersonalReward, raidTopContributor, raidWeekId, saveRaid,
} from './_storage.js';

// Claim a member's one-time raid reward (only after the boss is defeated).
// Marks the member claimed BEFORE crediting (so a failed credit can never
// double-pay), then credits under separate, non-nested locks (player, then
// clan) in an order that can't deadlock against treasury/donate.
// Gated off by default — 404 unless ENABLE_CLAN_RAID==='1'.
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (process.env.ENABLE_CLAN_RAID !== '1') return res.status(404).json({ error: 'Not found.' });
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only claim your own reward.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'clan-raid-claim', 10, 60_000, identity.name))) return;

        const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const char = (save?.character ?? null) as Record<string, unknown> | null;
        if (!char) return res.status(404).json({ error: 'Character not found.' });
        const clanName = typeof char.clan === 'string' ? char.clan : '';
        if (!clanName) return res.status(400).json({ error: 'You must be in a clan to claim.' });
        const weekId = raidWeekId(Date.now());
        const raidLockKey = `clan-raid:${clanSlug(clanName)}:${weekId}`;

        // ── Phase 1: reserve the claim under the raid lock (mark-first) ──────────
        const reserve = await withKvLock(raidLockKey, async () => {
            const raid = await loadRaid(clanName, weekId);
            if (!raid) return { status: 404 as const, body: { error: 'No active raid.' } };
            if (!raid.killedAt) return { status: 400 as const, body: { error: 'The boss is not defeated yet.' } };
            const member = raid.members[playerName];
            if (!member || member.damage <= 0) return { status: 400 as const, body: { error: 'You did not damage this boss.' } };
            if (member.claimed) return { status: 400 as const, body: { error: 'You already claimed this raid.' } };

            const totalDamage = Object.values(raid.members).reduce((s, m) => s + Math.max(0, m.damage), 0);
            const isTop = raidTopContributor(raid) === playerName;
            const reward = raidPersonalReward(member.damage, totalDamage, true);
            const contrib = reward.contrib + (isTop ? RAID_TOP_CONTRIB_BONUS : 0);

            member.claimed = true;
            const clanRewardDue = !raid.clanRewardPaid;
            if (clanRewardDue) raid.clanRewardPaid = true;   // reserve the once-only clan payout
            raid.updatedAt = Date.now();
            await saveRaid(raid);

            return {
                status: 200 as const,
                body: {
                    ok: true, ryo: reward.ryo, contrib, isTop, clanRewardDue,
                    myDamage: member.damage, totalDamage,
                },
            };
        }, { failClosed: true });

        if (reserve.status !== 200) return res.status(reserve.status).json(reserve.body);
        const { ryo, contrib, clanRewardDue } = reserve.body as { ryo: number; contrib: number; clanRewardDue: boolean };

        // ── Phase 2: credit the player (ryo + contribution) ─────────────────────
        const playerKey = `save:${playerName}`;
        await withKvLock(playerKey, async () => {
            const rec = await kv.get<Record<string, unknown>>(playerKey);
            const c = rec?.character as Record<string, unknown> | undefined;
            if (!c) return;
            const updated = {
                ...rec,
                character: {
                    ...c,
                    ryo: Number(c.ryo ?? 0) + ryo,
                    clanEventContrib: Number(c.clanEventContrib ?? 0) + contrib,
                },
            };
            bumpSaveVersion(updated);
            await kv.set(playerKey, mergePreservingImages(updated, rec));
        }, { failClosed: true });

        // ── Phase 3: clan XP + treasury, paid once for the whole clan ───────────
        if (clanRewardDue) {
            const clanKey = `save:clan-${clanSlug(clanName)}`;
            await withKvLock(clanKey, async () => {
                const rec = await kv.get<Record<string, unknown>>(clanKey);
                if (!rec) return;
                const leveled = addClanXpServer(Number(rec.xp ?? 0), Number(rec.level ?? 1), RAID_KILL_CLAN_XP);
                const treasury = { ...(rec.treasury as Record<string, unknown> | undefined ?? {}) };
                treasury.ryo = Number(treasury.ryo ?? 0) + RAID_KILL_TREASURY_RYO;
                await kv.set(clanKey, { ...rec, xp: leveled.xp, level: leveled.level, treasury });
            }, { failClosed: true });
        }

        return res.status(200).json({
            ok: true,
            ryo,
            contrib,
            clanXp: clanRewardDue ? RAID_KILL_CLAN_XP : 0,
            treasuryRyo: clanRewardDue ? RAID_KILL_TREASURY_RYO : 0,
        });
    } catch (err) {
        console.error('[clan/raid/claim]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
