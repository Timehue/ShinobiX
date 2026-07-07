import type { CreatorMission, CreatorMissionEligibility } from "../types/missions";

const ENDGAME_LEVEL = 100;
const COMPETITIVE_LEVEL = 10;
const CLAN_BOSS_LEVEL = 30;
const VILLAGE_WAR_LEVEL = 30;

function textFor(mission: Pick<CreatorMission, "id" | "name" | "description">): string {
    return [mission.id, mission.name, mission.description].join(" ").toLowerCase();
}

function mergeMinLevel(current: number | undefined, required: number): number {
    return Math.max(current ?? 0, required);
}

export function creatorMissionEligibility(mission: Pick<CreatorMission, "id" | "name" | "description" | "levelReq">): CreatorMissionEligibility {
    const eligibility: CreatorMissionEligibility = { minLevel: Math.max(1, Math.floor(Number(mission.levelReq ?? 1))) };
    const text = textFor(mission);
    if (/\bhollow[- ]?gate\b|\bhollow\b|\bwarden\b|\bkeeper\b|\bendgame shrine\b/.test(text)) {
        eligibility.minLevel = mergeMinLevel(eligibility.minLevel, ENDGAME_LEVEL);
        eligibility.requiresHollowGateUnlocked = true;
        eligibility.requiredSystem = "hollowGate";
    }
    if (/\blegacy\b|\bmythic\b/.test(text)) {
        eligibility.minLevel = mergeMinLevel(eligibility.minLevel, ENDGAME_LEVEL);
        eligibility.requiresLegacyUnlocked = true;
        eligibility.requiredSystem = "legacy";
    }
    if (/\bclan[- ]?boss\b/.test(text)) {
        eligibility.minLevel = mergeMinLevel(eligibility.minLevel, CLAN_BOSS_LEVEL);
        eligibility.requiresClan = true;
        eligibility.requiresClanBossUnlocked = true;
        eligibility.requiredSystem = "clanBoss";
    }
    if (/\bvillage[- ]?war\b|\bwar ground\b|\bwar raid\b/.test(text)) {
        eligibility.minLevel = mergeMinLevel(eligibility.minLevel, VILLAGE_WAR_LEVEL);
        eligibility.requiresVillage = true;
        eligibility.requiredSystem = "villageWar";
    }
    if (/\branked\b/.test(text)) {
        eligibility.minLevel = mergeMinLevel(eligibility.minLevel, COMPETITIVE_LEVEL);
        eligibility.requiresRankedUnlocked = true;
        eligibility.requiredSystem = "ranked";
    } else if (/\bpvp\b|\bplayer duel\b|\bdefeat .*players?\b/.test(text)) {
        eligibility.minLevel = mergeMinLevel(eligibility.minLevel, COMPETITIVE_LEVEL);
        eligibility.requiresPvpUnlocked = true;
        eligibility.requiredSystem = "pvp";
    }
    return eligibility;
}

export function validateCreatorMissionEligibility(mission: Pick<CreatorMission, "id" | "name" | "description" | "levelReq">): { ok: true } | { ok: false; message: string } {
    const eligibility = creatorMissionEligibility(mission);
    const minLevel = eligibility.minLevel ?? 1;
    if (mission.levelReq < minLevel) {
        return { ok: false, message: `This mission must require Level ${minLevel} or higher.` };
    }
    return { ok: true };
}
