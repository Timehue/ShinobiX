/**
 * Shared contract for the level-80 server-wide crisis.
 *
 * Every village retains a regional report from its existing level-80
 * "Harrow's Shortcut" account. The first committed level-80 crossing triggers
 * the public alarm and the record keepers' comparison; it does not mean that
 * player personally completed all four investigations. Hollow Gate is
 * Sunken Court infrastructure and a human-run collection network, never a
 * creature, spirit, god, or portal.
 */
import {
    WORLD_CRISIS_VILLAGES,
    type WorldCrisisVillage,
} from './world-crisis.js';

export const WORLD_CRISIS_80_ID = 'hollow-gate-reckoning-v1';
export const WORLD_CRISIS_80_TITLE = 'The Hollow Gate Reckoning';
export const WORLD_CRISIS_80_TRIGGER_LEVEL = 80;
export const WORLD_CRISIS_80_DEFAULT_TARGET = 180;
export const WORLD_CRISIS_80_MIN_TARGET = 20;
export const WORLD_CRISIS_80_MAX_TARGET = 750;
export const WORLD_CRISIS_80_TOWER_ID = 'hollow-gate-reckoning';

export const WORLD_CRISIS_80_VILLAGES = WORLD_CRISIS_VILLAGES;
export type WorldCrisis80Village = WorldCrisisVillage;
export type WorldCrisis80Status = 'dormant' | 'armed' | 'active' | 'resolved';
export type WorldCrisis80Phase = 'witness-signal' | 'collection-cells' | 'gate-exposed' | 'claims-broken';
export type WorldCrisis80DefensePath = 'shinobi' | 'companion';

export type WorldCrisis80VillageState = {
    village: WorldCrisis80Village;
    defenses: number;
    shinobiDefenses: number;
    companionDefenses: number;
    target: number;
    lastDefendedAt: number | null;
    completedAt: number | null;
};

export type WorldCrisis80Contributor = {
    player: string;
    village: WorldCrisis80Village;
    wins: number;
    shinobiWins: number;
    companionWins: number;
    lastAt: number;
};

export type WorldCrisis80State = {
    schemaVersion: 1;
    crisisId: typeof WORLD_CRISIS_80_ID;
    runId: string;
    status: WorldCrisis80Status;
    phase: WorldCrisis80Phase;
    triggerLevel: number;
    armedAt: number | null;
    awakenedAt: number | null;
    awakenedBy: string | null;
    awakenedVillage: WorldCrisis80Village | null;
    resolvedAt: number | null;
    targetPerVillage: number;
    villages: Record<WorldCrisis80Village, WorldCrisis80VillageState>;
    contributors: Record<string, WorldCrisis80Contributor>;
    appliedProofIds: string[];
    awakeningAnnouncementId: number | null;
    resolutionAnnouncementId: number | null;
    revision: number;
    updatedAt: number;
};

export type WorldCrisis80VillageProjection = WorldCrisis80VillageState & {
    remaining: number;
    progressPercent: number;
    integrityPercent: number;
    attackersActive: boolean;
};

export type WorldCrisis80Projection = Omit<WorldCrisis80State, 'contributors' | 'appliedProofIds' | 'villages'> & {
    villages: Record<WorldCrisis80Village, WorldCrisis80VillageProjection>;
    totalDefenses: number;
    totalShinobiDefenses: number;
    totalCompanionDefenses: number;
    totalTarget: number;
    globalProgressPercent: number;
    topDefenders: WorldCrisis80Contributor[];
};

export type WorldCrisis80TriadMember = {
    name: string;
    profileId: 'builtin-ai-mist-sentinel' | 'builtin-ai-rogue-ninja' | 'builtin-ai-shadow-weaver';
    visual: 'stormglass-bastion' | 'stormglass-marksman' | 'stormglass-weaver';
    specialty: 'Taijutsu' | 'Bukijutsu' | 'Genjutsu' | 'Ninjutsu';
    role: 'vanguard' | 'skirmisher' | 'controller';
    targetMode: 'lowest-hp' | 'squishiest' | 'support';
    hpMultiplier: number;
    statMultiplier: number;
};

export type WorldCrisis80EncounterDefinition = {
    village: WorldCrisis80Village;
    sourceId: string;
    petSourceId: string;
    biome: 'forest' | 'volcano' | 'snow' | 'shadow';
    ledgerName: string;
    triadName: string;
    triad: readonly [WorldCrisis80TriadMember, WorldCrisis80TriadMember, WorldCrisis80TriadMember];
    petPackName: string;
    petNames: readonly [string, string, string];
};

const TRIAD_BASE = [
    {
        profileId: 'builtin-ai-mist-sentinel', visual: 'stormglass-bastion', specialty: 'Ninjutsu',
        role: 'vanguard', targetMode: 'lowest-hp', hpMultiplier: .52, statMultiplier: .70,
    },
    {
        profileId: 'builtin-ai-rogue-ninja', visual: 'stormglass-marksman', specialty: 'Taijutsu',
        role: 'skirmisher', targetMode: 'squishiest', hpMultiplier: .42, statMultiplier: .76,
    },
    {
        profileId: 'builtin-ai-shadow-weaver', visual: 'stormglass-weaver', specialty: 'Genjutsu',
        role: 'controller', targetMode: 'support', hpMultiplier: .44, statMultiplier: .71,
    },
] as const;

function triad(names: readonly [string, string, string]): WorldCrisis80EncounterDefinition['triad'] {
    return TRIAD_BASE.map((member, index) => ({ ...member, name: names[index]! })) as unknown as WorldCrisis80EncounterDefinition['triad'];
}

export const WORLD_CRISIS_80_ENCOUNTERS: Record<WorldCrisis80Village, WorldCrisis80EncounterDefinition> = {
    'Stormveil Village': {
        village: 'Stormveil Village', sourceId: `${WORLD_CRISIS_80_ID}:stormveil:triad`, petSourceId: `${WORLD_CRISIS_80_ID}:stormveil:pets`,
        biome: 'forest', ledgerName: 'Exiles\' Witness Ledger', triadName: 'Cistern Collection Cell',
        triad: triad(['Storm Claimant', 'Exiles\' Hunter', 'Cistern Auditor']),
        petPackName: 'Salt-Stair Pursuit Pack', petNames: ['Brinefang', 'Cableclaw', 'Tithecrow'],
    },
    'Ashen Leaf Village': {
        village: 'Ashen Leaf Village', sourceId: `${WORLD_CRISIS_80_ID}:ashen-leaf:triad`, petSourceId: `${WORLD_CRISIS_80_ID}:ashen-leaf:pets`,
        biome: 'volcano', ledgerName: 'Orchard Witness Ledger', triadName: 'Rootfire Collection Cell',
        triad: triad(['Rootfire Bailiff', 'Graft Collector', 'Future Broker']),
        petPackName: 'Lower-Line Graft Pack', petNames: ['Cindermaw', 'Graftlynx', 'Ashwing'],
    },
    'Frostfang Village': {
        village: 'Frostfang Village', sourceId: `${WORLD_CRISIS_80_ID}:frostfang:triad`, petSourceId: `${WORLD_CRISIS_80_ID}:frostfang:pets`,
        biome: 'snow', ledgerName: 'Unmarked Witness Ledger', triadName: 'Vault Collection Cell',
        triad: triad(['Vault Bailiff', 'Oath Collector', 'Rhythm Assessor']),
        petPackName: 'Unmarked Pursuit Pack', petNames: ['Rimehound', 'Markbreaker', 'Whiteout Owl'],
    },
    'Moonshadow Village': {
        village: 'Moonshadow Village', sourceId: `${WORLD_CRISIS_80_ID}:moonshadow:triad`, petSourceId: `${WORLD_CRISIS_80_ID}:moonshadow:pets`,
        biome: 'shadow', ledgerName: 'Returned Witness Ledger', triadName: 'Mirror Collection Cell',
        triad: triad(['Mirror Bailiff', 'Confession Collector', 'Archive Assessor']),
        petPackName: 'Black-Glass Retrieval Pack', petNames: ['Glassfang', 'Inkshade', 'Canal Raven'],
    },
};

export function isWorldCrisis80Village(value: unknown): value is WorldCrisis80Village {
    return typeof value === 'string' && (WORLD_CRISIS_80_VILLAGES as readonly string[]).includes(value);
}

export function worldCrisis80EncounterForVillage(village: WorldCrisis80Village): WorldCrisis80EncounterDefinition {
    return WORLD_CRISIS_80_ENCOUNTERS[village];
}

export function worldCrisis80PhaseForProgress(progressPercent: number, resolved = false): WorldCrisis80Phase {
    if (resolved) return 'claims-broken';
    if (progressPercent >= 72) return 'gate-exposed';
    if (progressPercent >= 28) return 'collection-cells';
    return 'witness-signal';
}

export function worldCrisis80PhaseLabel(phase: WorldCrisis80Phase): string {
    if (phase === 'witness-signal') return 'Witness Signal';
    if (phase === 'collection-cells') return 'Collection Cells';
    if (phase === 'gate-exposed') return 'Hollow Gate Exposed';
    return 'Claims Broken';
}
