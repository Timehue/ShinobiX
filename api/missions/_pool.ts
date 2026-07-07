// Profession daily mission pool. Each profession draws deterministic missions per
// UTC day. Rewards are profession XP only, on top of per-action profession XP.
//
// Every template declares server-side eligibility metadata. Generation filters
// on this before issuing the daily set, and progress reporters re-check it before
// advancing a stored mission.

import { canPlayerReceiveMission, type MissionEligibility, type MissionEligibilityContext } from './_eligibility.js';

export type Profession = 'healer' | 'vanguard' | 'petTamer';

export type MissionKind =
    | 'healer-heal-count'
    | 'healer-heal-unique'
    | 'vanguard-pvp-wins'
    | 'vanguard-pvp-unique'
    | 'vanguard-raids'
    | 'pet-tamer-expeditions'
    | 'pet-tamer-long-expeditions'
    | 'pet-tamer-pet-train';

export type MissionTemplate = {
    templateId: string;
    profession: Profession;
    kind: MissionKind;
    name: string;
    description: string;
    target: number;
    xpReward: number;
    eligibility: MissionEligibility;
};

const healer = (minProfessionRank = 1): MissionEligibility => ({
    requiredProfession: 'healer',
    minLevel: 13,
    ...(minProfessionRank > 1 ? { minProfessionRank } : {}),
});
const vanguard = (minProfessionRank = 1): MissionEligibility => ({
    requiredProfession: 'vanguard',
    minLevel: 13,
    requiresPvpUnlocked: true,
    ...(minProfessionRank > 1 ? { minProfessionRank } : {}),
});
const tamerExpedition = (minProfessionRank = 1): MissionEligibility => ({
    requiredProfession: 'petTamer',
    minLevel: 13,
    requiredSystem: 'expedition',
    ...(minProfessionRank > 1 ? { minProfessionRank } : {}),
});
const tamerPetTraining = (minProfessionRank = 1): MissionEligibility => ({
    requiredProfession: 'petTamer',
    minLevel: 13,
    requiresPet: true,
    ...(minProfessionRank > 1 ? { minProfessionRank } : {}),
});

const HEALER_POOL: MissionTemplate[] = [
    { templateId: 'healer-triage-run', profession: 'healer', kind: 'healer-heal-unique', name: 'Triage Run', description: 'Heal 3 different patients.', target: 3, xpReward: 50, eligibility: healer() },
    { templateId: 'healer-mercy-round', profession: 'healer', kind: 'healer-heal-unique', name: 'Mercy Round', description: 'Heal 4 different patients.', target: 4, xpReward: 60, eligibility: healer() },
    { templateId: 'healer-field-medic', profession: 'healer', kind: 'healer-heal-unique', name: 'Field Medic', description: 'Heal 5 different patients.', target: 5, xpReward: 75, eligibility: healer(2) },
    { templateId: 'healer-combat-medic', profession: 'healer', kind: 'healer-heal-count', name: 'Combat Medic', description: 'Perform 5 successful heals.', target: 5, xpReward: 75, eligibility: healer() },
    { templateId: 'healer-hospital-vigil', profession: 'healer', kind: 'healer-heal-count', name: 'Hospital Vigil', description: 'Perform 7 successful heals.', target: 7, xpReward: 100, eligibility: healer(2) },
    { templateId: 'healer-ward-watch', profession: 'healer', kind: 'healer-heal-unique', name: 'Ward Watch', description: 'Heal 8 different patients.', target: 8, xpReward: 125, eligibility: healer(4) },
    { templateId: 'healer-surgeon', profession: 'healer', kind: 'healer-heal-count', name: 'Surgeon', description: 'Perform 10 successful heals.', target: 10, xpReward: 125, eligibility: healer(3) },
    { templateId: 'healer-mass-casualty', profession: 'healer', kind: 'healer-heal-unique', name: 'Mass Casualty', description: 'Heal 10 different patients.', target: 10, xpReward: 150, eligibility: healer(5) },
];

const VANGUARD_POOL: MissionTemplate[] = [
    { templateId: 'vanguard-patrol', profession: 'vanguard', kind: 'vanguard-pvp-wins', name: 'Patrol', description: 'Win 1 PvP battle.', target: 1, xpReward: 30, eligibility: vanguard() },
    { templateId: 'vanguard-skirmish', profession: 'vanguard', kind: 'vanguard-pvp-wins', name: 'Skirmish', description: 'Win 2 PvP battles.', target: 2, xpReward: 50, eligibility: vanguard() },
    { templateId: 'vanguard-blooded', profession: 'vanguard', kind: 'vanguard-pvp-wins', name: 'Blooded', description: 'Win 3 PvP battles.', target: 3, xpReward: 75, eligibility: vanguard(2) },
    { templateId: 'vanguard-cleaner', profession: 'vanguard', kind: 'vanguard-pvp-unique', name: 'Cleaner', description: 'Defeat 3 different players.', target: 3, xpReward: 100, eligibility: vanguard(3) },
    { templateId: 'vanguard-massacre', profession: 'vanguard', kind: 'vanguard-pvp-wins', name: 'Massacre', description: 'Win 5 PvP battles.', target: 5, xpReward: 100, eligibility: vanguard(4) },
    { templateId: 'vanguard-headhunter', profession: 'vanguard', kind: 'vanguard-pvp-unique', name: 'Headhunter', description: 'Defeat 4 different players.', target: 4, xpReward: 125, eligibility: vanguard(5) },
    { templateId: 'vanguard-warpath', profession: 'vanguard', kind: 'vanguard-pvp-wins', name: 'Warpath', description: 'Win 7 PvP battles.', target: 7, xpReward: 150, eligibility: vanguard(6) },
    { templateId: 'vanguard-annihilator', profession: 'vanguard', kind: 'vanguard-pvp-unique', name: 'Annihilator', description: 'Defeat 5 different players.', target: 5, xpReward: 150, eligibility: vanguard(7) },
    { templateId: 'vanguard-raid-strike', profession: 'vanguard', kind: 'vanguard-raids', name: 'Raid Strike', description: 'Successfully raid 1 village.', target: 1, xpReward: 60, eligibility: vanguard() },
    { templateId: 'vanguard-raid-pressure', profession: 'vanguard', kind: 'vanguard-raids', name: 'Pressure Raid', description: 'Successfully raid 3 villages.', target: 3, xpReward: 100, eligibility: vanguard(2) },
    { templateId: 'vanguard-raid-onslaught', profession: 'vanguard', kind: 'vanguard-raids', name: 'Onslaught', description: 'Successfully raid 5 villages.', target: 5, xpReward: 150, eligibility: vanguard(4) },
    { templateId: 'vanguard-raid-scourge', profession: 'vanguard', kind: 'vanguard-raids', name: 'Scourge', description: 'Successfully raid 7 villages.', target: 7, xpReward: 200, eligibility: vanguard(6) },
];

const PET_TAMER_POOL: MissionTemplate[] = [
    { templateId: 'tamer-short-walk', profession: 'petTamer', kind: 'pet-tamer-expeditions', name: 'Short Walk', description: 'Complete 1 expedition.', target: 1, xpReward: 30, eligibility: tamerExpedition() },
    { templateId: 'tamer-routine-patrol', profession: 'petTamer', kind: 'pet-tamer-expeditions', name: 'Routine Patrol', description: 'Complete 2 expeditions.', target: 2, xpReward: 50, eligibility: tamerExpedition() },
    { templateId: 'tamer-busy-day', profession: 'petTamer', kind: 'pet-tamer-expeditions', name: 'Busy Day', description: 'Complete 3 expeditions.', target: 3, xpReward: 75, eligibility: tamerExpedition(2) },
    { templateId: 'tamer-long-haul', profession: 'petTamer', kind: 'pet-tamer-long-expeditions', name: 'Long Haul', description: 'Complete 1 expedition of 4 hours or more.', target: 1, xpReward: 100, eligibility: tamerExpedition(2) },
    { templateId: 'tamer-deep-dive', profession: 'petTamer', kind: 'pet-tamer-long-expeditions', name: 'Deep Dive', description: 'Complete 2 expeditions of 4 hours or more.', target: 2, xpReward: 150, eligibility: tamerExpedition(4) },
    { templateId: 'tamer-coach', profession: 'petTamer', kind: 'pet-tamer-pet-train', name: 'Coach', description: 'Claim 2 pet training sessions.', target: 2, xpReward: 60, eligibility: tamerPetTraining() },
    { templateId: 'tamer-conditioning', profession: 'petTamer', kind: 'pet-tamer-pet-train', name: 'Conditioning', description: 'Claim 4 pet training sessions.', target: 4, xpReward: 100, eligibility: tamerPetTraining(3) },
    { templateId: 'tamer-marathon', profession: 'petTamer', kind: 'pet-tamer-expeditions', name: 'Marathon', description: 'Complete 5 expeditions.', target: 5, xpReward: 150, eligibility: tamerExpedition(5) },
];

export function getMissionPool(profession: Profession): MissionTemplate[] {
    if (profession === 'healer') return HEALER_POOL;
    if (profession === 'vanguard') return VANGUARD_POOL;
    if (profession === 'petTamer') return PET_TAMER_POOL;
    return [];
}

export function getMissionTemplateById(templateId: string): MissionTemplate | undefined {
    return [...HEALER_POOL, ...VANGUARD_POOL, ...PET_TAMER_POOL].find((m) => m.templateId === templateId);
}

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function stringHash(s: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}

function pickFromPool(pool: MissionTemplate[], playerName: string, dateKey: string, count: number): MissionTemplate[] {
    if (pool.length === 0) return [];
    const take = Math.min(count, pool.length);
    const rng = mulberry32(stringHash(`${playerName}:${dateKey}`));
    const remaining = [...pool];
    const chosen: MissionTemplate[] = [];
    for (let i = 0; i < take; i += 1) {
        const idx = Math.floor(rng() * remaining.length);
        chosen.push(remaining.splice(idx, 1)[0]);
    }
    return chosen;
}

export function pickDailyMissions(
    profession: Profession,
    playerName: string,
    dateKey: string,
    count = 3,
): MissionTemplate[] {
    return pickFromPool(getMissionPool(profession), playerName, dateKey, count);
}

export function pickDailyMissionsForPlayer(opts: {
    profession: Profession;
    playerName: string;
    dateKey: string;
    count?: number;
    character?: Record<string, unknown> | null;
    context?: MissionEligibilityContext;
}): MissionTemplate[] {
    const pool = getMissionPool(opts.profession);
    const eligible = pool.filter((mission) => canPlayerReceiveMission(opts.character ?? {}, mission, opts.context).ok);
    return pickFromPool(eligible, opts.playerName, opts.dateKey, opts.count ?? 3);
}

// New-shinobi (pre-profession) daily track.
export type NewbieMissionKind = 'newbie-battle-wins' | 'newbie-missions';

export type NewbieMissionTemplate = {
    templateId: string;
    kind: NewbieMissionKind;
    name: string;
    description: string;
    target: number;
    ryoReward: number;
};

const NEWBIE_BATTLE_POOL: NewbieMissionTemplate[] = [
    { templateId: 'newbie-battles-2', kind: 'newbie-battle-wins', name: 'Sparring Practice', description: 'Win 2 battles.', target: 2, ryoReward: 120 },
    { templateId: 'newbie-battles-3', kind: 'newbie-battle-wins', name: 'Proving Ground', description: 'Win 3 battles.', target: 3, ryoReward: 160 },
];

const NEWBIE_MISSION_POOL: NewbieMissionTemplate[] = [
    { templateId: 'newbie-missions-2', kind: 'newbie-missions', name: 'Errand Runner', description: 'Complete 2 missions.', target: 2, ryoReward: 120 },
    { templateId: 'newbie-missions-3', kind: 'newbie-missions', name: 'Village Service', description: 'Complete 3 missions.', target: 3, ryoReward: 160 },
];

function seededPickOne<T>(pool: T[], seedStr: string): T | undefined {
    if (pool.length === 0) return undefined;
    const rng = mulberry32(stringHash(seedStr));
    return pool[Math.floor(rng() * pool.length)];
}

export function pickNewbieMissions(playerName: string, dateKey: string): NewbieMissionTemplate[] {
    const battle = seededPickOne(NEWBIE_BATTLE_POOL, `${playerName}:${dateKey}:nb-battle`);
    const mission = seededPickOne(NEWBIE_MISSION_POOL, `${playerName}:${dateKey}:nb-mission`);
    return [battle, mission].filter((t): t is NewbieMissionTemplate => Boolean(t));
}
