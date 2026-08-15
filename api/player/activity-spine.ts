import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { buildActivitySpine } from './_activity-spine.js';
import { publicCapabilities } from './_public-capabilities.js';
import { progressionHoldForCharacter } from '../_xp-engine.js';
import { STORY_LEVELS } from '../story/_settle.js';
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
        const week = await loadClanBossWeek(weekId);
        const boss = resolveClanBossDef(week);
        const [progress, party, sector, towerRecovery] = await Promise.all([
            clanName && week ? loadClanBossProgress(weekId, clanName) : null,
            clanName ? activePartyForPlayer(playerName) : null,
            boss && week ? loadSectorState(weekId, boss) : null,
            discoverActivityTowerRecovery(playerName),
        ]);
        const activeTraining = record?.activeTraining as { endsAt?: number } | null | undefined;
        const activeJutsuTraining = record?.activeJutsuTraining as { endsAt?: number } | null | undefined;
        const level = Math.max(1, Math.floor(Number(character.level) || 1));
        const storyProgress = Math.max(0, Math.min(STORY_LEVELS.length, Math.floor(Number(character.storyProgress) || 0)));
        const pets = Array.isArray(character.pets) ? character.pets as Array<Record<string, unknown>> : [];
        const activePetId = typeof character.activePetId === 'string' ? character.activePetId : '';
        const activePet = pets.find((pet) => pet.id === activePetId) ?? pets[0];
        const expedition = activePet?.expedition as Record<string, unknown> | undefined;
        const legacy = character.legacy && typeof character.legacy === 'object'
            ? character.legacy as Record<string, unknown>
            : null;
        const hollowRun = character.hollowGateRun && typeof character.hollowGateRun === 'object'
            ? character.hollowGateRun as Record<string, unknown>
            : null;
        const endlessRun = character.endlessTowerRun && typeof character.endlessTowerRun === 'object'
            ? character.endlessTowerRun as Record<string, unknown>
            : null;
        const spine = buildActivitySpine({
            capabilities: publicCapabilities(),
            now,
            level,
            hospitalized: character.hospitalized === true,
            onboardingStep: typeof character.onboardingStep === 'string' ? character.onboardingStep : '',
            unspentStats: Math.max(0, Math.floor(Number(character.statPoints ?? character.unspentStats) || 0)),
            trainingIdle: !activeTraining || Number(activeTraining.endsAt ?? 0) <= now,
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
            facts: {
                story: {
                    completed: storyProgress,
                    total: STORY_LEVELS.length,
                    nextLevel: STORY_LEVELS[storyProgress] ?? null,
                    nextEligible: storyProgress >= STORY_LEVELS.length || level >= (STORY_LEVELS[storyProgress] ?? Number.MAX_SAFE_INTEGER),
                },
                ranked: {
                    rating: Math.max(0, Math.floor(Number(character.rankedRating) || 1000)),
                    wins: Math.max(0, Math.floor(Number(character.rankedWins) || 0)),
                },
                towers: {
                    bestFloor: Math.max(0, Math.floor(Number(character.battleTowerBestFloor) || 0)),
                    bestWave: Math.max(0, Math.floor(Number(character.endlessTowerBestWave) || 0)),
                    spireTier: Math.max(0, Math.floor(Number(character.battleTowerAscension) || 0)),
                    activeRun: Boolean(endlessRun),
                },
                companions: {
                    count: pets.length,
                    activeName: typeof activePet?.name === 'string' ? activePet.name.slice(0, 40) : '',
                    activeLevel: Math.max(0, Math.floor(Number(activePet?.level) || 0)),
                    expeditionActive: Number(expedition?.endsAt ?? 0) > now,
                    ladderRating: Math.max(0, Math.floor(Number(character.petRankedRating) || 1000)),
                },
                chronicle: {
                    deckCards: Array.isArray(character.cardClashDeck) ? character.cardClashDeck.length : 0,
                    collectionCards: Array.isArray(character.tileCards) ? character.tileCards.length : 0,
                    wins: Math.max(0, Math.floor(Number(character.cardClashWins) || 0)),
                },
                legacy: {
                    accepted: Boolean(legacy?.legacyId),
                    stage: Math.max(0, Math.min(5, Math.floor(Number(legacy?.stage) || 0))),
                },
                profession: {
                    selected: ['healer', 'vanguard', 'petTamer'].includes(String(character.profession ?? '')),
                    label: typeof character.profession === 'string' ? character.profession : '',
                    rank: Math.max(0, Math.floor(Number(character.professionRank) || 0)),
                    xp: Math.max(0, Math.floor(Number(character.professionXp) || 0)),
                },
                prestige: {
                    level,
                    specialJoninPassed: Array.isArray(character.examsPassed) && character.examsPassed.includes('specialJonin'),
                    pvpKills: Math.max(0, Math.floor(Number(character.totalPvpKills) || 0)),
                },
            },
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
