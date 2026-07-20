"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STORY_VILLAGE_BIOMES = exports.STORY_COMBAT_SESSION_TTL_SECONDS = exports.STORY_COMBAT_SESSION_TTL_MS = void 0;
exports.storyCombatBindingKey = storyCombatBindingKey;
exports.storyCombatRewardFingerprint = storyCombatRewardFingerprint;
exports.storyBossEligibility = storyBossEligibility;
exports.createStoryCombatBinding = createStoryCombatBinding;
exports.validateCompletedStoryCombatSession = validateCompletedStoryCombatSession;
exports.settleStoryCombatBinding = settleStoryCombatBinding;
exports.storySessionSurvivingHp = storySessionSurvivingHp;
exports.storyBossEnemyTemplate = storyBossEnemyTemplate;
exports.storyBossRunId = storyBossRunId;
const node_crypto_1 = require("node:crypto");
const _settle_js_1 = require("./_settle.js");
/*
 * Server-authoritative story-boss combat (SERVER_COMBAT_MIGRATION_PLAN Stage 4,
 * "high-value authored fights first"). Mirrors the mission pattern in
 * api/missions/_authoritative-combat-session.ts: /api/story/boss-start seals
 * the CURRENT story milestone (village + progress index + opponent + reward
 * table row) into a binding + a solo Tower session; /api/story/settle's runId
 * branch pays ONLY from a completed, winning, bound session. The client's old
 * role — attesting "I won" via the mint-at-start AiFightToken — is retired for
 * story bosses (kept for the capped Academy spar tutorial).
 */
exports.STORY_COMBAT_SESSION_TTL_MS = 45 * 60 * 1000;
exports.STORY_COMBAT_SESSION_TTL_SECONDS = Math.ceil(exports.STORY_COMBAT_SESSION_TTL_MS / 1000);
function storyCombatBindingKey(runId) {
    return `story-combat-binding:${runId}`;
}
// Mirrors the client's data/village-biomes.ts map so the sealed fight keeps the
// chapter's authored battlefield feel. Values must stay within TOWER_BIOMES.
exports.STORY_VILLAGE_BIOMES = {
    'Stormveil Village': 'forest',
    'Ashen Leaf Village': 'volcano',
    'Frostfang Village': 'snow',
    'Moonshadow Village': 'shadow',
};
function storyCombatRewardFingerprint(village, progressIndex) {
    const reward = _settle_js_1.STORY_REWARDS[progressIndex];
    return (0, node_crypto_1.createHash)('sha256').update(JSON.stringify({
        village,
        progressIndex,
        opponentId: (0, _settle_js_1.storyOpponentId)(village, _settle_js_1.STORY_LEVELS[progressIndex] ?? 0),
        xp: reward?.xp ?? 0,
        ryo: reward?.ryo ?? 0,
    })).digest('hex');
}
function storyBossEligibility(character) {
    const progressIndex = Math.max(0, Math.floor(Number(character.storyProgress) || 0));
    if (progressIndex >= _settle_js_1.STORY_LEVELS.length)
        return { ok: false, status: 409, error: 'Village story is already complete.' };
    const levelReq = _settle_js_1.STORY_LEVELS[progressIndex];
    const playerLevel = Math.max(1, Math.floor(Number(character.level) || 1));
    if (playerLevel < levelReq)
        return { ok: false, status: 403, error: `Story milestone requires level ${levelReq}.` };
    const village = typeof character.village === 'string' ? character.village : '';
    if (!_settle_js_1.LIBERATOR_TITLES[village])
        return { ok: false, status: 409, error: 'Player village has no story catalog.' };
    return { ok: true, progressIndex, levelReq, village };
}
function createStoryCombatBinding(params) {
    const now = params.now ?? Date.now();
    const levelReq = _settle_js_1.STORY_LEVELS[params.progressIndex] ?? 0;
    return {
        version: 1,
        sessionId: params.runId,
        runId: params.runId,
        playerName: params.playerName,
        village: params.village,
        progressIndex: params.progressIndex,
        opponentId: (0, _settle_js_1.storyOpponentId)(params.village, levelReq),
        rewardFingerprint: storyCombatRewardFingerprint(params.village, params.progressIndex),
        createdAt: now,
        expiresAt: now + exports.STORY_COMBAT_SESSION_TTL_MS,
        status: 'active',
    };
}
function validateCompletedStoryCombatSession(params) {
    const { binding, session, playerName, character } = params;
    const now = params.now ?? Date.now();
    if (!binding || binding.version !== 1 || !binding.sessionId || !binding.runId)
        return { ok: false, reason: 'invalid-binding' };
    if (binding.playerName !== playerName)
        return { ok: false, reason: 'wrong-player' };
    // The save's CURRENT milestone must still be the one that was sealed —
    // a stale session from an earlier chapter (or another village) cannot pay
    // the next milestone.
    const progressIndex = Math.max(0, Math.floor(Number(character.storyProgress) || 0));
    const village = typeof character.village === 'string' ? character.village : '';
    if (binding.progressIndex !== progressIndex || binding.village !== village)
        return { ok: false, reason: 'wrong-milestone' };
    if (!session || binding.runId !== session.runId)
        return { ok: false, reason: 'wrong-run' };
    if (binding.expiresAt <= now)
        return { ok: false, reason: 'expired' };
    if (binding.settledAt || binding.status !== 'active')
        return { ok: false, reason: 'already-settled' };
    if (session.status !== 'done')
        return { ok: false, reason: 'not-complete' };
    if (session.winner !== 'squad')
        return { ok: false, reason: 'not-won' };
    if (!session.actors.some((actor) => actor.side === 'squad' && actor.ownerSlug === playerName)) {
        return { ok: false, reason: 'not-a-member' };
    }
    if (binding.rewardFingerprint !== storyCombatRewardFingerprint(binding.village, binding.progressIndex)) {
        return { ok: false, reason: 'reward-drift' };
    }
    return { ok: true, binding };
}
function settleStoryCombatBinding(binding, now = Date.now()) {
    if (binding.status !== 'active' || binding.settledAt)
        return binding;
    return { ...binding, status: 'won', settledAt: now };
}
/** The player's surviving HP as the SERVER recorded it — replaces the old client-reported survivingHp. */
function storySessionSurvivingHp(session, playerName) {
    const actor = session.actors.find((candidate) => candidate.side === 'squad' && candidate.ownerSlug === playerName);
    return Math.max(0, Math.floor(Number(actor?.hp) || 0));
}
function clampInt(value, min, max, fallback) {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
/**
 * Server-owned story boss stats, scaled from the milestone level like
 * missionEnemyTemplate (api/_authoritative-pve.ts) with a boss-arc ramp:
 * early chapters fight gently above the mission curve, the finale hits hard.
 * The authored bossName from the client is DISPLAY-ONLY (never affects stats).
 */
function storyBossEnemyTemplate(params) {
    const progressIndex = clampInt(params.progressIndex, 0, _settle_js_1.STORY_LEVELS.length - 1, 0);
    const level = _settle_js_1.STORY_LEVELS[progressIndex];
    const arc = _settle_js_1.STORY_LEVELS.length <= 1 ? 1 : progressIndex / (_settle_js_1.STORY_LEVELS.length - 1);
    const specialty = ['Genjutsu', 'Taijutsu', 'Ninjutsu', 'Bukijutsu'][progressIndex % 4];
    const power = 1 + arc * 0.25;
    const offense = clampInt((150 + level * 27) * power, 180, 3200, 500);
    const defense = clampInt((120 + level * 20) * power, 140, 2600, 400);
    const name = typeof params.displayName === 'string' && params.displayName.trim()
        ? params.displayName.trim().slice(0, 80)
        : `${params.village.replace(/ Village$/, '')} Story Boss`;
    return {
        name,
        specialty,
        level,
        hp: clampInt((240 + level * level * 1.05) * (1.05 + arc * 0.4), 250, 14_000, 1000),
        stats: {
            [`${specialty.toLowerCase()}Offense`]: offense,
            [`${specialty.toLowerCase()}Defense`]: defense,
            strength: clampInt((80 + level * 8) * power, 80, 1100, 200),
            speed: clampInt((80 + level * 7) * power, 80, 1000, 200),
            intelligence: clampInt((80 + level * 7) * power, 80, 1000, 200),
            willpower: clampInt((80 + level * 7) * power, 80, 1000, 200),
        },
        visual: (0, _settle_js_1.storyOpponentId)(params.village, level),
        boss: true,
        armorRawDR: 0.05 + arc * 0.13,
        maxChakra: 120 + level * 4,
        maxStamina: 120 + level * 4,
        jutsu: [{
                id: `story-${progressIndex}-signature`,
                name: `${specialty} Signature`,
                type: specialty,
                element: 'None',
                ap: 60,
                range: specialty === 'Taijutsu' ? 1 : 3,
                effectPower: clampInt(22 + level * 0.55, 24, 72, 35),
                chakraCost: specialty === 'Taijutsu' || specialty === 'Bukijutsu' ? 0 : 18,
                staminaCost: specialty === 'Taijutsu' || specialty === 'Bukijutsu' ? 18 : 0,
                cooldown: 2,
                method: 'SINGLE',
            }],
    };
}
function storyBossRunId() {
    return `story-${(0, node_crypto_1.randomUUID)().replace(/-/g, '')}`;
}
