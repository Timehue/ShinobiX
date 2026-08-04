/**
 * Machine-readable combat entry-point inventory.
 *
 * Keep this list aligned with docs/architecture/combat-runtime-inventory.md.
 * `combat-runtime-inventory.test.mjs` proves that active routes are registered,
 * their handler modules are imported by server.ts, and player-facing routes
 * have an executable client caller. A row may only become `complete` when its
 * target action/state route is also reachable from the listed client surface.
 */
export const COMBAT_RUNTIME_INVENTORY = [
  { mode: 'Casual PvP', startRoute: '/pvp/session', actionRoute: '/pvp/move', stateRoute: '/pvp/session', handler: 'pvp/session', client: ['screens/PvpBattleScreen.tsx'], current: 'pvp', target: 'pvp', status: 'keep' },
  { mode: 'Ranked PvP', startRoute: '/pvp/ranked-queue', actionRoute: '/pvp/move', stateRoute: '/pvp/session', handler: 'pvp/ranked-queue', client: ['screens/Arena.tsx', 'screens/PvpBattleScreen.tsx'], current: 'pvp', target: 'pvp', status: 'keep' },
  { mode: 'Player challenges', startRoute: '/pvp/session', actionRoute: '/pvp/move', stateRoute: '/pvp/session', handler: 'pvp/session', client: ['screens/Arena.tsx', 'screens/PvpBattleScreen.tsx'], current: 'pvp', target: 'pvp', status: 'keep' },

  { mode: 'Generic catalog AI', startRoute: '/missions/ai-fight-start', actionRoute: '/towers/action', stateRoute: '/towers/state', handler: 'missions/ai-fight-start', client: ['components/AiFightHost.tsx', 'lib/ai-fight-api.ts'], current: 'tower-with-local-fallback', target: 'solo-pve', status: 'pending' },
  { mode: 'Temporary or creator AI', startRoute: '/missions/ai-fight-start', actionRoute: null, stateRoute: null, handler: 'missions/ai-fight-start', client: ['components/AiFightHost.tsx', 'lib/ai-fight-api.ts'], current: 'local-compatibility', target: 'preview-only-or-published-solo-pve', status: 'pending' },
  { mode: 'Hunts and apex hunts', startRoute: '/missions/ai-fight-start', actionRoute: '/towers/action', stateRoute: '/towers/state', handler: 'missions/ai-fight-start', client: ['screens/WorldMap.tsx', 'components/AiFightHost.tsx', 'lib/ai-fight-api.ts'], current: 'tower-with-local-fallback', target: 'solo-pve', status: 'pending' },
  { mode: 'Explore ambushes', startRoute: '/missions/ai-fight-start', actionRoute: '/towers/action', stateRoute: '/towers/state', handler: 'missions/ai-fight-start', client: ['screens/Arena.tsx', 'components/AiFightHost.tsx'], current: 'tower-with-local-fallback', target: 'solo-pve', status: 'pending' },
  { mode: 'Village guards and wanderers', startRoute: '/missions/ai-fight-start', actionRoute: '/towers/action', stateRoute: '/towers/state', handler: 'missions/ai-fight-start', client: ['screens/WorldMap.tsx', 'components/AiFightHost.tsx', 'lib/ai-fight-api.ts'], current: 'tower-with-local-fallback', target: 'solo-pve', status: 'pending' },
  { mode: 'E/D combat missions', startRoute: '/missions/ai-fight-start', actionRoute: null, stateRoute: null, handler: 'missions/ai-fight-start', client: ['screens/Arena.tsx', 'screens/Missions.tsx'], current: 'local-client-authority', target: 'solo-pve', status: 'pending' },
  { mode: 'C/B/A/S combat missions', startRoute: '/missions/combat-start', actionRoute: '/towers/action', stateRoute: '/towers/state', handler: 'missions/combat-start', client: ['screens/Missions.tsx'], current: 'tower', target: 'solo-pve', status: 'pending' },
  { mode: 'Academy spar', startRoute: '/story/spar-start', actionRoute: '/towers/action', stateRoute: '/towers/state', handler: 'story/spar-start', client: ['components/StoryBossFightHost.tsx', 'lib/story-combat-api.ts'], current: 'tower', target: 'solo-pve', status: 'pending' },
  { mode: 'Story battles and bosses', startRoute: '/story/boss-start', actionRoute: '/towers/action', stateRoute: '/towers/state', handler: 'story/boss-start', client: ['components/StoryBossFightHost.tsx', 'lib/story-combat-api.ts'], current: 'tower', target: 'solo-pve', status: 'pending' },
  { mode: 'Weekly Boss', startRoute: '/weekly-boss', actionRoute: '/towers/action', stateRoute: '/towers/state', handler: 'weekly-boss', client: ['screens/WeeklyBossArena.tsx', 'screens/WeeklyBossFight.tsx'], current: 'tower-solo-score-attempt', target: 'solo-pve-unless-party-redesign', status: 'decision-required' },
  { mode: 'Endless', startRoute: '/endless/wave-start', actionRoute: '/towers/action', stateRoute: '/towers/state', handler: 'endless/wave-start', client: ['lib/endless-api.ts'], requiresStartCaller: false, current: 'local-client-authority-dead-tower-start', target: 'solo-pve', status: 'pending' },
  { mode: 'Hollow Gate shinobi', startRoute: '/hollow-gate/combat-start', actionRoute: null, stateRoute: null, handler: 'hollow-gate/combat-start', client: ['lib/hollow-gate-combat-api.ts', 'screens/Arena.tsx'], current: 'binding-plus-local-client-authority', target: 'solo-pve', status: 'pending' },
  { mode: 'Hollow Gate pet', startRoute: '/hollow-gate/combat-start', actionRoute: null, stateRoute: null, handler: 'hollow-gate/combat-start', client: ['lib/hollow-gate-combat-api.ts', 'screens/PetArena.tsx'], current: 'pet', target: 'pet', status: 'keep' },

  { mode: 'Battle Towers', startRoute: '/towers/start', actionRoute: '/towers/action', stateRoute: '/towers/state', handler: 'towers/start', client: ['lib/towers-api.ts', 'screens/BattleTowerFight.tsx'], current: 'tower', target: 'tower', status: 'keep' },
  { mode: 'Endless Spire', startRoute: '/towers/start', actionRoute: '/towers/action', stateRoute: '/towers/state', handler: 'towers/start', client: ['lib/towers-api.ts', 'screens/BattleTowerFight.tsx'], current: 'tower-n-actor', target: 'tower', status: 'keep' },
  { mode: 'Clan Boss', startRoute: '/clan-boss/assault-start', actionRoute: '/towers/action', stateRoute: '/towers/state', handler: 'clan-boss/assault-start', client: ['screens/ClanBoss.tsx', 'lib/clan-boss-api.ts'], current: 'tower-party', target: 'tower', status: 'keep' },
  { mode: 'Anbu infiltration', startRoute: '/village/anbu-infiltration', actionRoute: '/village/anbu-infiltration', stateRoute: '/village/anbu-infiltration', handler: 'village/anbu-infiltration', client: ['features/anbuInfiltration/AnbuVaultRaid.tsx', 'lib/anbu-infiltration-api.ts'], current: 'tower-shaped-custom', target: 'audit-participant-model', status: 'decision-required' },
  { mode: 'Sector war shinobi combat', startRoute: '/pvp/session', actionRoute: '/pvp/move', stateRoute: '/pvp/session', handler: 'pvp/session', client: ['screens/WorldMap.tsx', 'screens/PvpBattleScreen.tsx'], current: 'pvp', target: 'pvp', status: 'keep' },
  { mode: 'Sector war card combat', startRoute: '/village/sector-card', actionRoute: '/village/sector-card', stateRoute: '/village/sector-card', handler: 'village/sector-card', client: ['screens/SectorWarCardBattle.tsx'], current: 'card', target: 'card', status: 'keep' },
  { mode: 'Pet Arena and Coliseum', startRoute: '/pet/battle-start', actionRoute: null, stateRoute: null, handler: 'pet/battle-start', client: ['screens/PetArena.tsx'], current: 'pet', target: 'pet', status: 'keep' },
  { mode: 'Card Clash', startRoute: '/card-clash/match', actionRoute: '/card-clash/match', stateRoute: '/card-clash/match', handler: 'card-clash/match', client: ['screens/CardHall.tsx', 'screens/CardClashFreePlay.tsx'], current: 'card', target: 'card', status: 'keep' },
];
