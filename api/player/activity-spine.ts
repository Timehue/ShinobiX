import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { buildActivitySpine } from './_activity-spine.js';
import { activePartyForPlayer } from '../clan-boss/_party.js';
import { clanBossAttemptsLeft, clanBossWeekId, loadClanBossProgress, loadClanBossWeek, resolveClanBossDef } from '../clan-boss/_storage.js';
import { loadSectorState } from '../clan-boss/_sector-state.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    try {
        const playerName = safeName(String(req.query.player ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing player.' });
        if (!enforceRateLimit(req, res, 'activity-spine', 45, 60_000, playerName)) return;
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only view your own activity spine.' });
        const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const character = record?.character as Record<string, unknown> | undefined;
        if (!character) return res.status(404).json({ error: 'Character not found.' });
        const now = Date.now();
        const clanName = typeof character.clan === 'string' ? character.clan : '';
        const weekId = clanBossWeekId(now);
        const week = await loadClanBossWeek(weekId);
        const boss = resolveClanBossDef(week);
        const progress = clanName && week ? await loadClanBossProgress(weekId, clanName) : null;
        const party = clanName ? await activePartyForPlayer(playerName) : null;
        const sector = boss && week ? await loadSectorState(weekId, boss) : null;
        const activeTraining = record.activeTraining as { endsAt?: number } | null | undefined;
        const activeJutsuTraining = record.activeJutsuTraining as { endsAt?: number } | null | undefined;
        const spine = buildActivitySpine({
            now,
            level: Math.max(1, Math.floor(Number(character.level) || 1)),
            hospitalized: character.hospitalized === true,
            onboardingStep: typeof character.onboardingStep === 'string' ? character.onboardingStep : '',
            unspentStats: Math.max(0, Math.floor(Number(character.statPoints ?? character.unspentStats) || 0)),
            trainingIdle: !activeTraining || Number(activeTraining.endsAt ?? 0) <= now,
            jutsuTrainingIdle: !activeJutsuTraining || Number(activeJutsuTraining.endsAt ?? 0) <= now,
            hasJutsu: Array.isArray(character.jutsuMastery)
                ? character.jutsuMastery.length > 0
                : Array.isArray(character.equippedJutsuIds) && character.equippedJutsuIds.length > 0,
            hasProfession: ['healer', 'vanguard', 'petTamer'].includes(String(character.profession ?? '')),
            clanName,
            lastLoginRewardDate: typeof character.lastLoginRewardDate === 'string' ? character.lastLoginRewardDate : '',
            clanBoss: {
                active: !!week && week.endsAt > now && !!boss,
                killed: !!progress?.killedAt,
                attemptsLeft: progress ? clanBossAttemptsLeft(progress, playerName) : 5,
                partyStatus: party?.status,
                pressure: sector?.pressure,
                sectorName: sector?.sectorName,
            },
        });
        res.setHeader('Cache-Control', 'private, no-store');
        return res.status(200).json({ ok: true, spine });
    } catch (error) {
        console.error('[player/activity-spine]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
