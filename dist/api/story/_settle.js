"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STORY_LEVELS = void 0;
exports.storyOpponentId = storyOpponentId;
exports.applyAcademySparSettlement = applyAcademySparSettlement;
exports.applyStoryBossSettlement = applyStoryBossSettlement;
const _xp_engine_js_1 = require("../_xp-engine.js");
exports.STORY_LEVELS = [4, 15, 25, 35, 50, 65, 75, 85, 100];
const STORY_REWARDS = [
    { xp: 120, ryo: 75 },
    { xp: 500, ryo: 250 },
    { xp: 900, ryo: 500 },
    { xp: 1400, ryo: 800 },
    { xp: 2200, ryo: 1300 },
    { xp: 3400, ryo: 2000 },
    { xp: 4600, ryo: 2800 },
    { xp: 6200, ryo: 4000 },
    { xp: 10000, ryo: 7500 },
];
const LIBERATOR_TITLES = {
    'Stormveil Village': 'Stormbreaker',
    'Ashen Leaf Village': 'Root Liberator',
    'Frostfang Village': 'Oathbreaker',
    'Moonshadow Village': 'Moon Unmasked',
};
function storyOpponentId(village, level) {
    return `story-ai-${village.toLowerCase().replace(/\W+/g, '-')}-${level}`;
}
function applyAcademySparSettlement(character, token) {
    if (character.academySparClaimed === true) {
        return { ok: false, status: 409, error: 'Academy spar reward was already claimed.' };
    }
    const onboardingStep = String(character.onboardingStep ?? '');
    if (onboardingStep !== 'academySpar' && onboardingStep !== 'spar') {
        return { ok: false, status: 409, error: 'Academy spar is not the current onboarding step.' };
    }
    if (!/^temp-academy-spar-\d{10,16}$/.test(String(token.opponentId ?? ''))) {
        return { ok: false, status: 409, error: 'AI fight token does not match the Academy spar.' };
    }
    const leveled = (0, _xp_engine_js_1.gainXp)(character, 60);
    const maxHp = Math.max(1, Number(leveled.maxHp) || 1);
    const next = {
        ...leveled,
        ryo: Math.max(0, Number(leveled.ryo) || 0) + 30,
        hp: Math.max(1, maxHp - 25),
        stamina: Math.max(0, Number(leveled.maxStamina) || 0),
        chakra: Math.max(0, Number(leveled.maxChakra) || 0),
        onboardingStep: 'cafeteria',
        academySparClaimed: true,
    };
    return { ok: true, character: next, progress: 0, xp: 60, ryo: 30, auraDust: 0, finale: false };
}
function applyStoryBossSettlement(character, token, survivingHpRaw) {
    const progress = Math.max(0, Math.floor(Number(character.storyProgress) || 0));
    if (progress >= exports.STORY_LEVELS.length)
        return { ok: false, status: 409, error: 'Village story is already complete.' };
    const levelReq = exports.STORY_LEVELS[progress];
    const playerLevel = Math.max(1, Math.floor(Number(character.level) || 1));
    if (playerLevel < levelReq)
        return { ok: false, status: 403, error: `Story milestone requires level ${levelReq}.` };
    const village = typeof character.village === 'string' ? character.village : '';
    if (!LIBERATOR_TITLES[village])
        return { ok: false, status: 409, error: 'Player village has no story catalog.' };
    if (token.opponentId !== storyOpponentId(village, levelReq)) {
        return { ok: false, status: 409, error: 'AI fight token does not match the current story boss.' };
    }
    const reward = STORY_REWARDS[progress];
    const leveled = (0, _xp_engine_js_1.gainXp)(character, reward.xp);
    const maxHp = Math.max(1, Number(leveled.maxHp) || 1);
    const maxStamina = Math.max(0, Number(leveled.maxStamina) || 0);
    const maxChakra = Math.max(0, Number(leveled.maxChakra) || 0);
    const survivingHp = Math.max(0, Math.min(maxHp, Number(survivingHpRaw) || 0));
    const finale = progress === exports.STORY_LEVELS.length - 1;
    const title = finale ? LIBERATOR_TITLES[village] : undefined;
    const inventory = Array.isArray(leveled.inventory)
        ? leveled.inventory.filter((id) => typeof id === 'string')
        : [];
    const next = {
        ...leveled,
        ryo: Math.max(0, Number(leveled.ryo) || 0) + reward.ryo,
        auraDust: Math.max(0, Number(leveled.auraDust) || 0) + 12,
        hp: Math.min(maxHp, survivingHp + 25),
        stamina: Math.min(maxStamina, Math.max(0, Number(leveled.stamina) || 0) + 20),
        chakra: Math.min(maxChakra, Math.max(0, Number(leveled.chakra) || 0) + 20),
        storyProgress: progress + 1,
        clanBattleContrib: Math.max(0, Math.floor(Number(leveled.clanBattleContrib) || 0)) + 1,
        clanContribMonth: new Date().toISOString().slice(0, 7),
        ...(finale ? {
            storyTitle: title,
            rankTitle: title,
            inventory: inventory.includes('hollow-gate-key') ? inventory : [...inventory, 'hollow-gate-key'],
        } : {}),
    };
    return { ok: true, character: next, progress: progress + 1, xp: reward.xp, ryo: reward.ryo, auraDust: 12, finale, ...(title ? { title } : {}) };
}
