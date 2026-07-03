import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { kv } from '../../_storage.js';
import { cors, safeName } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { withKvLock } from '../../_lock.js';
import {
    RAID_ATTEMPTS_PER_MEMBER, RAID_BOSS_BY_ID, clanSlug, loadRaid, newRaid, raidKey,
    raidLeaderboard, raidWeekId, saveRaid, type ClanRaid,
} from './_storage.js';

// Read the caller's clan's current-week raid (lazily creating it on first view),
// plus the caller's own attempts-left / damage / claim state. Gated off by
// default — 404 unless ENABLE_CLAN_RAID==='1'.
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (process.env.ENABLE_CLAN_RAID !== '1') return res.status(404).json({ error: 'Not found.' });
    if (req.method !== 'GET') return res.status(405).end();

    try {
        const playerName = safeName(String(req.query.player ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing player.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only view your own clan raid.' });
        }

        const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const char = (save?.character ?? null) as Record<string, unknown> | null;
        const clanName = char && typeof char.clan === 'string' ? char.clan : '';
        if (!clanName) return res.status(200).json({ ok: true, inClan: false });

        const clanRec = await kv.get<{ members?: Array<unknown> }>(`save:clan-${clanSlug(clanName)}`);
        if (!clanRec) return res.status(200).json({ ok: true, inClan: true, raid: null });
        const memberCount = Array.isArray(clanRec.members) ? clanRec.members.length : 1;

        const weekId = raidWeekId(Date.now());
        let raid = await loadRaid(clanName, weekId);
        if (!raid) {
            // First view this week seeds the boss. Lock so two concurrent first
            // views don't both create (deterministic inputs → identical record,
            // but the lock keeps members maps from racing).
            raid = await withKvLock(raidKey(clanName, weekId), async () => {
                const existing = await loadRaid(clanName, weekId);
                if (existing) return existing;
                const fresh = newRaid(clanName, weekId, memberCount, Date.now());
                await saveRaid(fresh);
                return fresh;
            });
        }

        return res.status(200).json({ ok: true, inClan: true, raid: publicView(raid, playerName) });
    } catch (err) {
        console.error('[clan/raid/get]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

function publicView(raid: ClanRaid, viewer: string) {
    const boss = RAID_BOSS_BY_ID[raid.bossId] ?? { id: raid.bossId, name: 'Raid Boss', icon: '👹', flavor: '' };
    const mine = raid.members[viewer];
    const attemptsUsed = mine?.attemptsUsed ?? 0;
    return {
        weekId: raid.weekId,
        boss,
        hp: raid.hp,
        hpMax: raid.hpMax,
        killedAt: raid.killedAt ?? null,
        killedBy: raid.killedBy ?? null,
        memberCountAtStart: raid.memberCountAtStart,
        leaderboard: raidLeaderboard(raid),
        me: {
            attemptsUsed,
            attemptsLeft: Math.max(0, RAID_ATTEMPTS_PER_MEMBER - attemptsUsed),
            damage: mine?.damage ?? 0,
            claimed: mine?.claimed ?? false,
            canClaim: !!raid.killedAt && (mine?.damage ?? 0) > 0 && !(mine?.claimed ?? false),
        },
    };
}
