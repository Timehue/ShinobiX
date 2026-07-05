import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import {
    CB_ASSAULTS_PER_MEMBER, CB_WEEK_MS, clanBossArchiveKey, clanBossAttemptsLeft,
    clanBossDamageDealt, clanBossProgressKey, clanBossWeekId, clanSlug,
    loadClanBossProgress, loadClanBossWeek, newClanBossProgress, rankClanBoss, resolveClanBossDef,
    type ClanBossProgress,
} from './_storage.js';

/*
 * GET /api/clan-boss/get?player=<name> — the current weekly clan-boss event: the
 * boss, the caller's clan progress (shared pool + their attempts left), and the
 * live cross-clan standings. Read-only. 404 unless ENABLE_CLAN_BOSS==='1'.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (process.env.ENABLE_CLAN_BOSS !== '1') return res.status(404).json({ error: 'Not found.' });
    if (req.method !== 'GET') return res.status(405).end();
    try {
        const playerName = safeName(String(req.query.player ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing player.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only view as yourself.' });

        const now = Date.now();
        const weekId = clanBossWeekId(now);
        const week = await loadClanBossWeek(weekId);
        if (!week || week.endsAt <= now) return res.status(200).json({ ok: true, active: false });

        const boss = resolveClanBossDef(week);
        if (!boss) return res.status(500).json({ error: 'Clan boss data missing.' });

        // Live standings: scan every clan's progress for the week, rank by composite score.
        const progressKeys = await kv.keys(`clan-boss:progress:${weekId}:*`);
        const progressList = (progressKeys.length ? await kv.mget<ClanBossProgress[]>(...progressKeys) : [])
            .filter(Boolean) as ClanBossProgress[];
        const standings = rankClanBoss(progressList).slice(0, 12);

        const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const char = save?.character as Record<string, unknown> | undefined;
        const clanName = char && typeof char.clan === 'string' ? char.clan : '';

        let myClan: unknown = null;
        if (clanName) {
            let progress = await loadClanBossProgress(weekId, clanName);
            if (!progress) {
                const clanRec = await kv.get<{ members?: Array<unknown> }>(`save:clan-${clanSlug(clanName)}`);
                const memberCount = Array.isArray(clanRec?.members) ? clanRec!.members!.length : 1;
                progress = newClanBossProgress(clanName, week, memberCount);
            }
            const myRank = standings.find(s => clanSlug(s.clanName) === clanSlug(clanName));
            myClan = {
                clanName,
                pool: progress.pool,
                poolMax: progress.poolMax,
                killed: !!progress.killedAt,
                damageDealt: clanBossDamageDealt(progress),
                participants: progress.participants.length,
                attemptsPerMember: CB_ASSAULTS_PER_MEMBER,
                myAttemptsLeft: clanBossAttemptsLeft(progress, playerName),
                rank: myRank?.rank ?? null,
                score: myRank?.score ?? 0,
            };
        }

        // Last week's result for this clan (from the archive) — a "how'd we do" line.
        let lastWeek: unknown = null;
        if (clanName) {
            const prevWeekId = clanBossWeekId(now - CB_WEEK_MS);
            const archive = await kv.get<{ standings?: Array<{ clanName: string; score: number; killed: boolean; rank: number }> }>(clanBossArchiveKey(prevWeekId));
            const mine = archive?.standings?.find(s => clanSlug(s.clanName) === clanSlug(clanName));
            if (mine) lastWeek = { rank: mine.rank, score: mine.score, killed: mine.killed };
        }

        res.setHeader('Cache-Control', 'private, max-age=15');
        return res.status(200).json({
            ok: true, active: true,
            weekId, endsAt: week.endsAt,
            boss: { id: boss.id, name: boss.name, icon: boss.icon, flavor: boss.flavor, mechanic: boss.mechanic },
            inClan: !!clanName,
            myClan,
            standings,
            lastWeek,
        });
    } catch (err) {
        console.error('[clan-boss/get]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
