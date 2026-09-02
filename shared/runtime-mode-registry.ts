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

export type RuntimeTransport = {
    /** Non-HTTP gameplay transport mounted alongside Express. */
    kind: 'socket.io';
    /** Stable event-family marker rather than one event pretending to be a route. */
    channel: `${string}:*`;
    /** Path relative to api/, without the TypeScript extension. */
    serverHandler: string;
    /** Path relative to shinobij.client/src/. */
    clientAdapter: string;
    roles: readonly RuntimeRouteRole[];
    persistence: 'memory-only' | 'durable';
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
    transports?: readonly RuntimeTransport[];
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

function socketTransport(
    channel: `${string}:*`,
    serverHandler: string,
    clientAdapter: string,
    roles: readonly RuntimeRouteRole[],
    persistence: RuntimeTransport['persistence'],
): RuntimeTransport {
    return Object.freeze({
        kind: 'socket.io',
        channel,
        serverHandler,
        clientAdapter,
        roles: Object.freeze([...roles]),
        persistence,
    });
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
        transports: [...(mode.transports ?? [])],
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
        id: 'clan-war-pvp-2v2', label: 'Clan War shinobi PvP 2v2', category: 'shinobi-pvp', authorityEngine: E.TOWER,
        intendedAuthorityEngine: E.PVP, orchestrationOwner: O.CLAN_WAR,
        clientEntries: [
            'App.tsx', 'lib/clan-war-api.ts', 'lib/clan-war-2v2-api.ts', 'screens/ClanWar2v2Battle.tsx',
            // The fight itself is issued through the shared Tower MPvP transport.
            'lib/tower-pvp-api.ts',
        ],
        routes: [
            mountedRoute('/clan/war/challenge', 'clan/war/challenge', ['lifecycle']),
            mountedRoute('/clan/war/pvp-2v2', 'clan/war/pvp-2v2', ['start', 'settlement']),
            mountedRoute('/towers/pvp-action', 'towers/pvp-action', ['action']),
            mountedRoute('/towers/pvp-state', 'towers/pvp-state', ['state']),
        ],
        participantModel: 'party', rewardPolicy: 'server-settled', replayKind: 'bounded-terminal-command-ring', status: 'match',
        statusDetail: 'Runs on the four-player Tower MPvP engine with teams fixed by clan rather than skill-balanced. The engine writes no rewards; api/clan/war/_mpvp-settlement.ts applies the war HP under a durable exactly-once receipt, so the shared open-queue surface stays progression-free. DISABLE_CLAN_WAR_PVP_2V2=1 re-closes progression while leaving cleanup available.',
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
        id: 'world-context-village-crisis', label: 'World-context village crisis', category: 'solo-pve', authorityEngine: E.SOLO_PVE,
        clientEntries: ['screens/WorldCrisis.tsx', 'lib/world-crisis.ts', 'components/AiFightHost.tsx', 'lib/ai-fight-api.ts', ...SOLO_CLIENT],
        routes: [
            ...soloRoutes('/missions/ai-fight-start', 'missions/ai-fight-start', '/missions/report-ai-fight', 'missions/report-ai-fight'),
            mountedRoute('/world-crisis', 'world-crisis', ['lifecycle', 'observation']),
        ],
        participantModel: 'solo', rewardPolicy: 'server-settled', replayKind: 'expiring-solo-session-log-plus-global-crisis-ledger', status: 'match', migrationStatus: 'migrated',
        compatibility: { ...WORLD_MAP_AI_FLOW_CONTRACTS.worldContext, worldKinds: ['world-crisis'], lifecycleRoute: '/world-crisis', lifecycleHandler: 'world-crisis' },
    }),
    defineMode({
        id: 'world-context-hollow-gate-triad', label: 'Hollow Gate Reckoning shinobi 1v3', category: 'tower', authorityEngine: E.TOWER,
        clientEntries: ['screens/WorldCrisis80.tsx', 'screens/BattleTowerFight.tsx', 'lib/world-crisis-80.ts', 'lib/towers-api.ts'],
        routes: [
            mountedRoute('/world-crisis-80', 'world-crisis-80', ['lifecycle', 'observation']),
            mountedRoute('/world-crisis-80/combat-start', 'world-crisis-80/combat-start', ['start']),
            mountedRoute('/towers/action', 'towers/action', ['action']),
            mountedRoute('/towers/state', 'towers/state', ['state']),
            mountedRoute('/world-crisis-80/combat-settle', 'world-crisis-80/combat-settle', ['settlement']),
        ],
        participantModel: 'solo', rewardPolicy: 'parent-mode-settlement', replayKind: 'expiring-tower-run-plus-global-crisis-proof', status: 'match',
        statusDetail: 'The Tower N-actor engine runs one player against a server-sealed three-role Collection Cell. Terminal Tower outcome is the only input accepted by the exact-once global village ledger; the event pays no duplicate combat rewards.',
    }),
    defineMode({
        id: 'world-context-hollow-gate-pets', label: 'Hollow Gate Reckoning companion 3v3', category: 'pet-showdown', authorityEngine: E.PET_SHOWDOWN,
        clientEntries: ['screens/WorldCrisis80.tsx', 'components/PetShowdownBattle.tsx', 'lib/world-crisis-80.ts'],
        routes: [
            mountedRoute('/world-crisis-80', 'world-crisis-80', ['lifecycle', 'observation']),
            mountedRoute('/pet/showdown', 'pet/showdown', ['start', 'action', 'state', 'settlement']),
        ],
        participantModel: 'party', rewardPolicy: 'parent-mode-settlement', replayKind: 'expiring-showdown-turn-script-plus-global-crisis-proof', status: 'match',
        statusDetail: 'Exactly three ready carried companions face a server-built three-member pursuit pack. Showdown is reward-ineligible here; its terminal session ID is consumed once by the same global village ledger as the shinobi front.',
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
        id: 'ranked-2v2', label: 'Ranked 2v2', category: 'shinobi-pvp', authorityEngine: E.TOWER,
        intendedAuthorityEngine: E.PVP,
        // You pair with ONE partner, then the pair queues against another pair,
        // so teams are a fact of who chose to play together. Runs the shared
        // four-player session on the canonical PvP grid; the engine writes no
        // rating — api/pvp/_ranked-2v2-settlement.ts owns the ladder, which is
        // what keeps the open Team Arena unrated while sharing the same board.
        clientEntries: [
            'lib/ranked-2v2-api.ts', 'components/Ranked2v2Panel.tsx',
            'features/arena/components/ArenaDistrictLobby.tsx', 'lib/tower-pvp-api.ts',
        ],
        routes: [
            mountedRoute('/pvp/ranked-2v2', 'pvp/ranked-2v2', ['lifecycle', 'start', 'settlement']),
            mountedRoute('/towers/pvp-action', 'towers/pvp-action', ['action']),
            mountedRoute('/towers/pvp-state', 'towers/pvp-state', ['state']),
        ],
        participantModel: 'party', rewardPolicy: 'server-settled', replayKind: 'bounded-terminal-command-ring', status: 'match',
        statusDetail: 'Duo-queue ladder on its own ranked2v2Rating, separate from solo ranked. Elo is computed once from the two TEAM ratings sealed at match time and applied to both members of each side; a cancelled match rates nobody. Settlement is exactly-once per match via a durable per-save receipt.',
    }),

    defineMode({
        id: 'tower-pvp', label: 'Team Arena 2v2', category: 'tower', authorityEngine: E.TOWER,
        // Lives in the BATTLE ARENA, not the Towers lobby: the Towers are the
        // co-op PvE climb. It keeps the tower engine because that is what puts
        // four fighters on the canonical PvP grid, and keeps its route/mode ids
        // so stored matches and leases stay readable.
        clientEntries: [
            'lib/tower-pvp-api.ts', 'components/TowerPvpPanel.tsx',
            'components/TeamArenaSection.tsx', 'features/arena/components/BattleArenaLobby.tsx',
        ],
        routes: [
            mountedRoute('/towers/pvp-queue', 'towers/pvp-queue', ['start']),
            mountedRoute('/towers/pvp-action', 'towers/pvp-action', ['action']),
            mountedRoute('/towers/pvp-state', 'towers/pvp-state', ['state']),
            mountedRoute('/towers/pvp-settle', 'towers/pvp-settle', ['settlement']),
        ],
        participantModel: 'party', rewardPolicy: 'none', replayKind: 'bounded-terminal-command-ring', status: 'match',
    }),

    // The open-world sector raid: attacking a live player standing in your own
    // wild sector, off the "Players Here" panel. Distinct from
    // sector-war-shinobi-human below, which is the village CONTEST (capabilityKey
    // 'villageWar'); this one needs no war and no clan, and its authority is pure
    // co-located presence — api/pvp/session.ts stamps rewardAuthority 'world' only
    // when the server itself sees both fighters in the claimed sector.
    defineMode({
        id: 'world-sector-player-raid', label: 'Open-world sector raid', category: 'shinobi-pvp', authorityEngine: E.PVP,
        clientEntries: ['App.tsx', 'screens/WorldMap.tsx', 'components/WorldSectorCommandPanel.tsx', 'lib/world-attack-claim.ts', 'lib/village-war-map.ts', ...PVP_CLIENT],
        routes: [
            ...pvpRuntimeRoutes(),
            mountedRoute('/player/attack', 'player/attack', ['lifecycle']),
            mountedRoute('/player/clear-attack', 'player/clear-attack', ['lifecycle']),
            mountedRoute('/player/challenge', 'player/challenge', ['lifecycle']),
        ],
        participantModel: 'two-player', rewardPolicy: 'server-settled', replayKind: 'durable-pvp-history', status: 'match', migrationStatus: 'keep',
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
        id: 'sector-war-shinobi-garrison', label: 'Sector War shinobi garrison fallback', category: 'shinobi-pvp', authorityEngine: E.PVP,
        orchestrationOwner: O.SECTOR_WAR, capabilityKey: 'villageWar',
        clientEntries: ['lib/village-war-map.ts', 'lib/sector-war-garrison-api.ts', 'screens/VillageWarMap.tsx', 'screens/SectorWarGarrisonAssault.tsx', ...SOLO_CLIENT],
        routes: [
            mountedRoute('/village/sector-war', 'village/sector-war', ['start', 'state', 'settlement', 'lifecycle']),
            mountedRoute('/solo-pve/action', 'solo-pve/action', ['action']),
            mountedRoute('/solo-pve/state', 'solo-pve/state', ['state']),
        ],
        participantModel: 'solo', rewardPolicy: 'server-settled', replayKind: 'expiring-solo-session-log-plus-contest-receipt', status: 'match',
        statusDetail: 'The wrong-owner Tower fallback (resolveMercBattle/sealTowerFighter) stays retired. The garrison is resolved on the Solo PvE runtime over a sealed snapshot of the defending village\'s real ANBU (api/_sector-war-garrison-encounter.ts, api/_anbu-infiltration-store.ts) — content, not a live second participant — same shape as Anbu Infiltration. Its OUTCOME still feeds the sector-war contest\'s own scored points under api/village/sector-war.ts\'s lock (garrison-start/garrison-resolve), which is why this mode is labeled pvp: sector-war orchestration, not the underlying simulation engine, is what makes it the contest\'s authority.',
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
        id: 'pet-wanderer-showdown', label: 'Natural sector pet wanderer', category: 'pet-showdown', authorityEngine: E.PET_SHOWDOWN,
        clientEntries: ['screens/WorldMap.tsx', 'screens/PetArena.tsx', 'data/pet-arena-opponents.ts'],
        routes: [
            mountedRoute('/pet/battle-start', 'pet/battle-start', ['start', 'recovery']),
            mountedRoute('/pet/battle-result', 'pet/battle-result', ['settlement']),
        ],
        participantModel: 'solo', rewardPolicy: 'none', replayKind: 'immutable-returned-showdown-script', status: 'match',
        statusDetail: 'The server reconstructs the exact current natural roster slot and presence, seals one NX Showdown script/outcome, then commits the wanderer cooldown. Settlement retires the proof without Coliseum progression.',
    }),
    defineMode({
        id: 'pet-coliseum', label: 'Pet Coliseum', category: 'pet-showdown', authorityEngine: E.PET_SHOWDOWN,
        clientEntries: ['screens/PetArena.tsx', 'screens/PetShowdown.tsx', 'lib/pet-showdown-api.ts'],
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
        id: 'pet-arena-ai-1v1', label: 'Pet Arena AI 1v1 (retired)', category: 'pet-legacy', authorityEngine: null,
        intendedAuthorityEngine: E.PET_CINEMATIC_DUEL,
        clientEntries: ['screens/PetArena.tsx'], routes: [],
        participantModel: 'solo', rewardPolicy: 'none', replayKind: 'none', status: 'surface-gap',
        statusDetail: 'New user-picked cinematic AI admission is retired fail-closed. The separate issued-token compatibility row owns exact recovery and settlement of an already-active pre-cutover seal; paid Pet Coliseum progression belongs only to Showdown.',
    }),
    defineMode({
        id: 'pet-arena-ai-2v2', label: 'Pet Arena AI 2v2 (retired)', category: 'pet-legacy', authorityEngine: null,
        intendedAuthorityEngine: E.PET_CINEMATIC_DUEL,
        clientEntries: ['screens/PetArena.tsx'], routes: [],
        participantModel: 'solo', rewardPolicy: 'none', replayKind: 'none', status: 'surface-gap',
        statusDetail: 'New user-picked cinematic AI admission is retired fail-closed. The separate issued-token compatibility row owns exact recovery and settlement of an already-active pre-cutover seal; paid Pet Coliseum progression belongs only to Showdown.',
    }),
    defineMode({
        id: 'pet-arena-ai-issued-token-compat', label: 'Pet Arena AI issued-token compatibility', category: 'pet-legacy', authorityEngine: E.PET_CINEMATIC_DUEL,
        clientEntries: ['screens/PetArena.tsx'],
        routes: [
            mountedRoute('/pet/battle-start', 'pet/battle-start', ['recovery']),
            mountedRoute('/pet/battle-result', 'pet/battle-result', ['settlement']),
        ],
        participantModel: 'solo', rewardPolicy: 'server-capped', replayKind: 'server-replayed-cinematic-input-log-with-receipt', status: 'match',
        statusDetail: 'Compatibility only: /pet/battle-start may recover one exact active pre-cutover token whose settlement policy is unmarked, and /pet/battle-result may settle that sealed cinematic replay with exact receipt semantics. There is no new start admission; context-free attempts fail closed.',
    }),
    defineMode({
        id: 'pet-arena-pvp-1v1', label: 'Pet Arena live PvP 1v1', category: 'pet-legacy', authorityEngine: E.PET_CINEMATIC_DUEL,
        clientEntries: ['screens/PetArena.tsx', 'components/PetDuelLiveHost.tsx', 'lib/pet-duel-transport.ts'],
        routes: [],
        transports: [socketTransport('petduel:*', '_realtime/pet-duel-socket', 'lib/pet-duel-transport.ts', ['start', 'action', 'state', 'settlement'], 'memory-only')],
        participantModel: 'two-player', rewardPolicy: 'none', replayKind: 'memory-only-server-replayed-lockstep-cinematic-log', status: 'match',
    }),
    defineMode({
        id: 'pet-arena-pvp-2v2', label: 'Pet Arena live PvP 2v2', category: 'pet-legacy', authorityEngine: E.PET_CINEMATIC_DUEL,
        clientEntries: ['screens/PetArena.tsx', 'components/PetDuelLiveHost.tsx', 'lib/pet-duel-transport.ts'],
        routes: [],
        transports: [socketTransport('petduel:*', '_realtime/pet-duel-socket', 'lib/pet-duel-transport.ts', ['start', 'action', 'state', 'settlement'], 'memory-only')],
        participantModel: 'two-player', rewardPolicy: 'none', replayKind: 'memory-only-server-replayed-lockstep-cinematic-log', status: 'match',
    }),
    defineMode({
        id: 'pet-ranked-live', label: 'Pet ranked live queue', category: 'pet-showdown', authorityEngine: E.PET_SHOWDOWN,
        clientEntries: [
            'screens/PetLadder.tsx', 'components/PetLadderQueuePanel.tsx',
            'lib/pet-ranked-queue-api.ts', 'lib/pet-ranked-watch-api.ts',
        ],
        routes: [
            mountedRoute('/pvp/pet-ranked-queue', 'pvp/pet-ranked-queue', ['lifecycle']),
            mountedRoute('/pet/ranked-start', 'pet/ranked-start', ['start']),
            mountedRoute('/pet/ranked-watch', 'pet/ranked-watch', ['state', 'observation']),
            mountedRoute('/pet/battle-result', 'pet/battle-result', ['settlement']),
        ],
        participantModel: 'two-player', rewardPolicy: 'server-settled', replayKind: 'derived-showdown-script', status: 'match',
        statusDetail: 'The queue produces only a reciprocal pairing. resolveRankedPetDuel is the single resolution: /pet/ranked-watch re-derives it for BOTH players and settlement rates that same derivation, so the fight on screen is the rated fight. DISABLE_PET_RANKED_QUEUE=1 closes matchmaking; DISABLE_PET_RANKED_SERVER_V1=1 closes the whole mode.',
    }),
    defineMode({
        id: 'pet-ranked-legacy-compat', label: 'Pet ranked legacy compatibility challenge', category: 'pet-legacy', authorityEngine: E.LEGACY_PET_DUEL,
        clientEntries: ['screens/Arena.tsx', 'screens/PetArena.tsx'],
        routes: [
            mountedRoute('/player/challenge', 'player/challenge', ['lifecycle']),
            mountedRoute('/pet/ranked-start', 'pet/ranked-start', ['start', 'state']),
            mountedRoute('/pet/battle-result', 'pet/battle-result', ['settlement']),
        ],
        participantModel: 'two-player', rewardPolicy: 'server-settled', replayKind: 'sealed-legacy-ranked-outcome-and-receipt', status: 'defect',
        statusDetail: 'New rankedPet challenge creation is retired fail-closed. Retained notices/start tokens/results remain recoverable, but the client displays runPetDuelCinematic while settlement replays legacy runPetDuel, so a retained compatibility notice can display a winner that the server rejects. The current Pet Ladder queue does not enter this path.',
    }),
    defineMode({
        id: 'hollow-gate-pet-cinematic', label: 'Hollow Gate pet', category: 'pet-legacy', authorityEngine: E.PET_CINEMATIC_DUEL,
        orchestrationOwner: O.HOLLOW_GATE,
        clientEntries: ['lib/hollow-gate-combat-api.ts', 'screens/PetArena.tsx'],
        routes: [
            mountedRoute('/hollow-gate/combat-start', 'hollow-gate/combat-start', ['lifecycle']),
            mountedRoute('/pet/battle-start', 'pet/battle-start', ['start', 'state']),
            mountedRoute('/pet/battle-result', 'pet/battle-result', ['lifecycle']),
            mountedRoute('/hollow-gate/combat-settle', 'hollow-gate/combat-settle', ['settlement']),
        ],
        participantModel: 'solo', rewardPolicy: 'parent-mode-settlement', replayKind: 'server-replayed-cinematic-input-log-and-parent-run-receipt', status: 'owner-decision', migrationStatus: 'keep',
        statusDetail: 'Current execution preselects one exact cinematic proof in the parent binding; duplicate starts reuse it and parent settlement accepts only its versioned engine/proof receipt. New Hollow Gate Showdown admission and adoption of unbound legacy Showdown siblings fail closed; a legacy parent may recover only the unique exact active same-player/run cinematic child. That compatibility is not a second live authority. The long-term replatform choice remains owner-controlled.',
    }),
    defineMode({
        id: 'dungeon-pet-cinematic', label: 'Dungeon pet', category: 'pet-legacy', authorityEngine: E.PET_CINEMATIC_DUEL,
        orchestrationOwner: O.DUNGEON,
        clientEntries: ['screens/Dungeon.tsx', 'lib/dungeon-pet-authority.ts', 'lib/dungeon-api.ts'],
        routes: [
            mountedRoute('/pet/battle-start', 'pet/battle-start', ['start', 'state']),
            mountedRoute('/pet/battle-result', 'pet/battle-result', ['settlement']),
            mountedRoute('/dungeon/run', 'dungeon/run', ['settlement']),
        ],
        participantModel: 'solo', rewardPolicy: 'parent-mode-settlement', replayKind: 'server-replayed-cinematic-input-log-and-parent-run-receipt', status: 'match',
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
        id: 'echoes-of-war', label: 'Echoes of War campaign', category: 'card', authorityEngine: E.CHRONICLE,
        clientEntries: ['screens/EchoesOfWar.tsx', 'screens/CardClashDuel.tsx', 'lib/chronicle-duel.ts'],
        routes: [
            mountedRoute('/card-clash/ai-start', 'card-clash/ai-start', ['start']),
            mountedRoute('/card-clash/ai-move', 'card-clash/ai-move', ['action', 'state', 'settlement']),
        ],
        participantModel: 'solo', rewardPolicy: 'server-settled', replayKind: 'expiring-chronicle-projection', status: 'match',
        statusDetail: 'The Celestial Tower Chronicle Showdown story campaign. ai-start seals the encounter (fixed opponent deck + difficulty from api/card-clash/_echoes-catalog.ts) after a floor-unlock check; the ai-move settle mutation pays Chronicle Points from the sealed definition under the standard per-session replay receipt, so duplicate settles and client-supplied rewards are both inert.',
    }),
    defineMode({
        id: 'dungeon-card', label: 'Dungeon Card seal', category: 'card', authorityEngine: E.CHRONICLE,
        orchestrationOwner: O.DUNGEON,
        clientEntries: ['screens/Dungeon.tsx', 'screens/CardClashDuel.tsx', 'lib/chronicle-duel.ts', 'lib/dungeon-api.ts'],
        routes: [
            mountedRoute('/card-clash/ai-start', 'card-clash/ai-start', ['start']),
            mountedRoute('/card-clash/ai-move', 'card-clash/ai-move', ['action', 'state', 'settlement']),
            mountedRoute('/dungeon/run', 'dungeon/run', ['settlement']),
        ],
        participantModel: 'solo', rewardPolicy: 'parent-mode-settlement', replayKind: 'expiring-chronicle-projection-and-parent-run-proof-receipt', status: 'match',
    }),
]);

export function runtimeModeById(id: string): RuntimeMode | undefined {
    return RUNTIME_MODE_REGISTRY.find((mode) => mode.id === id);
}
