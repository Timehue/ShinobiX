import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { buildActivitySpine, autoFocus, type ActivitySpineInput } from './_activity-spine.js';
import { publicCapabilities } from './_public-capabilities.js';
import { progressionHoldForCharacter } from '../_xp-engine.js';
import { activitySaveFacts, enrichActivityFacts } from './_activity-spine-facts.js';
import { normalizeMasteryFocus } from '../../shared/activity-spine.js';
import { isIncapacitated } from '../_elapsed-state.js';
import { activePartyForPlayer } from '../clan-boss/_party.js';
import { clanBossAttemptsLeft, clanBossWeekId, loadClanBossProgress, loadClanBossWeek, resolveClanBossDef } from '../clan-boss/_storage.js';
import { loadSectorState } from '../clan-boss/_sector-state.js';
import { discoverActivityTowerRecovery } from './_activity-spine-tower-recovery.js';

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
        const week = clanName ? await loadClanBossWeek(weekId) : null;
        const boss = resolveClanBossDef(week);
        const [progress, party, sector, towerRecovery] = await Promise.all([
            clanName && week ? loadClanBossProgress(weekId, clanName) : null,
            clanName ? activePartyForPlayer(playerName, false, true) : null,
            boss && week ? loadSectorState(weekId, boss) : null,
            discoverActivityTowerRecovery(playerName),
        ]);
        const activeTraining = record?.activeTraining as { endsAt?: number } | null | undefined;
        const activeJutsuTraining = record?.activeJutsuTraining as { endsAt?: number } | null | undefined;
        const level = Math.max(1, Math.floor(Number(character.level) || 1));
        const hollowRun = character.hollowGateRun && typeof character.hollowGateRun === 'object'
            ? character.hollowGateRun as Record<string, unknown>
            : null;
        const endlessRun = character.endlessTowerRun && typeof character.endlessTowerRun === 'object'
            ? character.endlessTowerRun as Record<string, unknown>
            : null;
        const input: ActivitySpineInput = {
            capabilities: publicCapabilities(),
            now,
            level,
            hospitalized: isIncapacitated(character, now),
            onboardingStep: typeof character.onboardingStep === 'string' ? character.onboardingStep : '',
            unspentStats: Math.max(0, Math.floor(Number(character.statPoints ?? character.unspentStats) || 0)),
            trainingIdle: !activeTraining,
            statTrainingReady: !!activeTraining && Number(activeTraining.endsAt ?? 0) > 0 && Number(activeTraining.endsAt) <= now,
            jutsuTrainingIdle: !activeJutsuTraining || Number(activeJutsuTraining.endsAt ?? 0) <= now,
            hasJutsu: Array.isArray(character.jutsuMastery)
                ? character.jutsuMastery.length > 0
                : Array.isArray(character.equippedJutsuIds) && character.equippedJutsuIds.length > 0,
            hasProfession: ['healer', 'vanguard', 'petTamer'].includes(String(character.profession ?? '')),
            profession: typeof character.profession === 'string' ? character.profession : '',
            clanName,
            lastLoginRewardDate: typeof character.lastLoginRewardDate === 'string' ? character.lastLoginRewardDate : '',
            focus: req.query.focus ?? character.masteryFocus,
            progressionHold: progressionHoldForCharacter(character),
            resume: towerRecovery ?? (hollowRun && hollowRun.completed !== true
                ? { title: 'Resume your Hollow Gate run', screen: 'hollowGateShrine', runtimeModeId: 'hollow-gate-shinobi' }
                : endlessRun
                    ? { title: 'Resume your Endless Tower run', screen: 'endlessTower', context: 'towers', runtimeModeId: 'endless' }
                    : null),
            clanBoss: {
                active: !!week && week.endsAt > now && !!boss,
                killed: !!progress?.killedAt,
                attemptsLeft: clanBossAttemptsLeft(progress, playerName),
                partyStatus: party?.status,
                pressure: sector?.pressure,
                sectorName: sector?.sectorName,
            },
        };
        const selected = normalizeMasteryFocus(input.focus);
        const facts = activitySaveFacts(character, now);
        input.facts = await enrichActivityFacts(facts, character, playerName,
            selected === 'auto' ? autoFocus(input, facts) : selected, kv, now);
        const spine = buildActivitySpine(input);
        res.setHeader('Cache-Control', 'private, no-store');
        return res.status(200).json({ ok: true, spine });
    } catch (error) {
        console.error('[player/activity-spine]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
