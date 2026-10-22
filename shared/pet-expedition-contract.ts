/**
 * Shared Pet Expedition contract. Reward-bearing decisions are sealed by the
 * server, while the client reads the same numbers for honest previews.
 */

export const PET_EXPEDITION_TYPES = ['scout', 'forage', 'ruins'] as const;
export type PetExpeditionType = typeof PET_EXPEDITION_TYPES[number];

export const PET_EXPEDITION_RISKS = ['safe', 'bold'] as const;
export type PetExpeditionRisk = typeof PET_EXPEDITION_RISKS[number];

export const PET_EXPEDITION_PROVISIONS = ['none', 'pet-treat', 'elemental-pet-treat', 'ancient-pet-treat'] as const;
export type PetExpeditionProvision = typeof PET_EXPEDITION_PROVISIONS[number];

export const PET_EXPEDITION_RETURN_CHOICES = ['secure', 'investigate'] as const;
export type PetExpeditionReturnChoice = typeof PET_EXPEDITION_RETURN_CHOICES[number];
export type PetExpeditionReturnOutcome = 'secured' | 'discovery' | 'setback';

export const PET_EXPEDITION_DAILY_CAP = 12;
export const PET_EXPEDITION_CARAVAN_BONUS = 2;
export const PET_EXPEDITION_LOG_CAP = 20;
export const PET_EXPEDITION_TAMER_MULTIPLIER = 1.5;
export const PET_EXPEDITION_REWARD_VERSION = 2;
export type PetExpeditionFindChances = { bone: number; aura: number; fate: number };

export function petExpeditionProfessionMultiplier(profession: unknown): number {
    return profession === 'petTamer' ? PET_EXPEDITION_TAMER_MULTIPLIER : 1;
}

export const PET_EXPEDITION_ROUTES: Readonly<Record<PetExpeditionType, {
    label: string;
    durationMinutes: number;
    durationLabel: string;
    description: string;
    requiredLevel: number;
    ryoPerHour: number;
    petXpPerHour: number;
    findChances: PetExpeditionFindChances;
    // Historical rates reconstruct expeditions launched before reward version 2.
    petXpRate: number;
    ryoRate: number;
    boneRate: number;
    auraRate: number;
    fateRate: number;
}>> = {
    scout: {
        label: 'Scout Routes', durationMinutes: 45, durationLabel: '45m',
        description: 'A short outing with a small mixed material haul.',
        requiredLevel: 20, ryoPerHour: 240, petXpPerHour: 160,
        findChances: { bone: 0.25, aura: 0, fate: 0.03 },
        petXpRate: 1, ryoRate: 1.35, boneRate: 0.25, auraRate: 0, fateRate: 0.05,
    },
    forage: {
        label: 'Forage Wilds', durationMinutes: 120, durationLabel: '2h',
        description: 'A larger mixed haul with better material quality odds.',
        requiredLevel: 50, ryoPerHour: 360, petXpPerHour: 240,
        findChances: { bone: 0.35, aura: 0, fate: 0.06 },
        petXpRate: 1.45, ryoRate: 1, boneRate: 0.30, auraRate: 0.01, fateRate: 0.05,
    },
    ruins: {
        label: 'Explore Old Ruins', durationMinutes: 240, durationLabel: '4h',
        description: 'The richest haul, best XP pace, and strongest rare-find odds.',
        requiredLevel: 80, ryoPerHour: 540, petXpPerHour: 320,
        findChances: { bone: 0.50, aura: 0.04, fate: 0.12 },
        petXpRate: 1.2, ryoRate: 1.1, boneRate: 0.40, auraRate: 0.01, fateRate: 0.10,
    },
};

export const PET_EXPEDITION_RISK_RULES: Readonly<Record<PetExpeditionRisk, {
    label: string;
    description: string;
    ryoMultiplier: number;
    materialMultiplier: number;
    happinessCost: number;
}>> = {
    safe: {
        label: 'Safe route', description: 'No happiness cost; standard haul.',
        ryoMultiplier: 1, materialMultiplier: 1, happinessCost: 0,
    },
    bold: {
        label: 'Bold route', description: '+12% ryo and +15% find odds; costs 5 happiness on return.',
        ryoMultiplier: 1.12, materialMultiplier: 1.15, happinessCost: 5,
    },
};

export const PET_EXPEDITION_PROVISION_RULES: Readonly<Record<PetExpeditionProvision, {
    label: string;
    petXpMultiplier: number;
    materialMultiplier: number;
}>> = {
    none: { label: 'No provision', petXpMultiplier: 1, materialMultiplier: 1 },
    'pet-treat': { label: 'Treats', petXpMultiplier: 1.10, materialMultiplier: 1 },
    'elemental-pet-treat': { label: 'Elemental Treats', petXpMultiplier: 1.18, materialMultiplier: 1.05 },
    'ancient-pet-treat': { label: 'Ancient Treats', petXpMultiplier: 1.30, materialMultiplier: 1.10 },
};

/**
 * Share of the route's ryo an expedition actually pays (2026-10 economy
 * rebalance, owner ruling 2026-10-22). Expeditions are idle income, so they sit
 * under the passive ceiling: at 0.3 a Pet Tamer's 12 Ruins claims pay about
 * 11,700 ryo a day (about 26,000 with full mastery and bold routes), against a
 * regular L90 player's ~43,000 active day. The server passes its env reading
 * (api/missions/expedition-start.ts `expeditionRyoScale()`, dial
 * EXPEDITION_RYO_SCALE); the board previews at this code default. Ryo is sealed
 * at launch, so a change never touches an expedition already in flight.
 */
export const PET_EXPEDITION_RYO_SCALE = 0.3;

/** Version-2 secure-return rewards. All eligible pets earn the base rewards;
 * the fixed profession bonus stacks with purchased mastery and route choices. */
export function petExpeditionRewardPreview(type: PetExpeditionType, options: {
    profession: unknown; risk: PetExpeditionRisk; provision: PetExpeditionProvision;
    rewardMastery: number; materialMastery: number;
    /** Defaults to PET_EXPEDITION_RYO_SCALE; the server passes its dial reading. */
    ryoScale?: number;
}) {
    const route = PET_EXPEDITION_ROUTES[type];
    const hours = route.durationMinutes / 60;
    const profession = petExpeditionProfessionMultiplier(options.profession);
    const risk = PET_EXPEDITION_RISK_RULES[options.risk];
    const provision = PET_EXPEDITION_PROVISION_RULES[options.provision];
    const materialMultiplier = profession * options.materialMastery * risk.materialMultiplier * provision.materialMultiplier;
    const chance = (value: number) => Math.min(1, Math.max(0, value * materialMultiplier));
    const ryoScale = Number.isFinite(options.ryoScale) ? Math.max(0, options.ryoScale as number) : PET_EXPEDITION_RYO_SCALE;
    return {
        ryo: Math.round(hours * route.ryoPerHour * profession * options.rewardMastery * risk.ryoMultiplier * ryoScale),
        petXp: Math.round(hours * route.petXpPerHour * profession * provision.petXpMultiplier),
        chances: { bone: chance(route.findChances.bone), aura: chance(route.findChances.aura), fate: chance(route.findChances.fate) },
        materialMultiplier,
    };
}

export type PetExpeditionChoiceResolution = {
    outcome: PetExpeditionReturnOutcome;
    label: string;
    ryoMultiplier: number;
    materialMultiplier: number;
};

/** Investigate is a choice, not a free faucet: 60% at 1.25x and 40% at 0.6x. */
export function resolvePetExpeditionChoice(
    choice: PetExpeditionReturnChoice,
    roll: number,
): PetExpeditionChoiceResolution {
    if (choice === 'secure') {
        return { outcome: 'secured', label: 'Haul secured', ryoMultiplier: 1, materialMultiplier: 1 };
    }
    if (Math.max(0, Math.min(0.999999, roll)) < 0.60) {
        return { outcome: 'discovery', label: 'Final lead uncovered', ryoMultiplier: 1.25, materialMultiplier: 1.25 };
    }
    return { outcome: 'setback', label: 'Final lead went cold', ryoMultiplier: 0.60, materialMultiplier: 0.60 };
}

export function petExpeditionBasePetXp(type: PetExpeditionType): number {
    const route = PET_EXPEDITION_ROUTES[type];
    return Math.round(120 * Math.max(1, route.durationMinutes / 60) * route.petXpRate);
}

/**
 * TAMER_RYO_MULT (2026-10 economy rebalance #15; owner ruling A6: 0.4, kill
 * value 1). It scales EVERY expedition's ryo, Tamer and non-Tamer alike, so the
 * non-Tamer half rate stays below the Tamer rate. It lives inside the base so
 * the server payout and the board preview cannot drift: the server passes its
 * env reading (api/missions/report-pet-event.ts `tamerRyoMult()`), and the
 * client previews at this code default. Ryo is computed at collection, so the
 * change must deploy with the reset, when no expedition lease is in flight.
 */
export const TAMER_RYO_MULT = 0.4;

export function petExpeditionBaseRyo(type: PetExpeditionType, petLevel: number, ryoMult: number = TAMER_RYO_MULT): number {
    const route = PET_EXPEDITION_ROUTES[type];
    const mult = Number.isFinite(ryoMult) ? Math.max(0, ryoMult) : TAMER_RYO_MULT;
    return (90 * Math.max(1, route.durationMinutes / 60) * route.ryoRate
        + Math.max(1, Math.min(100, Math.floor(petLevel))) * 6) * mult;
}

export function petExpeditionMaterialChances(
    type: PetExpeditionType,
    options: { dropBonus: number; multiplier: number; rewardScale: number },
): { bone: number; aura: number; fate: number } {
    const route = PET_EXPEDITION_ROUTES[type];
    const mult = Math.max(0, options.multiplier) * Math.max(0, Math.min(1, options.rewardScale));
    const bounded = (value: number) => Math.max(0, Math.min(1, value * mult));
    return {
        bone: bounded(route.boneRate + options.dropBonus),
        aura: bounded(route.auraRate + options.dropBonus * 0.1),
        fate: bounded(route.fateRate + options.dropBonus * 0.1),
    };
}

const STORY_ACTIONS: Readonly<Record<PetExpeditionType, readonly string[]>> = {
    scout: [
        'mapped patrol gaps and marked a quiet route home',
        'shadowed an unknown courier without being seen',
        'tracked a fading chakra trail to an overlooked cache',
    ],
    forage: [
        'followed fresh tracks to a hidden stand of useful herbs',
        'crossed rough ground to recover supplies other scavengers missed',
        'found a sheltered spring and returned with a carefully packed haul',
    ],
    ruins: [
        'decoded old sealing marks inside a forgotten chamber',
        'picked a safe path through collapsed stone corridors',
        'opened a weathered reliquary beneath the old foundations',
    ],
};

/** Server-authored expedition story, deterministic for a receipt token. */
export function petExpeditionStory(options: {
    token: string;
    type: PetExpeditionType;
    place: string;
    biome: string;
    outcome: PetExpeditionReturnOutcome;
}): string {
    let hash = 0;
    for (const char of options.token) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    const actions = STORY_ACTIONS[options.type];
    const action = actions[hash % actions.length];
    const location = options.place || `${options.biome || 'central'} country`;
    const ending = options.outcome === 'discovery'
        ? 'Following one last clue revealed a second, better cache.'
        : options.outcome === 'setback'
            ? 'The last lead went cold, so only part of the haul made it home.'
            : 'The haul was secured before anything else could contest it.';
    return `Near ${location}, the expedition ${action}. ${ending}`;
}
