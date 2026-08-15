import type { PublicCapabilityId } from './public-capabilities.js';

/**
 * Executable product-mode authority registry.
 *
 * This is deliberately a registry of multiple engines, not an engine-unification
 * layer. `authorityEngine` records the runtime that is mounted today;
 * `intendedAuthorityEngine` is present only when the verified owner boundary is
 * different or an explicitly missing surface already has a selected family.
 */

export const RUNTIME_AUTHORITY_ENGINES = Object.freeze({
    PVP: 'pvp',
    SOLO_PVE: 'solo-pve',
    TOWER: 'tower',
    PET_SHOWDOWN: 'pet-showdown',
    PET_WARFRONT: 'pet-warfront',
    CHRONICLE: 'chronicle',
    PET_GAUNTLET_GRID: 'pet-gauntlet-grid',
    PET_CINEMATIC_DUEL: 'pet-cinematic-duel',
    LEGACY_PET_DUEL: 'legacy-pet-duel',
    CLIENT_LOCAL_PET_DUEL: 'client-local-pet-duel',
} as const);

export type RuntimeAuthorityEngineId = typeof RUNTIME_AUTHORITY_ENGINES[keyof typeof RUNTIME_AUTHORITY_ENGINES];

export const RUNTIME_ORCHESTRATORS = Object.freeze({
    SECTOR_WAR: 'sector-war',
    CLAN_WAR: 'clan-war',
    DUNGEON: 'dungeon',
    HOLLOW_GATE: 'hollow-gate',
} as const);

export type RuntimeOrchestratorId = typeof RUNTIME_ORCHESTRATORS[keyof typeof RUNTIME_ORCHESTRATORS];

export type RuntimeModeCategory =
    | 'shinobi-pvp'
    | 'solo-pve'
    | 'tower'
    | 'pet-showdown'
    | 'pet-tactical'
    | 'pet-legacy'
    | 'card';

export type RuntimeMatchStatus = 'match' | 'defect' | 'surface-gap' | 'staged-mismatch' | 'owner-decision';
export type RuntimeParticipantModel = 'solo' | 'two-player' | 'party' | 'solo-or-party' | 'headless' | 'asynchronous-defense';
export type RuntimeRewardPolicy = 'none' | 'server-progression' | 'server-settled' | 'server-capped' | 'parent-mode-settlement';
export type RuntimeRouteRole =
    | 'start'
    | 'action'
    | 'state'
    | 'settlement'
    | 'lifecycle'
    | 'catalog'
    | 'recovery'
    | 'leaderboard'
    | 'communication'
    | 'observation'
    | 'record';
export type RuntimeMigrationStatus = 'keep' | 'complete' | 'migrated';

export type RuntimeRoute = {
    path: `/${string}`;
    handler: string;
    roles: readonly RuntimeRouteRole[];
    /** False only when a route is intentionally server-internal. */
    clientCallerRequired?: boolean;
};

export const RUNTIME_COMPATIBILITY_KEYS = Object.freeze([
    'flowDescriptor',
    'combatAuthority',
    'launchContract',
    'settlementContract',
    'settlementRoute',
    'settlementHandler',
    'worldKinds',
    'lifecycleRoute',
    'lifecycleHandler',
    'catalogSelector',
    'battleKind',
    'startProof',
] as const);

export type RuntimeCompatibilityKey = typeof RUNTIME_COMPATIBILITY_KEYS[number];
export type RuntimeCompatibilityMetadata = Readonly<{
    flowDescriptor?: 'world-context' | 'generic-catalog';
    combatAuthority?: 'canonical-solo-pve';
    launchContract?: 'identity-only-server-reconstructed' | 'server-published-catalog-profile';
    settlementContract?: 'sealed-world-context-exact-once' | 'sealed-ai-token-exact-once';
    settlementRoute?: `/${string}`;
    settlementHandler?: string;
    worldKinds?: readonly string[];
    lifecycleRoute?: `/${string}`;
    lifecycleHandler?: string;
    catalogSelector?: string;
    battleKind?: 'explore' | 'raidAi' | 'dungeon' | 'practice';
    startProof?: 'dungeonRunToken';
}>;

type RuntimeModeBase = {
    id: string;
    label: string;
    category: RuntimeModeCategory;
    clientEntries: readonly string[];
    routes: readonly RuntimeRoute[];
    participantModel: RuntimeParticipantModel;
    rewardPolicy: RuntimeRewardPolicy;
    replayKind: string;
    capabilityKey?: PublicCapabilityId;
    orchestrationOwner?: RuntimeOrchestratorId;
    intentionallySeparateFrom: readonly RuntimeAuthorityEngineId[];
    statusDetail?: string;
    /** Compatibility only for the retired migration-oriented projection. */
    migrationStatus?: RuntimeMigrationStatus;
    compatibility?: RuntimeCompatibilityMetadata;
};

type MountedRuntimeMode = RuntimeModeBase & {
    authorityEngine: RuntimeAuthorityEngineId;
    intendedAuthorityEngine?: RuntimeAuthorityEngineId;
    status: Exclude<RuntimeMatchStatus, 'surface-gap'>;
};

type MissingSurfaceRuntimeMode = RuntimeModeBase & {
    /** A missing product surface has no mounted gameplay owner. */
    authorityEngine: null;
    /** Its selected family is still explicit so the gap cannot become generic. */
    intendedAuthorityEngine: RuntimeAuthorityEngineId;
    status: 'surface-gap';
};

export type RuntimeMode = MountedRuntimeMode | MissingSurfaceRuntimeMode;
type RuntimeModeInput = RuntimeMode extends infer Mode
    ? Mode extends RuntimeMode ? Omit<Mode, 'intentionallySeparateFrom'> : never
    : never;

export const WORLD_MAP_AI_FLOW_CONTRACTS = Object.freeze({
    worldContext: Object.freeze({
        flowDescriptor: 'world-context',
        combatAuthority: 'canonical-solo-pve',
        launchContract: 'identity-only-server-reconstructed',
        settlementContract: 'sealed-world-context-exact-once',
        settlementRoute: '/missions/report-ai-fight',
        settlementHandler: 'missions/report-ai-fight',
    }),
    genericCatalog: Object.freeze({
        flowDescriptor: 'generic-catalog',
        combatAuthority: 'canonical-solo-pve',
        launchContract: 'server-published-catalog-profile',
        settlementContract: 'sealed-ai-token-exact-once',
        settlementRoute: '/missions/report-ai-fight',
        settlementHandler: 'missions/report-ai-fight',
    }),
});

const E = RUNTIME_AUTHORITY_ENGINES;
const O = RUNTIME_ORCHESTRATORS;

export const INTENTIONAL_ENGINE_SEPARATIONS: Readonly<Record<RuntimeAuthorityEngineId, readonly RuntimeAuthorityEngineId[]>> = Object.freeze({
    [E.PVP]: Object.freeze([E.SOLO_PVE, E.TOWER]),
    [E.SOLO_PVE]: Object.freeze([E.PVP, E.TOWER]),
    [E.TOWER]: Object.freeze([E.PVP, E.SOLO_PVE]),
    [E.PET_SHOWDOWN]: Object.freeze([E.PET_WARFRONT, E.PET_GAUNTLET_GRID, E.PET_CINEMATIC_DUEL, E.LEGACY_PET_DUEL, E.CLIENT_LOCAL_PET_DUEL]),
    [E.PET_WARFRONT]: Object.freeze([E.PET_SHOWDOWN, E.PET_GAUNTLET_GRID, E.PET_CINEMATIC_DUEL, E.LEGACY_PET_DUEL, E.CLIENT_LOCAL_PET_DUEL]),
    [E.CHRONICLE]: Object.freeze([E.PVP, E.SOLO_PVE, E.TOWER, E.PET_SHOWDOWN, E.PET_WARFRONT, E.PET_GAUNTLET_GRID]),
    [E.PET_GAUNTLET_GRID]: Object.freeze([E.PET_SHOWDOWN, E.PET_WARFRONT, E.CHRONICLE, E.PET_CINEMATIC_DUEL, E.LEGACY_PET_DUEL, E.CLIENT_LOCAL_PET_DUEL]),
    [E.PET_CINEMATIC_DUEL]: Object.freeze([E.PET_SHOWDOWN, E.PET_WARFRONT, E.PET_GAUNTLET_GRID, E.LEGACY_PET_DUEL, E.CLIENT_LOCAL_PET_DUEL]),
    [E.LEGACY_PET_DUEL]: Object.freeze([E.PET_SHOWDOWN, E.PET_WARFRONT, E.PET_GAUNTLET_GRID, E.PET_CINEMATIC_DUEL, E.CLIENT_LOCAL_PET_DUEL]),
    [E.CLIENT_LOCAL_PET_DUEL]: Object.freeze([E.PET_SHOWDOWN, E.PET_WARFRONT, E.PET_GAUNTLET_GRID, E.PET_CINEMATIC_DUEL, E.LEGACY_PET_DUEL]),
});

function mountedRoute(path: `/${string}`, handler: string, roles: readonly RuntimeRouteRole[]): RuntimeRoute {
    return Object.freeze({ path, handler, roles: Object.freeze([...roles]) });
}

function deepFreeze<T>(value: T): T {
    if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    return Object.freeze(value);
}

function soloRoutes(
    startPath: `/${string}`,
    startHandler: string,
    settlementPath: `/${string}`,
    settlementHandler: string,
): readonly RuntimeRoute[] {
    const startRoles: readonly RuntimeRouteRole[] = startPath === settlementPath ? ['start', 'settlement'] : ['start'];
    return Object.freeze([
        mountedRoute(startPath, startHandler, startRoles),
        mountedRoute('/solo-pve/action', 'solo-pve/action', ['action']),
        mountedRoute('/solo-pve/state', 'solo-pve/state', ['state']),
        ...(startPath === settlementPath ? [] : [mountedRoute(settlementPath, settlementHandler, ['settlement'])]),
    ]);
}

function defineMode(mode: RuntimeModeInput): RuntimeMode {
    // A staged/defective mode records the engine mounted today separately from
    // the owner it is meant to use. Mode-level separation policy therefore
    // follows the intended owner when one is declared; otherwise a defect could
    // claim it is intentionally separate from the very engine selected to fix it.
    const separationOwner = mode.intendedAuthorityEngine ?? mode.authorityEngine;
    if (separationOwner == null) throw new Error(`${mode.id}: a mounted or intended authority engine is required`);
    return deepFreeze({
        ...mode,
        clientEntries: [...mode.clientEntries],
        routes: [...mode.routes],
        ...(mode.compatibility ? { compatibility: { ...mode.compatibility } } : {}),
        intentionallySeparateFrom: INTENTIONAL_ENGINE_SEPARATIONS[separationOwner],
    });
}

const SOLO_CLIENT = ['lib/solo-pve-api.ts', 'lib/solo-pve-arena-adapter.ts'] as const;
const PVP_CLIENT = ['screens/PvpBattleScreen.tsx', 'lib/pvp-combat-log-api.ts', 'lib/pvp-reward-claim.ts'] as const;

function pvpRuntimeRoutes(sessionRoles: readonly RuntimeRouteRole[] = ['start', 'state']): readonly RuntimeRoute[] {
    return [
        mountedRoute('/pvp/session', 'pvp/session', sessionRoles),
        mountedRoute('/pvp/move', 'pvp/move', ['action']),
        mountedRoute('/pvp/chat', 'pvp/chat', ['communication']),
        mountedRoute('/pvp/spectate', 'pvp/spectate', ['lifecycle', 'observation']),
        mountedRoute('/pvp/stream', 'pvp/stream', ['state', 'observation']),
        mountedRoute('/pvp/combat-log', 'pvp/combat-log', ['record']),
        mountedRoute('/pvp/combat-history', 'pvp/combat-history', ['record']),
        mountedRoute('/pvp/claim-rewards', 'pvp/claim-rewards', ['settlement']),
    ];
}

export const RUNTIME_MODE_REGISTRY: readonly RuntimeMode[] = Object.freeze([
    defineMode({
        id: 'casual-pvp', label: 'Casual PvP', category: 'shinobi-pvp', authorityEngine: E.PVP,
        clientEntries: ['screens/Arena.tsx', ...PVP_CLIENT],
        routes: pvpRuntimeRoutes(),
        participantModel: 'two-player', rewardPolicy: 'none', replayKind: 'durable-pvp-history', status: 'match', migrationStatus: 'keep',
    }),
    defineMode({
        id: 'direct-pvp-challenges', label: 'Player challenges', category: 'shinobi-pvp', authorityEngine: E.PVP,
        clientEntries: ['App.tsx', 'screens/Arena.tsx', ...PVP_CLIENT],
        routes: [
            mountedRoute('/player/challenge', 'player/challenge', ['lifecycle']),
            ...pvpRuntimeRoutes(),
        ],
        participantModel: 'two-player', rewardPolicy: 'none', replayKind: 'durable-pvp-history', status: 'match', migrationStatus: 'keep',
    }),
    defineMode({
        id: 'ranked-shinobi-pvp', label: 'Ranked PvP', category: 'shinobi-pvp', authorityEngine: E.PVP,
        clientEntries: ['screens/Arena.tsx', 'screens/HallOfLegends.tsx', 'lib/player-ranked-authority.ts', 'lib/pvp-reward-claim.ts', ...PVP_CLIENT],
        routes: [
            mountedRoute('/pvp/ranked-queue', 'pvp/ranked-queue', ['start']),
            mountedRoute('/ranked-season', 'ranked-season', ['leaderboard', 'record']),
            ...pvpRuntimeRoutes(['state']),
        ],
        participantModel: 'two-player', rewardPolicy: 'server-settled', replayKind: 'durable-pvp-history', status: 'match', migrationStatus: 'keep',
    }),
    defineMode({
        id: 'village-guard-pvp-human', label: 'Village Guard human challenge', category: 'shinobi-pvp', authorityEngine: E.PVP,
        clientEntries: ['screens/WorldMap.tsx', ...PVP_CLIENT],
        routes: [
            mountedRoute('/village-guard/challenge', 'village-guard/challenge', ['lifecycle']),
            ...pvpRuntimeRoutes(),
        ],
        participantModel: 'two-player', rewardPolicy: 'server-settled', replayKind: 'durable-pvp-history-plus-expiring-defense-marker', status: 'match',
    }),
    defineMode({
        id: 'kage-succession-pvp', label: 'Kage succession duel', category: 'shinobi-pvp', authorityEngine: E.PVP,
        clientEntries: ['App.tsx', 'screens/TownHall.tsx', ...PVP_CLIENT],
        routes: [
            mountedRoute('/village/kage-challenge', 'village/kage-challenge', ['lifecycle', 'settlement']),
            ...pvpRuntimeRoutes(),
        ],
        participantModel: 'two-player', rewardPolicy: 'server-settled', replayKind: 'durable-pvp-history-plus-succession-record', status: 'match',
    }),
    defineMode({
        id: 'clan-war-pvp-1v1', label: 'Clan War shinobi PvP 1v1', category: 'shinobi-pvp', authorityEngine: E.PVP,
        orchestrationOwner: O.CLAN_WAR,
        clientEntries: ['App.tsx', 'lib/clan-war-api.ts', ...PVP_CLIENT],
        routes: [
            mountedRoute('/clan/war/challenge', 'clan/war/challenge', ['lifecycle']),
            ...pvpRuntimeRoutes(),
            mountedRoute('/clan/war/report', 'clan/war/report', ['settlement']),
        ],
        participantModel: 'two-player', rewardPolicy: 'server-settled', replayKind: 'durable-pvp-history', status: 'match',
    }),
    defineMode({
        id: 'clan-war-pvp-2v2', label: 'Clan War shinobi PvP 2v2', category: 'shinobi-pvp', authorityEngine: null,
        intendedAuthorityEngine: E.PVP, orchestrationOwner: O.CLAN_WAR,
        clientEntries: ['App.tsx', 'lib/clan-war-api.ts'],
        routes: [mountedRoute('/clan/war/challenge', 'clan/war/challenge', ['lifecycle'])],
        participantModel: 'party', rewardPolicy: 'none', replayKind: 'none', status: 'surface-gap',
        statusDetail: 'The challenge is admitted, but the client explicitly refuses launch until a safe aggregate 2v2 protocol exists.',
    }),

    defineMode({
        id: 'generic-catalog-ai', label: 'Generic catalog AI', category: 'solo-pve', authorityEngine: E.SOLO_PVE,
        clientEntries: ['components/AiFightHost.tsx', 'lib/ai-fight-api.ts', ...SOLO_CLIENT],
        routes: soloRoutes('/missions/ai-fight-start', 'missions/ai-fight-start', '/missions/report-ai-fight', 'missions/report-ai-fight'),
        participantModel: 'solo', rewardPolicy: 'server-settled', replayKind: 'expiring-solo-session-log', status: 'match', migrationStatus: 'migrated',
    }),
    defineMode({
        id: 'temporary-creator-ai', label: 'Temporary or creator AI', category: 'solo-pve', authorityEngine: E.SOLO_PVE,
        clientEntries: ['components/AiFightHost.tsx', 'lib/ai-fight-api.ts', ...SOLO_CLIENT],
        routes: soloRoutes('/missions/ai-fight-start', 'missions/ai-fight-start', '/missions/report-ai-fight', 'missions/report-ai-fight'),
        participantModel: 'solo', rewardPolicy: 'none', replayKind: 'expiring-solo-session-log', status: 'match', migrationStatus: 'migrated',
    }),
    defineMode({
        id: 'world-context-hunt-trails', label: 'World-context hunt trails', category: 'solo-pve', authorityEngine: E.SOLO_PVE,
        clientEntries: ['screens/HunterBoard.tsx', 'screens/WorldMap.tsx', 'components/AiFightHost.tsx', 'lib/ai-fight-api.ts', 'lib/world-hunt-api.ts', ...SOLO_CLIENT],
        routes: [...soloRoutes('/missions/ai-fight-start', 'missions/ai-fight-start', '/missions/report-ai-fight', 'missions/report-ai-fight'), mountedRoute('/missions/hunt-trail', 'missions/hunt-trail', ['lifecycle'])],
        participantModel: 'solo', rewardPolicy: 'server-settled', replayKind: 'expiring-solo-session-log', status: 'match', migrationStatus: 'migrated',
        compatibility: { ...WORLD_MAP_AI_FLOW_CONTRACTS.worldContext, worldKinds: ['hunt-pack', 'hunt-target'], lifecycleRoute: '/missions/hunt-trail', lifecycleHandler: 'missions/hunt-trail' },
    }),
    defineMode({
        id: 'world-context-wanderers', label: 'World-context wanderers', category: 'solo-pve', authorityEngine: E.SOLO_PVE,
        clientEntries: ['screens/WorldMap.tsx', 'components/AiFightHost.tsx', 'lib/ai-fight-api.ts', ...SOLO_CLIENT],
        routes: soloRoutes('/missions/ai-fight-start', 'missions/ai-fight-start', '/missions/report-ai-fight', 'missions/report-ai-fight'),
        participantModel: 'solo', rewardPolicy: 'server-settled', replayKind: 'expiring-solo-session-log', status: 'match', migrationStatus: 'migrated',
        compatibility: { ...WORLD_MAP_AI_FLOW_CONTRACTS.worldContext, worldKinds: ['wanderer', 'wanderer-ambush', 'patrol', 'bounty-hunter', 'questbook-boss', 'story-reckoning'] },
    }),
    defineMode({
        id: 'generic-apex-hunts', label: 'Generic Apex hunts', category: 'solo-pve', authorityEngine: E.SOLO_PVE,
        clientEntries: ['screens/HunterBoard.tsx', 'components/AiFightHost.tsx', 'lib/ai-fight-api.ts', ...SOLO_CLIENT],
        routes: soloRoutes('/missions/ai-fight-start', 'missions/ai-fight-start', '/missions/report-ai-fight', 'missions/report-ai-fight'),
        participantModel: 'solo', rewardPolicy: 'server-settled', replayKind: 'expiring-solo-session-log', status: 'match', migrationStatus: 'migrated',
        compatibility: { ...WORLD_MAP_AI_FLOW_CONTRACTS.genericCatalog, catalogSelector: 'apex-ai-*' },
    }),
    defineMode({
        id: 'generic-explore-ambushes', label: 'Generic explore ambushes', category: 'solo-pve', authorityEngine: E.SOLO_PVE,
        clientEntries: ['screens/WorldMap.tsx', 'components/AiFightHost.tsx', 'lib/ai-fight-api.ts', ...SOLO_CLIENT],
        routes: soloRoutes('/missions/ai-fight-start', 'missions/ai-fight-start', '/missions/report-ai-fight', 'missions/report-ai-fight'),
        participantModel: 'solo', rewardPolicy: 'server-settled', replayKind: 'expiring-solo-session-log', status: 'match', migrationStatus: 'migrated',
        compatibility: { ...WORLD_MAP_AI_FLOW_CONTRACTS.genericCatalog, battleKind: 'explore' },
    }),
    defineMode({
        id: 'generic-village-guard-raids', label: 'Generic village-guard raids', category: 'solo-pve', authorityEngine: E.SOLO_PVE,
        clientEntries: ['screens/WorldMap.tsx', 'components/AiFightHost.tsx', 'lib/ai-fight-api.ts', 'lib/ai-raid-api.ts', ...SOLO_CLIENT],
        routes: [
            mountedRoute('/missions/raid-start', 'missions/raid-start', ['lifecycle']),
            ...soloRoutes('/missions/ai-fight-start', 'missions/ai-fight-start', '/missions/report-ai-fight', 'missions/report-ai-fight'),
        ],
        participantModel: 'solo', rewardPolicy: 'server-settled', replayKind: 'expiring-solo-session-log', status: 'match', migrationStatus: 'migrated',
        compatibility: { ...WORLD_MAP_AI_FLOW_CONTRACTS.genericCatalog, battleKind: 'raidAi' },
    }),
    defineMode({
        id: 'creator-event-practice', label: 'Creator-event practice fights', category: 'solo-pve', authorityEngine: E.SOLO_PVE,
        clientEntries: ['App.tsx', 'screens/WorldMap.tsx', 'components/AiFightHost.tsx', 'lib/ai-fight-api.ts', ...SOLO_CLIENT],
        routes: soloRoutes('/missions/ai-fight-start', 'missions/ai-fight-start', '/missions/report-ai-fight', 'missions/report-ai-fight'),
        participantModel: 'solo', rewardPolicy: 'none', replayKind: 'expiring-solo-session-log', status: 'match', migrationStatus: 'migrated',
        compatibility: { battleKind: 'practice' },
    }),
    defineMode({
        id: 'combat-missions-ed', label: 'E/D combat missions', category: 'solo-pve', authorityEngine: E.SOLO_PVE,
        clientEntries: ['screens/Missions.tsx', 'screens/MissionArenaFight.tsx', 'lib/mission-combat-claim.ts', 'lib/pve-outcome-api.ts', ...SOLO_CLIENT],
        routes: [
            ...soloRoutes('/missions/combat-start', 'missions/combat-start', '/missions/queue-combat-claim', 'missions/queue-combat-claim'),
            mountedRoute('/pve/fight-outcome', 'pve/fight-outcome', ['settlement']),
        ],
        participantModel: 'solo', rewardPolicy: 'server-settled', replayKind: 'expiring-solo-session-log', status: 'match', migrationStatus: 'migrated',
    }),
    defineMode({
        id: 'combat-missions-cbas', label: 'C/B/A/S combat missions', category: 'solo-pve', authorityEngine: E.SOLO_PVE,
        clientEntries: ['screens/Missions.tsx', 'screens/MissionArenaFight.tsx', 'lib/mission-combat-claim.ts', 'lib/pve-outcome-api.ts', ...SOLO_CLIENT],
        routes: [
            ...soloRoutes('/missions/combat-start', 'missions/combat-start', '/missions/queue-combat-claim', 'missions/queue-combat-claim'),
            mountedRoute('/pve/fight-outcome', 'pve/fight-outcome', ['settlement']),
        ],
        participantModel: 'solo', rewardPolicy: 'server-settled', replayKind: 'expiring-solo-session-log', status: 'match', migrationStatus: 'migrated',
    }),
    defineMode({
        id: 'story-battles', label: 'Story battles and bosses', category: 'solo-pve', authorityEngine: E.SOLO_PVE,
        clientEntries: ['components/StoryBossFightHost.tsx', 'lib/story-combat-api.ts', 'lib/pve-outcome-api.ts', ...SOLO_CLIENT],
        routes: [
            ...soloRoutes('/story/boss-start', 'story/boss-start', '/story/settle', 'story/settle'),
            mountedRoute('/pve/fight-outcome', 'pve/fight-outcome', ['settlement']),
        ],
        participantModel: 'solo', rewardPolicy: 'server-settled', replayKind: 'expiring-solo-session-log', status: 'match', migrationStatus: 'migrated',
    }),
    defineMode({
        id: 'academy-spar', label: 'Academy spar', category: 'solo-pve', authorityEngine: E.SOLO_PVE,
        clientEntries: ['components/StoryBossFightHost.tsx', 'lib/story-combat-api.ts', 'lib/pve-outcome-api.ts', ...SOLO_CLIENT],
        routes: [
            ...soloRoutes('/story/spar-start', 'story/spar-start', '/story/settle', 'story/settle'),
            mountedRoute('/pve/fight-outcome', 'pve/fight-outcome', ['settlement']),
        ],
        participantModel: 'solo', rewardPolicy: 'server-settled', replayKind: 'expiring-solo-session-log', status: 'match', migrationStatus: 'migrated',
    }),
    defineMode({
        id: 'dungeon-warden', label: 'Dungeon Warden', category: 'solo-pve', authorityEngine: E.SOLO_PVE,
        orchestrationOwner: O.DUNGEON,
        clientEntries: ['App.tsx', 'components/AiFightHost.tsx', 'lib/ai-fight-api.ts', 'lib/dungeon-api.ts', ...SOLO_CLIENT],
        routes: [...soloRoutes('/missions/ai-fight-start', 'missions/ai-fight-start', '/missions/report-ai-fight', 'missions/report-ai-fight'), mountedRoute('/dungeon/run', 'dungeon/run', ['settlement'])],
        participantModel: 'solo', rewardPolicy: 'parent-mode-settlement', replayKind: 'expiring-solo-session-log', status: 'match', migrationStatus: 'migrated',
        compatibility: { battleKind: 'dungeon', startProof: 'dungeonRunToken' },
    }),
    defineMode({
        id: 'weekly-boss', label: 'Weekly Boss', category: 'solo-pve', authorityEngine: E.SOLO_PVE,
        clientEntries: ['screens/WeeklyBossArena.tsx', 'screens/WeeklyBossFight.tsx', ...SOLO_CLIENT],
        routes: soloRoutes('/weekly-boss', 'weekly-boss', '/weekly-boss', 'weekly-boss'),
        participantModel: 'solo', rewardPolicy: 'server-capped', replayKind: 'expiring-solo-session-log', status: 'match', migrationStatus: 'migrated',
    }),
    defineMode({
        id: 'endless', label: 'Endless', category: 'solo-pve', authorityEngine: E.SOLO_PVE,
        clientEntries: ['lib/endless-api.ts', ...SOLO_CLIENT],
        routes: soloRoutes('/endless/wave-start', 'endless/wave-start', '/endless/run', 'endless/run'),
        participantModel: 'solo', rewardPolicy: 'server-settled', replayKind: 'expiring-run-and-session', status: 'match', migrationStatus: 'migrated',
    }),
    defineMode({
        id: 'hollow-gate-shinobi', label: 'Hollow Gate shinobi', category: 'solo-pve', authorityEngine: E.SOLO_PVE,
        orchestrationOwner: O.HOLLOW_GATE,
        clientEntries: ['lib/hollow-gate-combat-api.ts', ...SOLO_CLIENT, 'screens/Arena.tsx'],
        routes: soloRoutes('/hollow-gate/combat-start', 'hollow-gate/combat-start', '/hollow-gate/combat-settle', 'hollow-gate/combat-settle'),
        participantModel: 'solo', rewardPolicy: 'parent-mode-settlement', replayKind: 'expiring-run-and-session', status: 'match', migrationStatus: 'migrated',
    }),
    defineMode({
        id: 'anbu-infiltration', label: 'Anbu infiltration', category: 'solo-pve', authorityEngine: E.SOLO_PVE,
        capabilityKey: 'anbuInfiltration',
        clientEntries: ['features/anbuInfiltration/AnbuVaultRaid.tsx', 'lib/anbu-infiltration-api.ts', ...SOLO_CLIENT],
        routes: [
            mountedRoute('/village/anbu-infiltration', 'village/anbu-infiltration', ['start', 'state', 'settlement', 'lifecycle']),
            mountedRoute('/solo-pve/action', 'solo-pve/action', ['action']),
            mountedRoute('/solo-pve/state', 'solo-pve/state', ['state']),
        ],
        participantModel: 'solo', rewardPolicy: 'server-settled', replayKind: 'expiring-run-and-session-with-receipt', status: 'match', migrationStatus: 'migrated',
    }),

    defineMode({
        id: 'battle-towers', label: 'Battle Towers', category: 'tower', authorityEngine: E.TOWER,
        clientEntries: ['lib/towers-api.ts', 'components/TowerReadyRoomPanel.tsx', 'screens/BattleTowerFight.tsx'],
        routes: [
            mountedRoute('/towers/floors', 'towers/floors', ['catalog']),
            mountedRoute('/towers/party', 'towers/party', ['lifecycle']),
            mountedRoute('/towers/join', 'towers/join', ['lifecycle', 'recovery']),
            mountedRoute('/towers/start', 'towers/start', ['start']),
            mountedRoute('/towers/action', 'towers/action', ['action']),
            mountedRoute('/towers/state', 'towers/state', ['state']),
            mountedRoute('/towers/settle', 'towers/settle', ['settlement']),
            mountedRoute('/towers/my-run', 'towers/my-run', ['recovery', 'state']),
        ],
        participantModel: 'solo-or-party', rewardPolicy: 'server-settled', replayKind: 'expiring-tower-run-and-log', status: 'match', migrationStatus: 'keep',
    }),
    defineMode({
        id: 'tower-party', label: 'Tower party', category: 'tower', authorityEngine: E.TOWER,
        clientEntries: ['lib/towers-api.ts', 'components/TowerReadyRoomPanel.tsx', 'screens/BattleTowerFight.tsx'],
        routes: [
            mountedRoute('/towers/floors', 'towers/floors', ['catalog']),
            mountedRoute('/towers/party', 'towers/party', ['lifecycle']),
            mountedRoute('/towers/join', 'towers/join', ['lifecycle', 'recovery']),
            mountedRoute('/towers/start', 'towers/start', ['start']),
            mountedRoute('/towers/action', 'towers/action', ['action']),
            mountedRoute('/towers/state', 'towers/state', ['state']),
            mountedRoute('/towers/settle', 'towers/settle', ['settlement']),
            mountedRoute('/towers/my-run', 'towers/my-run', ['recovery', 'state']),
        ],
        participantModel: 'party', rewardPolicy: 'server-settled', replayKind: 'expiring-tower-run-and-log', status: 'match',
    }),
    defineMode({
        id: 'endless-spire', label: 'Endless Spire', category: 'tower', authorityEngine: E.TOWER,
        clientEntries: ['lib/towers-api.ts', 'components/TowerReadyRoomPanel.tsx', 'screens/BattleTowerFight.tsx'],
        routes: [
            mountedRoute('/towers/party', 'towers/party', ['lifecycle']),
            mountedRoute('/towers/join', 'towers/join', ['lifecycle', 'recovery']),
            mountedRoute('/towers/start', 'towers/start', ['start']),
            mountedRoute('/towers/action', 'towers/action', ['action']),
            mountedRoute('/towers/state', 'towers/state', ['state']),
            mountedRoute('/towers/settle', 'towers/settle', ['settlement']),
            mountedRoute('/towers/my-run', 'towers/my-run', ['recovery', 'state']),
            mountedRoute('/towers/spire-leaderboard', 'towers/spire-leaderboard', ['leaderboard']),
        ],
        participantModel: 'party', rewardPolicy: 'server-capped', replayKind: 'expiring-tower-run-and-log', status: 'match', migrationStatus: 'keep',
    }),
    defineMode({
        id: 'clan-boss', label: 'Clan Boss', category: 'tower', authorityEngine: E.TOWER,
        capabilityKey: 'clanBoss',
        clientEntries: ['screens/ClanBoss.tsx', 'lib/clan-boss-api.ts', 'lib/towers-api.ts'],
        routes: [
            mountedRoute('/clan-boss/get', 'clan-boss/get', ['state', 'leaderboard']),
            mountedRoute('/clan-boss/party', 'clan-boss/party', ['lifecycle', 'communication']),
            mountedRoute('/towers/join', 'towers/join', ['lifecycle', 'recovery']),
            mountedRoute('/clan-boss/assault-start', 'clan-boss/assault-start', ['start']),
            mountedRoute('/towers/action', 'towers/action', ['action']),
            mountedRoute('/towers/state', 'towers/state', ['state']),
            mountedRoute('/towers/my-run', 'towers/my-run', ['recovery', 'state']),
            mountedRoute('/clan-boss/assault-settle', 'clan-boss/assault-settle', ['settlement']),
        ],
        participantModel: 'solo-or-party', rewardPolicy: 'server-settled', replayKind: 'expiring-tower-session-and-aggregate-standings', status: 'match', migrationStatus: 'keep',
    }),
    defineMode({
        id: 'tower-pvp', label: 'Tower PvP', category: 'tower', authorityEngine: E.TOWER,
        clientEntries: ['lib/tower-pvp-api.ts', 'components/TowerPvpPanel.tsx'],
        routes: [
            mountedRoute('/towers/pvp-queue', 'towers/pvp-queue', ['start']),
            mountedRoute('/towers/pvp-action', 'towers/pvp-action', ['action']),
            mountedRoute('/towers/pvp-state', 'towers/pvp-state', ['state']),
            mountedRoute('/towers/pvp-settle', 'towers/pvp-settle', ['settlement']),
        ],
        participantModel: 'party', rewardPolicy: 'none', replayKind: 'bounded-terminal-command-ring', status: 'match',
    }),

    defineMode({
        id: 'sector-war-shinobi-human', label: 'Sector war shinobi combat', category: 'shinobi-pvp', authorityEngine: E.PVP,
        orchestrationOwner: O.SECTOR_WAR, capabilityKey: 'villageWar',
        clientEntries: ['lib/village-war-map.ts', 'screens/WorldMap.tsx', ...PVP_CLIENT],
        routes: [
            ...pvpRuntimeRoutes(),
            mountedRoute('/village/sector-war', 'village/sector-war', ['lifecycle', 'settlement']),
        ],
        participantModel: 'two-player', rewardPolicy: 'server-settled', replayKind: 'durable-pvp-history-plus-contest-receipt', status: 'match', migrationStatus: 'keep',
    }),
    defineMode({
        id: 'sector-war-shinobi-garrison', label: 'Sector War shinobi garrison fallback', category: 'shinobi-pvp', authorityEngine: E.TOWER,
        intendedAuthorityEngine: E.PVP, orchestrationOwner: O.SECTOR_WAR, capabilityKey: 'villageWar',
        clientEntries: ['lib/village-war-map.ts'],
        routes: [mountedRoute('/village/sector-war', 'village/sector-war', ['start', 'settlement'])],
        participantModel: 'headless', rewardPolicy: 'server-settled', replayKind: 'contest-receipt-only', status: 'defect',
        statusDetail: 'The Combat victory condition settles territory contribution from a Tower-backed garrison instead of the required PvP owner.',
    }),
    defineMode({
        id: 'village-war-mercenary', label: 'Village-War mercenary battle', category: 'tower', authorityEngine: E.TOWER,
        orchestrationOwner: O.SECTOR_WAR, capabilityKey: 'villageWar',
        clientEntries: ['lib/village-war-map.ts', 'lib/merc-ai.ts', 'lib/merc-roam-client.ts'],
        routes: [
            mountedRoute('/village/war-merc', 'village/war-merc', ['start', 'state', 'settlement']),
            mountedRoute('/sector/merc-roam', 'sector/merc-roam', ['start', 'state', 'settlement']),
        ],
        participantModel: 'headless', rewardPolicy: 'server-settled', replayKind: 'contest-receipt-only', status: 'match',
    }),
    defineMode({
        id: 'sector-war-card', label: 'Sector war card combat', category: 'card', authorityEngine: E.CHRONICLE,
        orchestrationOwner: O.SECTOR_WAR, capabilityKey: 'villageWar',
        clientEntries: ['screens/SectorWarCardBattle.tsx'],
        routes: [mountedRoute('/village/sector-card', 'village/sector-card', ['start', 'action', 'state', 'settlement'])],
        participantModel: 'two-player', rewardPolicy: 'server-settled', replayKind: 'expiring-chronicle-projection', status: 'match', migrationStatus: 'keep',
    }),
    defineMode({
        id: 'sector-war-pet', label: 'Sector war pet combat', category: 'pet-showdown', authorityEngine: E.PET_SHOWDOWN,
        orchestrationOwner: O.SECTOR_WAR, capabilityKey: 'villageWar',
        clientEntries: ['screens/SectorWarPetBattle.tsx', 'lib/village-war-map.ts'],
        routes: [mountedRoute('/village/sector-pet', 'village/sector-pet', ['start', 'state', 'settlement'])],
        participantModel: 'two-player', rewardPolicy: 'server-settled', replayKind: 'derived-showdown-script', status: 'match',
    }),

    defineMode({
        id: 'clan-war-tilecards', label: 'Clan War Tile Cards', category: 'card', authorityEngine: E.CHRONICLE,
        orchestrationOwner: O.CLAN_WAR,
        clientEntries: ['screens/ClanWarTileCardDuel.tsx', 'lib/clan-war-api.ts'],
        routes: [
            mountedRoute('/clan/war/challenge', 'clan/war/challenge', ['lifecycle']),
            mountedRoute('/clan/war/tilecards', 'clan/war/tilecards', ['start', 'action', 'state', 'settlement']),
        ],
        participantModel: 'two-player', rewardPolicy: 'server-settled', replayKind: 'expiring-chronicle-projection', status: 'match',
    }),
    defineMode({
        id: 'clan-war-pet', label: 'Clan War pet 1v1 and 2v2', category: 'pet-showdown', authorityEngine: E.PET_SHOWDOWN,
        orchestrationOwner: O.CLAN_WAR,
        clientEntries: ['App.tsx', 'screens/ClanWarPetBattle.tsx', 'lib/clan-war-pet-api.ts', 'lib/clan-war-api.ts'],
        routes: [
            mountedRoute('/clan/war/challenge', 'clan/war/challenge', ['lifecycle']),
            mountedRoute('/clan/war/pet', 'clan/war/pet', ['start', 'state', 'settlement']),
        ],
        participantModel: 'party', rewardPolicy: 'server-settled', replayKind: 'derived-showdown-script', status: 'match',
    }),

    defineMode({
        id: 'pet-showdown-practice', label: 'Pet Showdown practice', category: 'pet-showdown', authorityEngine: E.PET_SHOWDOWN,
        clientEntries: ['screens/PetShowdown.tsx', 'lib/pet-showdown-api.ts'],
        routes: [mountedRoute('/pet/showdown', 'pet/showdown', ['start', 'action', 'state', 'settlement'])],
        participantModel: 'solo', rewardPolicy: 'none', replayKind: 'expiring-showdown-turn-script', status: 'match',
    }),
    defineMode({
        id: 'pet-coliseum', label: 'Pet Coliseum', category: 'pet-showdown', authorityEngine: E.PET_SHOWDOWN,
        clientEntries: ['screens/PetShowdown.tsx', 'lib/pet-showdown-api.ts'],
        routes: [mountedRoute('/pet/showdown', 'pet/showdown', ['start', 'action', 'state', 'settlement'])],
        participantModel: 'solo', rewardPolicy: 'server-capped', replayKind: 'expiring-showdown-turn-script', status: 'match',
    }),
    defineMode({
        id: 'pet-ladder-showdown', label: 'Pet Ladder Showdown', category: 'pet-showdown', authorityEngine: E.PET_SHOWDOWN,
        clientEntries: ['lib/pet-ladder-client.ts', 'screens/HallOfLegends.tsx'],
        routes: [mountedRoute('/pet-ladder', 'pet-ladder/ladder', ['start', 'state', 'settlement'])],
        participantModel: 'asynchronous-defense', rewardPolicy: 'server-settled', replayKind: 'returned-showdown-script', status: 'match',
    }),
    defineMode({
        id: 'pet-warfront', label: 'Pet Warfront', category: 'pet-tactical', authorityEngine: E.PET_WARFRONT,
        clientEntries: ['screens/PetArena.tsx'],
        routes: [
            mountedRoute('/pet/warfront-start', 'pet/warfront-start', ['start', 'state']),
            mountedRoute('/pet/battle-result', 'pet/battle-result', ['settlement']),
        ],
        participantModel: 'solo', rewardPolicy: 'server-capped', replayKind: 'sealed-warfront-presentation-replay', status: 'match',
    }),
    defineMode({
        id: 'tactical-arena', label: 'Tactical Arena', category: 'pet-tactical', authorityEngine: null,
        intendedAuthorityEngine: E.PET_WARFRONT,
        clientEntries: ['screens/PetArena.tsx'], routes: [],
        participantModel: 'solo', rewardPolicy: 'none', replayKind: 'none', status: 'surface-gap',
        statusDetail: 'The standalone Tactical product lifecycle is absent; the mounted solo positional tab is Warfront. Warfront-family reuse remains allowed.',
    }),
    defineMode({
        id: 'coop-tactical-arena', label: 'Co-op Tactical Arena', category: 'pet-tactical', authorityEngine: E.PET_WARFRONT,
        clientEntries: ['components/ArenaCoopLobby.tsx', 'screens/PetArena.tsx'],
        routes: [mountedRoute('/arena/lobby', 'arena/lobby', ['start', 'state', 'lifecycle'])],
        participantModel: 'party', rewardPolicy: 'none', replayKind: 'client-warfront-replay-from-server-sealed-inputs', status: 'match',
    }),
    defineMode({
        id: 'pet-ladder-warfront', label: 'Pet Ladder Warfront', category: 'pet-tactical', authorityEngine: E.PET_WARFRONT,
        clientEntries: ['lib/pet-ladder-client.ts', 'screens/HallOfLegends.tsx'],
        routes: [mountedRoute('/pet-ladder', 'pet-ladder/ladder', ['start', 'state', 'settlement'])],
        participantModel: 'asynchronous-defense', rewardPolicy: 'server-settled', replayKind: 'returned-warfront-replay', status: 'match',
    }),
    defineMode({
        id: 'pet-gauntlet', label: 'Pet Gauntlet', category: 'pet-tactical', authorityEngine: E.PET_GAUNTLET_GRID,
        clientEntries: ['components/PetGauntlet.tsx', 'lib/pet-gauntlet-api.ts', 'screens/PetArena.tsx'],
        routes: [mountedRoute('/pet/gauntlet', 'pet/gauntlet', ['start', 'state', 'settlement'])],
        participantModel: 'solo', rewardPolicy: 'server-capped', replayKind: 'server-replayed-decision-transcript-and-receipt', status: 'match',
    }),

    defineMode({
        id: 'pet-arena-ai-1v1', label: 'Pet Arena AI 1v1', category: 'pet-legacy', authorityEngine: E.PET_CINEMATIC_DUEL,
        clientEntries: ['screens/PetArena.tsx'],
        routes: [
            mountedRoute('/pet/battle-start', 'pet/battle-start', ['start', 'state']),
            mountedRoute('/pet/battle-result', 'pet/battle-result', ['settlement']),
        ],
        participantModel: 'solo', rewardPolicy: 'server-capped', replayKind: 'server-replayed-cinematic-input-log-with-receipt', status: 'match',
    }),
    defineMode({
        id: 'pet-arena-ai-2v2', label: 'Pet Arena AI 2v2', category: 'pet-legacy', authorityEngine: E.PET_CINEMATIC_DUEL,
        clientEntries: ['screens/PetArena.tsx'],
        routes: [
            mountedRoute('/pet/battle-start', 'pet/battle-start', ['start', 'state']),
            mountedRoute('/pet/battle-result', 'pet/battle-result', ['settlement']),
        ],
        participantModel: 'solo', rewardPolicy: 'server-capped', replayKind: 'server-replayed-cinematic-input-log-with-receipt', status: 'match',
    }),
    defineMode({
        id: 'pet-arena-pvp-1v1', label: 'Pet Arena PvP 1v1', category: 'pet-legacy', authorityEngine: E.LEGACY_PET_DUEL,
        clientEntries: ['App.tsx', 'screens/Arena.tsx', 'screens/PetArena.tsx'],
        routes: [
            mountedRoute('/player/challenge', 'player/challenge', ['lifecycle']),
            mountedRoute('/pet/battle-start', 'pet/battle-start', ['start', 'state']),
            mountedRoute('/pet/battle-result', 'pet/battle-result', ['settlement']),
        ],
        participantModel: 'two-player', rewardPolicy: 'server-capped', replayKind: 'server-sealed-legacy-outcome-with-client-cinematic-presentation', status: 'defect',
        statusDetail: 'Settlement seals the legacy pet-duel simulation while the mounted client presents the cinematic duel, so the displayed and rewarded outcomes can diverge.',
    }),
    defineMode({
        id: 'pet-arena-pvp-2v2', label: 'Pet Arena PvP 2v2', category: 'pet-legacy', authorityEngine: E.LEGACY_PET_DUEL,
        clientEntries: ['App.tsx', 'screens/Arena.tsx', 'screens/PetArena.tsx'],
        routes: [
            mountedRoute('/player/challenge', 'player/challenge', ['lifecycle']),
            mountedRoute('/pet/battle-start', 'pet/battle-start', ['start', 'state']),
            mountedRoute('/pet/battle-result', 'pet/battle-result', ['settlement']),
        ],
        participantModel: 'two-player', rewardPolicy: 'server-capped', replayKind: 'server-sealed-legacy-outcome-with-client-cinematic-presentation', status: 'defect',
        statusDetail: 'Settlement seals the legacy pet-party simulation while the mounted client presents the cinematic party duel, so the displayed and rewarded outcomes can diverge.',
    }),
    defineMode({
        id: 'pet-ranked-legacy', label: 'Pet ranked', category: 'pet-legacy', authorityEngine: E.LEGACY_PET_DUEL,
        intendedAuthorityEngine: E.PET_SHOWDOWN,
        clientEntries: ['App.tsx', 'screens/Arena.tsx', 'screens/PetArena.tsx', 'screens/HallOfLegends.tsx', 'lib/pet-ladder-queue.ts'],
        routes: [
            mountedRoute('/pvp/pet-ranked-queue', 'pvp/pet-ranked-queue', ['lifecycle']),
            mountedRoute('/ranked-season', 'ranked-season', ['leaderboard', 'record']),
            mountedRoute('/pet/ranked-start', 'pet/ranked-start', ['start', 'state']),
            mountedRoute('/pet/battle-result', 'pet/battle-result', ['settlement']),
        ],
        participantModel: 'two-player', rewardPolicy: 'server-settled', replayKind: 'sealed-legacy-cinematic-inputs', status: 'staged-mismatch',
        statusDetail: 'The mounted ranked start/result path still imports legacy pet authority while a Showdown implementation is staged.',
    }),
    defineMode({
        id: 'hollow-gate-pet-legacy', label: 'Hollow Gate pet', category: 'pet-legacy', authorityEngine: E.LEGACY_PET_DUEL,
        orchestrationOwner: O.HOLLOW_GATE,
        clientEntries: ['lib/hollow-gate-combat-api.ts', 'screens/PetArena.tsx'],
        routes: [
            mountedRoute('/hollow-gate/combat-start', 'hollow-gate/combat-start', ['lifecycle']),
            mountedRoute('/pet/battle-start', 'pet/battle-start', ['start', 'state']),
            mountedRoute('/pet/battle-result', 'pet/battle-result', ['lifecycle']),
            mountedRoute('/hollow-gate/combat-settle', 'hollow-gate/combat-settle', ['settlement']),
        ],
        participantModel: 'solo', rewardPolicy: 'parent-mode-settlement', replayKind: 'sealed-legacy-cinematic-inputs-and-run-receipt', status: 'owner-decision', migrationStatus: 'keep',
        statusDetail: 'The mounted caller uses the legacy duel while a Showdown Hollow Gate branch also exists; cutover ownership remains unresolved.',
    }),
    defineMode({
        id: 'dungeon-pet-client-local', label: 'Dungeon pet', category: 'pet-legacy', authorityEngine: E.CLIENT_LOCAL_PET_DUEL,
        orchestrationOwner: O.DUNGEON,
        clientEntries: ['screens/Dungeon.tsx', 'lib/dungeon-api.ts'],
        routes: [mountedRoute('/dungeon/run', 'dungeon/run', ['settlement'])],
        participantModel: 'solo', rewardPolicy: 'parent-mode-settlement', replayKind: 'client-presentation-only', status: 'defect',
        statusDetail: 'The rewarding parent settlement consumes no server-selected pet encounter or terminal pet proof.',
    }),

    defineMode({
        id: 'card-clash-freeplay', label: 'Card Clash', category: 'card', authorityEngine: E.CHRONICLE,
        clientEntries: ['screens/CardClashFreePlay.tsx', 'lib/free-play-queue-client.ts'],
        routes: [
            mountedRoute('/card-clash/queue', 'card-clash/queue', ['start', 'lifecycle']),
            mountedRoute('/card-clash/match', 'card-clash/match', ['action', 'state', 'settlement']),
        ],
        participantModel: 'two-player', rewardPolicy: 'server-progression', replayKind: 'expiring-chronicle-projection', status: 'match', migrationStatus: 'keep',
    }),
    defineMode({
        id: 'card-clash-ai', label: 'Card Clash AI', category: 'card', authorityEngine: E.CHRONICLE,
        clientEntries: ['screens/CardClashDuel.tsx', 'lib/chronicle-duel.ts'],
        routes: [
            mountedRoute('/card-clash/ai-start', 'card-clash/ai-start', ['start']),
            mountedRoute('/card-clash/ai-move', 'card-clash/ai-move', ['action', 'state', 'settlement']),
        ],
        participantModel: 'solo', rewardPolicy: 'server-capped', replayKind: 'expiring-chronicle-projection', status: 'match',
    }),
    defineMode({
        id: 'dungeon-card', label: 'Dungeon Card seal', category: 'card', authorityEngine: E.CHRONICLE,
        orchestrationOwner: O.DUNGEON,
        clientEntries: ['screens/Dungeon.tsx', 'screens/CardClashDuel.tsx', 'lib/chronicle-duel.ts', 'lib/dungeon-api.ts'],
        routes: [
            mountedRoute('/card-clash/ai-start', 'card-clash/ai-start', ['start']),
            mountedRoute('/card-clash/ai-move', 'card-clash/ai-move', ['action', 'state']),
            mountedRoute('/dungeon/run', 'dungeon/run', ['settlement']),
        ],
        participantModel: 'solo', rewardPolicy: 'parent-mode-settlement', replayKind: 'expiring-chronicle-projection', status: 'defect',
        statusDetail: 'Chronicle owns the fight, but the rewarding dungeon settlement does not consume its terminal proof.',
    }),
]);

export function runtimeModeById(id: string): RuntimeMode | undefined {
    return RUNTIME_MODE_REGISTRY.find((mode) => mode.id === id);
}
