/**
 * Shared wire contract for the first server-wide village crisis.
 *
 * The crisis deliberately reuses the four level-35 story threats. The
 * quartered seal is established canon; it coordinates old infrastructure but
 * is never presented as a creature, god, or portal.
 */

export const WORLD_CRISIS_ID = 'fourfold-breach-v1';
export const WORLD_CRISIS_TITLE = 'The Fourfold Breach';
export const WORLD_CRISIS_TRIGGER_LEVEL = 37;
export const WORLD_CRISIS_DEFAULT_TARGET = 100;
export const WORLD_CRISIS_MIN_TARGET = 10;
export const WORLD_CRISIS_MAX_TARGET = 500;

export const WORLD_CRISIS_VILLAGES = [
    'Stormveil Village',
    'Ashen Leaf Village',
    'Frostfang Village',
    'Moonshadow Village',
] as const;

export type WorldCrisisVillage = typeof WORLD_CRISIS_VILLAGES[number];
export type WorldCrisisStatus = 'dormant' | 'armed' | 'active' | 'resolved';
export type WorldCrisisPhase = 'first-signal' | 'quartered-assault' | 'last-breach' | 'villages-hold';

export type WorldCrisisVillageState = {
    village: WorldCrisisVillage;
    defenses: number;
    target: number;
    lastDefendedAt: number | null;
    completedAt: number | null;
};

export type WorldCrisisContributor = {
    player: string;
    village: WorldCrisisVillage;
    wins: number;
    lastAt: number;
};

export type WorldCrisisState = {
    schemaVersion: 1;
    crisisId: typeof WORLD_CRISIS_ID;
    runId: string;
    status: WorldCrisisStatus;
    phase: WorldCrisisPhase;
    triggerLevel: number;
    armedAt: number | null;
    awakenedAt: number | null;
    awakenedBy: string | null;
    awakenedVillage: WorldCrisisVillage | null;
    resolvedAt: number | null;
    targetPerVillage: number;
    villages: Record<WorldCrisisVillage, WorldCrisisVillageState>;
    contributors: Record<string, WorldCrisisContributor>;
    appliedProofIds: string[];
    awakeningAnnouncementId: number | null;
    resolutionAnnouncementId: number | null;
    revision: number;
    updatedAt: number;
};

export type WorldCrisisVillageProjection = WorldCrisisVillageState & {
    remaining: number;
    progressPercent: number;
    integrityPercent: number;
    attackersActive: boolean;
};

export type WorldCrisisProjection = Omit<WorldCrisisState, 'contributors' | 'appliedProofIds' | 'villages'> & {
    villages: Record<WorldCrisisVillage, WorldCrisisVillageProjection>;
    totalDefenses: number;
    totalTarget: number;
    globalProgressPercent: number;
    topDefenders: WorldCrisisContributor[];
};

export type WorldCrisisEncounterDefinition = {
    village: WorldCrisisVillage;
    sourceId: string;
    name: string;
    portrait: string;
    biome: 'forest' | 'volcano' | 'snow' | 'shadow';
    loadoutId: 'bruiser' | 'boss' | 'burst' | 'defender';
    statBonus: number;
};

export const WORLD_CRISIS_ENCOUNTERS: Record<WorldCrisisVillage, WorldCrisisEncounterDefinition> = {
    'Stormveil Village': {
        village: 'Stormveil Village',
        sourceId: `${WORLD_CRISIS_ID}:stormveil`,
        name: 'Storm Engine Warden',
        portrait: '/portraits/hollow-warden.webp',
        biome: 'forest',
        loadoutId: 'bruiser',
        statBonus: 3,
    },
    'Ashen Leaf Village': {
        village: 'Ashen Leaf Village',
        sourceId: `${WORLD_CRISIS_ID}:ashen-leaf`,
        name: 'First Flame Sentinel',
        portrait: '/portraits/first-flame-avatar.webp',
        biome: 'volcano',
        loadoutId: 'burst',
        statBonus: 3,
    },
    'Frostfang Village': {
        village: 'Frostfang Village',
        sourceId: `${WORLD_CRISIS_ID}:frostfang`,
        name: 'Oathbound Ice Captain',
        portrait: '/portraits/meter-warden-kree.webp',
        biome: 'snow',
        loadoutId: 'defender',
        statBonus: 4,
    },
    'Moonshadow Village': {
        village: 'Moonshadow Village',
        sourceId: `${WORLD_CRISIS_ID}:moonshadow`,
        name: 'Contract-Bound Shadow',
        portrait: '/portraits/masked-auction-enforcer.webp',
        biome: 'shadow',
        loadoutId: 'boss',
        statBonus: 4,
    },
};

export function isWorldCrisisVillage(value: unknown): value is WorldCrisisVillage {
    return typeof value === 'string' && (WORLD_CRISIS_VILLAGES as readonly string[]).includes(value);
}

export function worldCrisisEncounterForVillage(village: WorldCrisisVillage): WorldCrisisEncounterDefinition {
    return WORLD_CRISIS_ENCOUNTERS[village];
}

export function worldCrisisPhaseForProgress(progressPercent: number, resolved = false): WorldCrisisPhase {
    if (resolved) return 'villages-hold';
    if (progressPercent >= 72) return 'last-breach';
    if (progressPercent >= 28) return 'quartered-assault';
    return 'first-signal';
}

export function worldCrisisPhaseLabel(phase: WorldCrisisPhase): string {
    if (phase === 'first-signal') return 'First Signal';
    if (phase === 'quartered-assault') return 'Quartered Assault';
    if (phase === 'last-breach') return 'Last Breach';
    return 'The Villages Hold';
}
