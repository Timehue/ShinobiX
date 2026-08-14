/**
 * Machine-readable combat entry-point inventory.
 *
 * Keep this list aligned with docs/architecture/combat-runtime-inventory.md.
 * `combat-runtime-inventory.test.mjs` proves that active routes are registered,
 * their handler modules are imported by server.ts, and player-facing routes
 * have an executable client caller. A row may only become terminal (`complete`
 * or `migrated`) when its target action/state route is also reachable from the
 * listed client surface.
 */
export const TERMINAL_MIGRATION_STATUSES = Object.freeze(['complete', 'migrated']);

/**
 * World Map AI has two deliberately different entry contracts. Both end in the
 * canonical Solo-PvE runtime, but only the World-context contract lets the
 * server reconstruct runtime-authored opponents and bind world progression.
 * Keep these descriptors machine-readable so those paths cannot be collapsed
 * back into stale "partial" inventory labels.
 */
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

export const COMBAT_RUNTIME_INVENTORY = [
  { mode: 'Casual PvP', startRoute: '/pvp/session', actionRoute: '/pvp/move', stateRoute: '/pvp/session', handler: 'pvp/session', client: ['screens/PvpBattleScreen.tsx'], current: 'pvp', target: 'pvp', status: 'keep' },
  { mode: 'Ranked PvP', startRoute: '/pvp/ranked-queue', actionRoute: '/pvp/move', stateRoute: '/pvp/session', handler: 'pvp/ranked-queue', client: ['screens/Arena.tsx', 'screens/PvpBattleScreen.tsx'], current: 'pvp', target: 'pvp', status: 'keep' },
  { mode: 'Player challenges', startRoute: '/pvp/session', actionRoute: '/pvp/move', stateRoute: '/pvp/session', handler: 'pvp/session', client: ['screens/Arena.tsx', 'screens/PvpBattleScreen.tsx'], current: 'pvp', target: 'pvp', status: 'keep' },

  { mode: 'Generic catalog AI', startRoute: '/missions/ai-fight-start', actionRoute: '/solo-pve/action', stateRoute: '/solo-pve/state', handler: 'missions/ai-fight-start', client: ['components/AiFightHost.tsx', 'lib/ai-fight-api.ts', 'lib/solo-pve-arena-adapter.ts', 'lib/solo-pve-api.ts'], current: 'solo-pve', target: 'solo-pve', status: 'migrated' },
  { mode: 'Temporary or creator AI', startRoute: '/missions/ai-fight-start', actionRoute: '/solo-pve/action', stateRoute: '/solo-pve/state', handler: 'missions/ai-fight-start', client: ['components/AiFightHost.tsx', 'lib/ai-fight-api.ts', 'lib/solo-pve-arena-adapter.ts', 'lib/solo-pve-api.ts'], current: 'published-solo-pve-or-preview-only', target: 'published-solo-pve-or-preview-only', status: 'migrated' },

  { mode: 'World-context hunt trails', ...WORLD_MAP_AI_FLOW_CONTRACTS.worldContext, worldKinds: ['hunt-pack', 'hunt-target'], lifecycleRoute: '/missions/hunt-trail', lifecycleHandler: 'missions/hunt-trail', startRoute: '/missions/ai-fight-start', actionRoute: '/solo-pve/action', stateRoute: '/solo-pve/state', handler: 'missions/ai-fight-start', client: ['screens/HunterBoard.tsx', 'screens/WorldMap.tsx', 'components/AiFightHost.tsx', 'lib/ai-fight-api.ts', 'lib/world-hunt-api.ts', 'lib/solo-pve-arena-adapter.ts', 'lib/solo-pve-api.ts'], current: 'solo-pve', target: 'solo-pve', status: 'migrated' },
  { mode: 'World-context wanderers', ...WORLD_MAP_AI_FLOW_CONTRACTS.worldContext, worldKinds: ['wanderer', 'wanderer-ambush', 'patrol', 'bounty-hunter', 'questbook-boss', 'story-reckoning'], startRoute: '/missions/ai-fight-start', actionRoute: '/solo-pve/action', stateRoute: '/solo-pve/state', handler: 'missions/ai-fight-start', client: ['screens/WorldMap.tsx', 'components/AiFightHost.tsx', 'lib/ai-fight-api.ts', 'lib/solo-pve-arena-adapter.ts', 'lib/solo-pve-api.ts'], current: 'solo-pve', target: 'solo-pve', status: 'migrated' },
  { mode: 'Generic Apex hunts', ...WORLD_MAP_AI_FLOW_CONTRACTS.genericCatalog, catalogSelector: 'apex-ai-*', startRoute: '/missions/ai-fight-start', actionRoute: '/solo-pve/action', stateRoute: '/solo-pve/state', handler: 'missions/ai-fight-start', client: ['screens/HunterBoard.tsx', 'components/AiFightHost.tsx', 'lib/ai-fight-api.ts', 'lib/solo-pve-arena-adapter.ts', 'lib/solo-pve-api.ts'], current: 'solo-pve', target: 'solo-pve', status: 'migrated' },
  { mode: 'Generic explore ambushes', ...WORLD_MAP_AI_FLOW_CONTRACTS.genericCatalog, battleKind: 'explore', startRoute: '/missions/ai-fight-start', actionRoute: '/solo-pve/action', stateRoute: '/solo-pve/state', handler: 'missions/ai-fight-start', client: ['screens/WorldMap.tsx', 'components/AiFightHost.tsx', 'lib/ai-fight-api.ts', 'lib/solo-pve-arena-adapter.ts', 'lib/solo-pve-api.ts'], current: 'solo-pve', target: 'solo-pve', status: 'migrated' },
  { mode: 'Generic village-guard raids', ...WORLD_MAP_AI_FLOW_CONTRACTS.genericCatalog, battleKind: 'raidAi', startRoute: '/missions/ai-fight-start', actionRoute: '/solo-pve/action', stateRoute: '/solo-pve/state', handler: 'missions/ai-fight-start', client: ['screens/WorldMap.tsx', 'components/AiFightHost.tsx', 'lib/ai-fight-api.ts', 'lib/solo-pve-arena-adapter.ts', 'lib/solo-pve-api.ts'], current: 'solo-pve', target: 'solo-pve', status: 'migrated' },
  { mode: 'Dungeon Warden', battleKind: 'dungeon', startProof: 'dungeonRunToken', startRoute: '/missions/ai-fight-start', actionRoute: '/solo-pve/action', stateRoute: '/solo-pve/state', handler: 'missions/ai-fight-start', client: ['App.tsx', 'screens/Dungeon.tsx', 'components/AiFightHost.tsx', 'lib/ai-fight-api.ts', 'lib/solo-pve-arena-adapter.ts', 'lib/solo-pve-api.ts'], current: 'solo-pve', target: 'solo-pve', status: 'migrated' },
  { mode: 'Creator-event practice fights', battleKind: 'practice', rewardPolicy: 'none', startRoute: '/missions/ai-fight-start', actionRoute: '/solo-pve/action', stateRoute: '/solo-pve/state', handler: 'missions/ai-fight-start', client: ['App.tsx', 'screens/WorldMap.tsx', 'components/AiFightHost.tsx', 'lib/ai-fight-api.ts', 'lib/solo-pve-arena-adapter.ts', 'lib/solo-pve-api.ts'], current: 'solo-pve', target: 'solo-pve', status: 'migrated' },
  { mode: 'E/D combat missions', startRoute: '/missions/combat-start', actionRoute: '/solo-pve/action', stateRoute: '/solo-pve/state', handler: 'missions/combat-start', client: ['screens/Missions.tsx', 'lib/solo-pve-api.ts'], current: 'solo-pve', target: 'solo-pve', status: 'migrated' },
  { mode: 'C/B/A/S combat missions', startRoute: '/missions/combat-start', actionRoute: '/solo-pve/action', stateRoute: '/solo-pve/state', handler: 'missions/combat-start', client: ['screens/Missions.tsx', 'lib/solo-pve-api.ts'], current: 'solo-pve', target: 'solo-pve', status: 'migrated' },
  { mode: 'Academy spar', startRoute: '/story/spar-start', actionRoute: '/solo-pve/action', stateRoute: '/solo-pve/state', handler: 'story/spar-start', client: ['components/StoryBossFightHost.tsx', 'lib/story-combat-api.ts', 'lib/solo-pve-api.ts'], current: 'solo-pve', target: 'solo-pve', status: 'migrated' },
  { mode: 'Story battles and bosses', startRoute: '/story/boss-start', actionRoute: '/solo-pve/action', stateRoute: '/solo-pve/state', handler: 'story/boss-start', client: ['components/StoryBossFightHost.tsx', 'lib/story-combat-api.ts', 'lib/solo-pve-api.ts'], current: 'solo-pve', target: 'solo-pve', status: 'migrated' },
  { mode: 'Weekly Boss', startRoute: '/weekly-boss', actionRoute: '/solo-pve/action', stateRoute: '/solo-pve/state', handler: 'weekly-boss', client: ['screens/WeeklyBossArena.tsx', 'screens/WeeklyBossFight.tsx', 'lib/solo-pve-api.ts'], current: 'solo-pve', target: 'solo-pve', status: 'migrated' },
  { mode: 'Endless', startRoute: '/endless/wave-start', actionRoute: '/solo-pve/action', stateRoute: '/solo-pve/state', handler: 'endless/wave-start', client: ['lib/endless-api.ts', 'lib/solo-pve-api.ts'], current: 'solo-pve', target: 'solo-pve', status: 'migrated' },
  { mode: 'Hollow Gate shinobi', startRoute: '/hollow-gate/combat-start', actionRoute: '/solo-pve/action', stateRoute: '/solo-pve/state', handler: 'hollow-gate/combat-start', client: ['lib/hollow-gate-combat-api.ts', 'lib/solo-pve-api.ts', 'screens/Arena.tsx'], current: 'solo-pve', target: 'solo-pve', status: 'migrated' },
  { mode: 'Hollow Gate pet', startRoute: '/hollow-gate/combat-start', actionRoute: null, stateRoute: null, handler: 'hollow-gate/combat-start', client: ['lib/hollow-gate-combat-api.ts', 'screens/PetArena.tsx'], current: 'pet', target: 'pet', status: 'keep' },

  { mode: 'Battle Towers', startRoute: '/towers/start', actionRoute: '/towers/action', stateRoute: '/towers/state', handler: 'towers/start', client: ['lib/towers-api.ts', 'screens/BattleTowerFight.tsx'], current: 'tower', target: 'tower', status: 'keep' },
  { mode: 'Endless Spire', startRoute: '/towers/start', actionRoute: '/towers/action', stateRoute: '/towers/state', handler: 'towers/start', client: ['lib/towers-api.ts', 'screens/BattleTowerFight.tsx'], current: 'tower-n-actor', target: 'tower', status: 'keep' },
  { mode: 'Clan Boss', startRoute: '/clan-boss/assault-start', actionRoute: '/towers/action', stateRoute: '/towers/state', handler: 'clan-boss/assault-start', client: ['screens/ClanBoss.tsx', 'lib/clan-boss-api.ts'], current: 'tower-party', target: 'tower', status: 'keep' },
  { mode: 'Anbu infiltration', startRoute: '/village/anbu-infiltration', actionRoute: '/solo-pve/action', stateRoute: '/village/anbu-infiltration', handler: 'village/anbu-infiltration', client: ['features/anbuInfiltration/AnbuVaultRaid.tsx', 'lib/anbu-infiltration-api.ts', 'lib/solo-pve-arena-adapter.ts', 'lib/solo-pve-api.ts'], current: 'solo-pve', target: 'solo-pve', status: 'migrated' },
  { mode: 'Sector war shinobi combat', startRoute: '/pvp/session', actionRoute: '/pvp/move', stateRoute: '/pvp/session', handler: 'pvp/session', client: ['screens/WorldMap.tsx', 'screens/PvpBattleScreen.tsx'], current: 'pvp', target: 'pvp', status: 'keep' },
  { mode: 'Sector war card combat', startRoute: '/village/sector-card', actionRoute: '/village/sector-card', stateRoute: '/village/sector-card', handler: 'village/sector-card', client: ['screens/SectorWarCardBattle.tsx'], current: 'card', target: 'card', status: 'keep' },
  { mode: 'Pet Arena and Coliseum', startRoute: '/pet/battle-start', actionRoute: null, stateRoute: null, handler: 'pet/battle-start', client: ['screens/PetArena.tsx'], current: 'pet', target: 'pet', status: 'keep' },
  { mode: 'Card Clash', startRoute: '/card-clash/match', actionRoute: '/card-clash/match', stateRoute: '/card-clash/match', handler: 'card-clash/match', client: ['screens/CardHall.tsx', 'screens/CardClashFreePlay.tsx'], current: 'card', target: 'card', status: 'keep' },
];
