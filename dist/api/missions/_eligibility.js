"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.missionSearchText = missionSearchText;
exports.normalizeMissionEligibility = normalizeMissionEligibility;
exports.canPlayerReceiveMission = canPlayerReceiveMission;
exports.canPlayerClaimMission = canPlayerClaimMission;
exports.missionEligibilityFailureBody = missionEligibilityFailureBody;
exports.validateCreatorMissionEligibility = validateCreatorMissionEligibility;
const ENDGAME_LEVEL = 100;
const COMPETITIVE_PVP_LEVEL = 10;
const CLAN_BOSS_LEVEL = 30;
const VILLAGE_WAR_LEVEL = 30;
const RANK_ORDER = [
    'academy student',
    'genin',
    'chunin',
    'jonin',
    'special jonin',
    'kage',
    'clan leader',
];
function cleanLevel(value) {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n > 0 ? n : undefined;
}
function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function asArray(value) {
    if (value === undefined)
        return [];
    return Array.isArray(value) ? value : [value];
}
function mergedMinLevel(a, b) {
    return Math.max(a ?? 0, b);
}
function missionSearchText(mission) {
    return [
        mission.id,
        mission.key,
        mission.templateId,
        mission.name,
        mission.desc,
        mission.description,
        mission.counter,
        mission.kind,
    ].map(cleanString).filter(Boolean).join(' ').toLowerCase();
}
function normalizeMissionEligibility(mission) {
    const explicit = mission.eligibility ?? {};
    const out = { ...explicit };
    const derivedLevel = cleanLevel(mission.levelReq) ?? cleanLevel(mission.min);
    if (derivedLevel !== undefined)
        out.minLevel = mergedMinLevel(out.minLevel, derivedLevel);
    const text = missionSearchText(mission);
    if (/\bhollow[- ]?gate\b|\bhollow\b|\bwarden\b|\bkeeper\b|\bendgame shrine\b/.test(text)) {
        out.minLevel = mergedMinLevel(out.minLevel, ENDGAME_LEVEL);
        out.requiresHollowGateUnlocked = true;
    }
    if (/\blegacy\b|\bmythic\b/.test(text)) {
        out.minLevel = mergedMinLevel(out.minLevel, ENDGAME_LEVEL);
        out.requiresLegacyUnlocked = true;
    }
    if (/\bclan[- ]?boss\b/.test(text)) {
        out.minLevel = mergedMinLevel(out.minLevel, CLAN_BOSS_LEVEL);
        out.requiresClan = true;
        out.requiresClanBossUnlocked = true;
    }
    if (/\bvillage[- ]?war\b|\bwar ground\b|\bwar raid\b/.test(text)) {
        out.minLevel = mergedMinLevel(out.minLevel, VILLAGE_WAR_LEVEL);
        out.requiresVillage = true;
    }
    if (/\branked\b|rankedwins/.test(text)) {
        out.minLevel = mergedMinLevel(out.minLevel, COMPETITIVE_PVP_LEVEL);
        out.requiresRankedUnlocked = true;
    }
    else if (/\bpvp\b|\bplayer duel\b|\bdefeat .*players?\b/.test(text)) {
        out.minLevel = mergedMinLevel(out.minLevel, COMPETITIVE_PVP_LEVEL);
        out.requiresPvpUnlocked = true;
    }
    return out;
}
function playerLevel(character) {
    const n = Math.floor(Number(character?.level ?? 1));
    return Number.isFinite(n) && n > 0 ? n : 1;
}
function professionRank(character) {
    const n = Math.floor(Number(character?.professionRank ?? 1));
    return Number.isFinite(n) && n > 0 ? n : 1;
}
function rankIndex(rank) {
    const normalized = rank.trim().toLowerCase();
    const direct = RANK_ORDER.indexOf(normalized);
    if (direct >= 0)
        return direct;
    if (normalized.includes('academy'))
        return 0;
    if (normalized.includes('genin'))
        return 1;
    if (normalized.includes('chunin'))
        return 2;
    if (normalized.includes('jonin'))
        return 3;
    if (normalized.includes('kage'))
        return 5;
    if (normalized.includes('clan leader'))
        return 6;
    return -1;
}
function hasPet(character) {
    const pets = character?.pets;
    return Array.isArray(pets) && pets.length > 0;
}
function hasClan(character) {
    return cleanString(character?.clan).length > 0;
}
function hasVillage(character) {
    return cleanString(character?.village).length > 0;
}
function isSystemUnlocked(system, character, context) {
    if (context.systems?.[system] === true)
        return true;
    if (context.systems?.[system] === false)
        return false;
    const level = playerLevel(character);
    switch (system) {
        case 'pvp':
            return level >= COMPETITIVE_PVP_LEVEL;
        case 'ranked':
            return level >= COMPETITIVE_PVP_LEVEL;
        case 'pet':
            return hasPet(character);
        case 'expedition':
            return hasPet(character);
        case 'legacy':
            return Boolean(character.legacy);
        case 'cardClash':
            return Boolean(character.cardClashTutorialSeen || character.cardClashWins || character.cardClashDeck);
        case 'hollowGate':
        case 'clanBoss':
        case 'villageWar':
            return false;
        default:
            return false;
    }
}
function missingSystem(system, character, context) {
    if (isSystemUnlocked(system, character, context))
        return null;
    return { ok: false, reason: 'system-locked', playerLevel: playerLevel(character), requiredSystem: system };
}
function canPlayerReceiveMission(character, mission, context = {}) {
    const char = character ?? {};
    const level = playerLevel(char);
    const eligibility = normalizeMissionEligibility(mission);
    if (eligibility.minLevel !== undefined && level < eligibility.minLevel) {
        return { ok: false, reason: 'level-too-low', playerLevel: level, requiredLevel: eligibility.minLevel };
    }
    if (eligibility.maxLevel !== undefined && level > eligibility.maxLevel) {
        return { ok: false, reason: 'level-too-high', playerLevel: level, requiredLevel: eligibility.maxLevel };
    }
    if (eligibility.minRank) {
        const have = rankIndex(cleanString(char.rankTitle));
        const need = rankIndex(eligibility.minRank);
        if (need >= 0 && have < need) {
            return { ok: false, reason: 'rank-too-low', playerLevel: level, requiredRank: eligibility.minRank };
        }
    }
    if (eligibility.requiredProfession && char.profession !== eligibility.requiredProfession) {
        return { ok: false, reason: 'profession-mismatch', playerLevel: level, requiredProfession: eligibility.requiredProfession };
    }
    if (eligibility.minProfessionRank !== undefined && professionRank(char) < eligibility.minProfessionRank) {
        return {
            ok: false,
            reason: 'profession-rank-too-low',
            playerLevel: level,
            requiredProfessionRank: eligibility.minProfessionRank,
        };
    }
    if (eligibility.requiresClan && !hasClan(char))
        return { ok: false, reason: 'missing-clan', playerLevel: level };
    if (eligibility.requiresVillage && !hasVillage(char))
        return { ok: false, reason: 'missing-village', playerLevel: level };
    if (eligibility.requiresPet && !hasPet(char))
        return { ok: false, reason: 'missing-pet', playerLevel: level };
    const systems = [
        ...asArray(eligibility.requiredSystem),
        ...(eligibility.requiresPvpUnlocked ? ['pvp'] : []),
        ...(eligibility.requiresRankedUnlocked ? ['ranked'] : []),
        ...(eligibility.requiresHollowGateUnlocked ? ['hollowGate'] : []),
        ...(eligibility.requiresLegacyUnlocked ? ['legacy'] : []),
        ...(eligibility.requiresClanBossUnlocked ? ['clanBoss'] : []),
    ];
    for (const system of systems) {
        const miss = missingSystem(system, char, context);
        if (miss)
            return miss;
    }
    for (const flag of eligibility.requiredFlags ?? []) {
        if (context.flags?.[flag] !== true) {
            return { ok: false, reason: 'feature-disabled', playerLevel: level, requiredFlag: flag };
        }
    }
    for (const unlock of eligibility.requiredUnlocks ?? []) {
        if (context.unlocks?.[unlock] !== true && char[unlock] !== true) {
            return { ok: false, reason: 'not-yet-unlocked', playerLevel: level, requiredUnlock: unlock };
        }
    }
    return { ok: true, playerLevel: level };
}
function canPlayerClaimMission(character, mission, context = {}) {
    return canPlayerReceiveMission(character, mission, context);
}
function missionEligibilityFailureBody(result) {
    return {
        error: 'mission_not_eligible',
        reason: result.reason ?? 'not-yet-unlocked',
        requiredLevel: result.requiredLevel,
        playerLevel: result.playerLevel,
        requiredSystem: result.requiredSystem,
        requiredProfession: result.requiredProfession,
        requiredProfessionRank: result.requiredProfessionRank,
    };
}
function validateCreatorMissionEligibility(mission) {
    const eligibility = normalizeMissionEligibility(mission);
    const declaredLevel = cleanLevel(mission.levelReq) ?? cleanLevel(mission.min);
    const text = missionSearchText(mission);
    if (declaredLevel === undefined) {
        return { ok: false, reason: 'missing-level-requirement', eligibility };
    }
    if (/\bhollow[- ]?gate\b|\bhollow\b|\bwarden\b|\bkeeper\b|\bendgame shrine\b/.test(text)) {
        if (declaredLevel < ENDGAME_LEVEL || !eligibility.requiresHollowGateUnlocked) {
            return { ok: false, reason: 'missing-hollow-gate-requirement', eligibility, requiredLevel: ENDGAME_LEVEL, requiredSystem: 'hollowGate' };
        }
    }
    if (/\blegacy\b|\bmythic\b/.test(text)) {
        if (declaredLevel < ENDGAME_LEVEL || !eligibility.requiresLegacyUnlocked) {
            return { ok: false, reason: 'missing-legacy-requirement', eligibility, requiredLevel: ENDGAME_LEVEL, requiredSystem: 'legacy' };
        }
    }
    if (/\bclan[- ]?boss\b/.test(text)) {
        if (declaredLevel < CLAN_BOSS_LEVEL || !eligibility.requiresClan || !eligibility.requiresClanBossUnlocked) {
            return { ok: false, reason: 'missing-clan-boss-requirement', eligibility, requiredLevel: CLAN_BOSS_LEVEL, requiredSystem: 'clanBoss' };
        }
    }
    if (/\branked\b|rankedwins/.test(text)) {
        if (declaredLevel < COMPETITIVE_PVP_LEVEL || !eligibility.requiresRankedUnlocked) {
            return { ok: false, reason: 'missing-ranked-requirement', eligibility, requiredLevel: COMPETITIVE_PVP_LEVEL, requiredSystem: 'ranked' };
        }
    }
    return { ok: true, eligibility };
}
