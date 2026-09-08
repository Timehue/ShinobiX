/** Explicit handler registration for the Railway server.
 * The server retains middleware, the dual-path adapter, health and lifecycle.
 * Import order matches the original handler block, including the three startup
 * helpers re-exported below so module initialization keeps its original order.
 */
import saveHandler       from './api/save/[name].js';
import heartbeatHandler  from './api/player/heartbeat.js';
import travelHandler     from './api/player/travel.js';
import challengeHandler  from './api/player/challenge.js';
import playerBlocksHandler from './api/player/blocks.js';
import friendsHandler    from './api/player/friends.js';
import attackHandler     from './api/player/attack.js';
import sleeperKillHandler from './api/player/sleeper-kill.js';
import clearAttackHandler from './api/player/clear-attack.js';
import healHandler       from './api/player/heal.js';
import cafeteriaHandler  from './api/player/cafeteria.js';
import academyNarrativeHandler from './api/player/academy-narrative.js';
import rosterHandler     from './api/player/roster.js';
import playerLeaderboardsHandler from './api/player/leaderboards.js';
import playerTradeHandler from './api/player/trade.js';
import playerActivitySpineHandler from './api/player/activity-spine.js';
import playerCapabilitiesHandler from './api/player/capabilities.js';
import playerAccountStatusHandler from './api/player/account-status.js';
import dailyLoginHandler  from './api/player/daily-login.js';
import blackMarketHandler from './api/festival/black-market.js';
import sunscarFestivalHandler from './api/festival/sunscar.js';
import pvpSessionHandler from './api/pvp/session.js';
import pvpMoveHandler    from './api/pvp/move.js';
import imagesHandler     from './api/images.js';
import imgHandler        from './api/img.js';
import playerAuthHandler from './api/player-auth.js';
import adminAuthHandler  from './api/admin-auth.js';
import adminPlayersHandler from './api/admin/players.js';
import adminGrantSubscriptionHandler from './api/admin/grant-subscription.js';
import adminGrantItemHandler from './api/admin/grant-item.js';
import adminPlayerIndexHealthHandler from './api/admin/player-index-health.js';
import adminRuntimeModeCapabilitiesHandler from './api/admin/runtime-mode-capabilities.js';
import serverResetHandler from './api/admin/server-reset.js';
import adminRankedSeasonHandler from './api/admin/ranked-season.js';
import adminContentPublishHandler from './api/admin/content-publish.js';
import clansListHandler  from './api/clans/list.js';
import chatHandler       from './api/village/chat.js';
import guardQueueHandler from './api/village-guard/queue.js';
import guardDequeueHandler from './api/village-guard/dequeue.js';
import guardListHandler  from './api/village-guard/list.js';
import guardChallengeHandler from './api/village-guard/challenge.js';
import generateImageHandler from './api/generate-image.js';
import gameStateHandler    from './api/game-state.js';
import worldStateHandler   from './api/world-state.js';
import { seedHomeSectorOwnership } from './api/world-state.js';
import { villageWarMapEnabled } from './api/_release-flags.js';
import messagesHandler     from './api/messages.js';
import reportHandler       from './api/report.js';
import perfBeaconHandler   from './api/perf-beacon.js';
import kageHandler         from './api/village/kage.js';
import kageChallengeHandler from './api/village/kage-challenge.js';
import villageWarDebuffHandler from './api/village/war-debuff.js';
import bloodlineReviewHandler from './api/admin/bloodline-review.js';
import itemReviewHandler   from './api/admin/item-review.js';
import bloodlinesListHandler from './api/bloodlines/list.js';
import kvProxyHandler     from './api/kv-proxy.js';
import migrateKvHandler   from './api/admin/migrate-kv.js';
import migrateToBaseHandler from './api/admin/migrate-to-base.js';
import migrateImagesToR2Handler from './api/admin/migrate-images-to-r2.js';
import raidStartHandler   from './api/missions/raid-start.js';
import towersFloorsHandler from './api/towers/floors.js';
import towersStartHandler  from './api/towers/start.js';
import towersActionHandler from './api/towers/action.js';
import towersStateHandler  from './api/towers/state.js';
import towersSettleHandler from './api/towers/settle.js';
import towersMyRunHandler  from './api/towers/my-run.js';
import towersJoinHandler   from './api/towers/join.js';
import towersPartyHandler  from './api/towers/party.js';
import towersSpireLeaderboardHandler from './api/towers/spire-leaderboard.js';
import towersPvpQueueHandler from './api/towers/pvp-queue.js';
import towersPvpStateHandler from './api/towers/pvp-state.js';
import towersPvpActionHandler from './api/towers/pvp-action.js';
import towersPvpSettleHandler from './api/towers/pvp-settle.js';
import expeditionStartHandler from './api/missions/expedition-start.js';
import trainingStartHandler from './api/training/start.js';
import trainingCompleteHandler from './api/training/complete.js';
import battleLockHandler  from './api/battle/lock.js';
import villageTreasuryTransferHandler from './api/village/treasury/transfer.js';
import villageTreasuryDonateHandler from './api/village/treasury/donate.js';
import villageClaimDailyAgendaHandler from './api/village/claim-daily-agenda.js';
import villageClaimMapControlHandler from './api/village/claim-map-control.js';
import hireMercenaryHandler from './api/village/hire-mercenary.js';
import villageWarStructureHandler from './api/village/war-structure.js';
import villageWarWinConditionHandler from './api/village/war-win-condition.js';
import villageWarTerrainHandler from './api/village/war-terrain.js';
import villageSectorWarHandler from './api/village/sector-war.js';
import villageWarMercHandler from './api/village/war-merc.js';
import villageSectorCardHandler from './api/village/sector-card.js';
import villageSectorPetHandler  from './api/village/sector-pet.js';
import anbuInfiltrationHandler from './api/village/anbu-infiltration.js';
import villageWarMapHandler from './api/village/war-map.js';
import villageTaxHandler from './api/village/tax.js';
import villageIntelHandler from './api/village/intel.js';
import villageClaimWarCrateHandler from './api/village/claim-war-crate.js';
import villageWarMissionHandler from './api/village/war-mission.js';
import warClaimRewardHandler from './api/war/claim-reward.js';
import bankClaimInterestHandler from './api/bank/claim-interest.js';
import bankTransferHandler from './api/bank/transfer.js';
import inventoryOpenWarCrateHandler from './api/inventory/open-war-crate.js';
import profileSettleHandler from './api/profile/settle.js';
import shopSettleHandler from './api/shop/settle.js';
import inventorySellHandler from './api/inventory/sell.js';
import achievementsSyncHandler from './api/achievements/sync.js';
import auraFeedHandler from './api/aura/feed.js';
import awakeningRollHandler from './api/awakening/roll.js';
import bloodlinesForgeHandler from './api/bloodlines/forge.js';
import cardClashOpenPackHandler from './api/card-clash/open-pack.js';
import cardClashClaimStarterHandler from './api/card-clash/claim-starter.js';
import cardClashSyncProgressionHandler from './api/card-clash/sync-progression.js';
import craftForgeHandler from './api/craft/forge.js';
import craftNamedHandler from './api/craft/named.js';
import dungeonRunHandler from './api/dungeon/run.js';
import endlessRunHandler from './api/endless/run.js';
import endlessWaveStartHandler from './api/endless/wave-start.js';
import eventsClaimHandler from './api/events/claim.js';
import examsPassHandler from './api/exams/pass.js';
import hollowGateForgeKeyHandler from './api/hollow-gate/forge-key.js';
import hollowGateAttuneHandler from './api/hollow-gate/attune.js';
import hollowGateLockedDoorHandler from './api/hollow-gate/locked-door.js';
import hunterRankUpHandler from './api/hunter/rank-up.js';
import petBefriendHandler from './api/pet/befriend.js';
import petEncounterDeclineHandler from './api/pet/encounter-decline.js';
import petChooseStarterHandler from './api/pet/choose-starter.js';
import petEncounterStartHandler from './api/pet/encounter-start.js';
import petProgressHandler from './api/pet/progress.js';
import petBreedingStatusHandler from './api/pet/breeding-status.js';
import petBreedingStartHandler from './api/pet/breeding-start.js';
import petBreedingHatchHandler from './api/pet/breeding-hatch.js';
import petSanctuaryListHandler from './api/pet/sanctuary-list.js';
import petSanctuaryTransferHandler from './api/pet/sanctuary-transfer.js';
import playerProfileTitleHandler from './api/player/profile-title.js';
import playerStatRespecHandler from './api/player/stat-respec.js';
import professionMasteryHandler from './api/profession/mastery.js';
import shopPurchaseHandler from './api/shop/purchase.js';
import shopSellHandler from './api/shop/sell.js';
import storySettleHandler from './api/story/settle.js';
import storyBossStartHandler from './api/story/boss-start.js';
import storySparStartHandler from './api/story/spar-start.js';
import trainingJutsuRyoHandler from './api/training/jutsu-ryo.js';
import villageElderFocusHandler from './api/village/elder-focus.js';
import villageHollowGateUnlockHandler from './api/village/hollow-gate-unlock.js';
import villageOpenWarCrateHandler from './api/village/open-war-crate.js';
import villageUpgradeHandler from './api/village/upgrade.js';
import worldExploreHandler from './api/world/explore.js';
import worldOpenChestHandler from './api/world/open-chest.js';
import saveSnapshotHandler from './api/admin/save-snapshot.js';
// Cron — daily save-snapshot HTTP trigger. The nightly run is in-process via
// startSnapshotCron (api/cron/_scheduler.ts); this endpoint stays for manual
// ops/admin triggers. On Vercel the api/ folder convention exposed it; off
// Vercel it must be registered explicitly or it 404s.
import snapshotSavesHandler from './api/cron/snapshot-saves.js';

// Clan — wars
import clanWarListHandler      from './api/clan/war/list.js';
import clanWarDeclareHandler   from './api/clan/war/declare.js';
import clanWarChallengeHandler from './api/clan/war/challenge.js';
import clanWarPvp2v2Handler from './api/clan/war/pvp-2v2.js';
import clanWarReportHandler    from './api/clan/war/report.js';
import clanWarTilecardsHandler from './api/clan/war/tilecards.js';
import clanWarPetHandler from './api/clan/war/pet.js';
// Card Clash — free-play PvP (open matchmaking + server-authoritative match)
import cardClashQueueHandler   from './api/card-clash/queue.js';
import cardClashMatchHandler   from './api/card-clash/match.js';
import cardClashAiStartHandler from './api/card-clash/ai-start.js';
import cardClashAiMoveHandler  from './api/card-clash/ai-move.js';
import cardClashEchoesWitnessHandler from './api/card-clash/echoes-witness.js';
// Clan — seal pool
import clanSealPoolGetHandler        from './api/clan/seal-pool/get.js';
import clanSealPoolDonateHandler     from './api/clan/seal-pool/donate.js';
import clanSealPoolDistributeHandler from './api/clan/seal-pool/distribute.js';
// Clan — treasury donate (atomic)
import clanTreasuryDonateHandler     from './api/clan/treasury/donate.js';
import clanTreasuryTransferHandler   from './api/clan/treasury/transfer.js';
// Clan — territory war-supply collect (server-authoritative)
import clanCollectSupplyHandler      from './api/clan/territory/collect-supply.js';
import clanAssignTerritoryScrollsHandler from './api/clan/territory/assign-scrolls.js';
// Clan — upgrade tree purchase (server-authoritative spend from treasury)
import clanUpgradePurchaseHandler    from './api/clan/upgrade/purchase.js';
// Clan — mission reward claim (server-recomputed progress → treasury + clan XP)
import clanMissionClaimHandler       from './api/clan/mission/claim.js';
import clanExchangePurchaseHandler   from './api/clan/exchange/purchase.js';
// Clan — text chat (own capped KV key; membership-gated; cheap since-cursor polling)
import clanChatGetHandler            from './api/clan/chat/get.js';
import clanChatSendHandler           from './api/clan/chat/send.js';
// Clan — weekly Clan Boss Gauntlet (server-wide co-op competition, flag-gated)
import clanBossGetHandler            from './api/clan-boss/get.js';
import clanBossAssaultStartHandler   from './api/clan-boss/assault-start.js';
import clanBossAssaultSettleHandler  from './api/clan-boss/assault-settle.js';
import clanBossPartyHandler          from './api/clan-boss/party.js';
// Hollow Gate — server-authoritative run token + augments (sealed-bounds payout)
import hollowGateStartHandler        from './api/hollow-gate/start.js';
import hollowGateDescendHandler      from './api/hollow-gate/descend.js';
import hollowGateChooseAugmentHandler from './api/hollow-gate/choose-augment.js';
import hollowGateSettleHandler       from './api/hollow-gate/settle.js';
import hollowGateCombatStartHandler  from './api/hollow-gate/combat-start.js';
import hollowGateCombatSettleHandler from './api/hollow-gate/combat-settle.js';
import hollowGateUseConsumableHandler from './api/hollow-gate/use-consumable.js';
import hollowGateEventHandler         from './api/hollow-gate/event.js';
import hollowGateStepHandler          from './api/hollow-gate/step.js';
import hollowGateFloorSealHandler     from './api/hollow-gate/floor-seal.js';
// Clan — membership: kick (server-authoritative cross-save removal)
import clanKickHandler               from './api/clan/kick.js';
import clanMentorHandler             from './api/clan/mentor.js';
// Clan — pet escort
import clanPetEscortListHandler   from './api/clan/pet-escort/list.js';
import clanPetEscortOfferHandler  from './api/clan/pet-escort/offer.js';
import clanPetEscortCancelHandler from './api/clan/pet-escort/cancel.js';
// Missions — daily + reporting
import missionsDailyHandler          from './api/missions/daily.js';
import missionsWeeklyBoardHandler    from './api/missions/weekly-board.js';
import missionsReportRaidHandler     from './api/missions/report-raid.js';
import missionsReportPvpWinHandler   from './api/missions/report-pvp-win.js';
import missionsReportPetEventHandler from './api/missions/report-pet-event.js';
import missionsAiFightStartHandler   from './api/missions/ai-fight-start.js';
import missionsReportAiFightHandler  from './api/missions/report-ai-fight.js';
import missionsHuntTrailHandler      from './api/missions/hunt-trail.js';
import missionsFieldTrailHandler     from './api/missions/field-trail.js';
import missionsClaimMissionHandler   from './api/missions/claim-mission.js';
import missionsQueueCombatClaimHandler from './api/missions/queue-combat-claim.js';
import missionsCombatStartHandler from './api/missions/combat-start.js';
import missionsRecordProgressHandler from './api/missions/record-progress.js';
import pveFightOutcomeHandler from './api/pve/fight-outcome.js';
import soloPveActionHandler from './api/solo-pve/action.js';
import soloPveStateHandler from './api/solo-pve/state.js';
import tebexBasketHandler from './api/tebex/basket.js';
import tebexCatalogueHandler from './api/tebex/catalogue.js';
import tebexWebhookHandler from './api/tebex/webhook.js';
import { googleRedirectUriProblem }    from './api/_google-auth.js';
import googleAuthStartHandler         from './api/auth/google/start.js';
import googleAuthCallbackHandler      from './api/auth/google/callback.js';
import googleAuthClaimHandler         from './api/auth/google/claim.js';
import sectorWandererGiftHandler      from './api/sector/wanderer-gift.js';
import sectorWandererQuestHandler     from './api/sector/wanderer-quest.js';
import sectorRiftQuestHandler         from './api/sector/rift-quest.js';
import sectorWandererAmbushHandler    from './api/sector/wanderer-ambush.js';
import sectorWandererServiceHandler   from './api/sector/wanderer-service.js';
import sectorQuestbookHandler         from './api/sector/questbook.js';
import sectorStoryReckoningHandler    from './api/sector/story-reckoning.js';
import sectorMercRoamHandler          from './api/sector/merc-roam.js';
import sectorTracesHandler            from './api/sector/traces.js';
import sectorTrailSignHandler         from './api/sector/trail-sign.js';
import sectorShrineOfferHandler       from './api/sector/shrine-offer.js';
import sectorContractHandler          from './api/sector/contract.js';
// Story — server-authoritative interlude + road-event record (rebuild foundation)
import storyInterludeHandler          from './api/story/interlude.js';
import storyRoadEventHandler          from './api/story/road-event.js';
// Legacy system (ENABLE_LEGACY) — earned identity paths + Wandering Sage
import legacyDefinitionsHandler       from './api/legacy/definitions.js';
import legacyStatsHandler             from './api/legacy/stats.js';
import legacyEvaluateHandler          from './api/legacy/evaluate.js';
import legacySageHandler              from './api/legacy/sage.js';
import legacyTrialHandler             from './api/legacy/trial.js';
import erasHandler                    from './api/eras.js';
import announcementsHandler           from './api/announcements.js';
import worldCrisisHandler              from './api/world-crisis.js';
import worldCrisis80Handler            from './api/world-crisis-80.js';
import worldCrisis80CombatStartHandler from './api/world-crisis-80/combat-start.js';
import worldCrisis80CombatSettleHandler from './api/world-crisis-80/combat-settle.js';
import hallOfLegendsHandler           from './api/hall-of-legends.js';
import adminLegacyHandler             from './api/admin/legacy.js';
// PvP — realtime + rewards + queues
import pvpChatHandler           from './api/pvp/chat.js';
import pvpSpectateHandler       from './api/pvp/spectate.js';
import pvpStreamHandler         from './api/pvp/stream.js';
import pvpCombatLogHandler      from './api/pvp/combat-log.js';
import pvpCombatHistoryHandler  from './api/pvp/combat-history.js';
import pvpClaimRewardsHandler   from './api/pvp/claim-rewards.js';
import pvpBountyHandler         from './api/pvp/bounty.js';
import pvpRankedQueueHandler    from './api/pvp/ranked-queue.js';
import pvpPetRankedQueueHandler from './api/pvp/pet-ranked-queue.js';
import pvpRanked2v2Handler from './api/pvp/ranked-2v2.js';
// Pet
import petBattleStartHandler from './api/pet/battle-start.js';
import petBattleResultHandler from './api/pet/battle-result.js';
import petWarfrontStartHandler from './api/pet/warfront-start.js';
import petRankedStartHandler from './api/pet/ranked-start.js';
import petRankedWatchHandler from './api/pet/ranked-watch.js';
import petEvolveHandler from './api/pet/evolve.js';
import applyElementalCoreHandler from './api/weapon/apply-elemental-core.js';
import forgeElementalCoreHandler from './api/weapon/forge-elemental-core.js';
import petGauntletHandler from './api/pet/gauntlet.js';
import firstPactStateHandler from './api/first-pact/state.js';
import petShowdownHandler from './api/pet/showdown.js';
import arenaLobbyHandler from './api/arena/lobby.js';
import petLadderHandler from './api/pet-ladder/ladder.js';
// Jutsu
import jutsuSpeedupHandler       from './api/jutsu/speedup.js';
import jutsuTrainWithSealsHandler from './api/jutsu/train-with-seals.js';
// Profession
import professionChooseHandler from './api/profession/choose.js';
// Player
import injuredVillagersHandler from './api/player/injured-villagers.js';
// Weekly boss
import weeklyBossHandler from './api/weekly-boss.js';
import rankedSeasonHandler from './api/ranked-season.js';
// Admin moderation
import moderationHandler from './api/admin/moderation.js';
// Admin: durable battle-receipt lookup (support / reward-dispute debugging)
import adminBattleReceiptsHandler from './api/admin/battle-receipts.js';
// Admin: asset-registry report + per-domain audit-log reader (diagnostics)
import adminAssetReportHandler from './api/admin/asset-report.js';
import adminAuditLogHandler from './api/admin/audit-log.js';
// Admin: economy telemetry (faucet/sink aggregates + recent txns + anomalies)
import adminEconomyHandler from './api/admin/economy.js';
import adminEconomyReconcileHandler from './api/admin/economy-reconcile.js';
import adminEconomySettlementsHandler from './api/admin/economy-settlements.js';
import adminBetaMetricsHandler from './api/admin/beta-metrics.js';
import adminClanBossOperationsHandler from './api/admin/clan-boss-operations.js';

export { seedHomeSectorOwnership, villageWarMapEnabled, googleRedirectUriProblem };


// ─── Route helper ────────────────────────────────────────────────────────────

// Handler type: the default-exported async function from each handler module.
// In ESM, `import fn from './module'` gives you the function directly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyHandler = (...args: any[]) => any;

export function registerApiRoutes(route: (path: string, handler: AnyHandler) => void): void {    
    
    // ─── API routes ───────────────────────────────────────────────────────────────
    
    // Save — dynamic :name param merged into req.query.name for the handler.
    route('/save/:name', saveHandler);
    
    // Player
    route('/player/heartbeat',    heartbeatHandler);
    route('/player/travel',       travelHandler);
    route('/player/challenge',    challengeHandler);
    route('/player/blocks',       playerBlocksHandler);
    route('/player/friends',      friendsHandler);
    route('/player/attack',       attackHandler);
    route('/player/sleeper-kill', sleeperKillHandler);
    route('/player/clear-attack', clearAttackHandler);
    route('/player/heal',         healHandler);
    route('/player/cafeteria',    cafeteriaHandler);
    route('/player/academy-narrative', academyNarrativeHandler);
    route('/player/roster',       rosterHandler);
    route('/player/leaderboards', playerLeaderboardsHandler);
    route('/player/trade',        playerTradeHandler);
    route('/player/activity-spine', playerActivitySpineHandler);
    route('/player/capabilities', playerCapabilitiesHandler);
    // The caller's own account standing (guest vs claimed, Google linked, whether
    // the tavern/message lock applies). Authed counterpart to /player/capabilities.
    route('/player/account-status', playerAccountStatusHandler);
    // Daily login-streak reward — server-authoritative ryo + 7-day fate-shard bonus,
    // once per UTC day under the save lock (failClosed), idempotent via the date
    // stamp on the save itself. See api/player/_daily-login.ts.
    route('/player/daily-login',  dailyLoginHandler);
    route('/festival/black-market', blackMarketHandler);
    route('/festival/sunscar', sunscarFestivalHandler);
    
    // PvP
    route('/pvp/session', pvpSessionHandler);
    route('/pvp/move',    pvpMoveHandler);
    
    // Images
    route('/images', imagesHandler);
    // Phase 2: per-image binary serving (one file per image). Cold load no longer
    // pulls the whole base64 bucket — the client fetches only the current screen's
    // images, each CDN/browser-cached. ADD '/api/img' to the Cloudflare cache rule
    // before the client switches to it (see api/img.ts).
    route('/img', imgHandler);
    
    // Auth
    route('/player-auth', playerAuthHandler);
    route('/admin-auth',  adminAuthHandler);
    
    // Google sign-in (server-side authorization-code flow — see api/_google-auth.ts).
    // The callback path is what Google itself redirects to, so it must stay exactly
    // in step with the registered GOOGLE_REDIRECT_URI.
    route('/auth/google/start',    googleAuthStartHandler);
    route('/auth/google/callback', googleAuthCallbackHandler);
    route('/auth/google/claim',    googleAuthClaimHandler);
    
    // Admin
    route('/admin/players',      adminPlayersHandler);
    route('/admin/grant-subscription', adminGrantSubscriptionHandler);
    route('/admin/grant-item', adminGrantItemHandler);
    route('/admin/player-index-health', adminPlayerIndexHealthHandler);
    route('/admin/runtime-mode-capabilities', adminRuntimeModeCapabilitiesHandler);
    route('/admin/server-reset', serverResetHandler);
    route('/admin/ranked-season', adminRankedSeasonHandler);
    route('/admin/content-publish', adminContentPublishHandler);
    
    // Clans
    route('/clans/list', clansListHandler);
    
    // Village
    route('/village/chat', chatHandler);
    
    // Village guard
    route('/village-guard/queue',     guardQueueHandler);
    route('/village-guard/dequeue',   guardDequeueHandler);
    route('/village-guard/list',      guardListHandler);
    route('/village-guard/challenge', guardChallengeHandler);
    
    // AI image generation
    route('/generate-image', generateImageHandler);
    
    // Game / world state
    route('/game-state',  gameStateHandler);
    route('/world-state', worldStateHandler);
    route('/messages',    messagesHandler);
    route('/report',      reportHandler);
    
    // Phase 0 load/refresh telemetry — anonymous, zero-storage beacon sink. Logs a
    // single `[perf]` line per page load to stdout (see api/perf-beacon.ts).
    route('/perf-beacon', perfBeaconHandler);
    
    // Village
    route('/village/kage', kageHandler);
    // Village — server-authoritative Kage succession (declare/press/accept/resolve).
    route('/village/kage-challenge', kageChallengeHandler);
    // Village — losing-village "demoralized" training debuff lookup (read-only).
    route('/village/war-debuff', villageWarDebuffHandler);
    
    // Bloodlines
    route('/bloodlines/list', bloodlinesListHandler);
    
    // Admin review queues
    route('/admin/bloodline-review', bloodlineReviewHandler);
    route('/admin/item-review',      itemReviewHandler);
    
    // Internal KV proxy — a remote server (e.g. Railway) forwards disk-routed keys
    // to the cPanel disk overlay here. Mounted with a trailing :op param so
    // /api/kv/get etc. all hit one handler.
    route('/kv/:op', kvProxyHandler);
    
    // Admin: migrate disk-routed keys from Supabase → disk overlay.
    route('/admin/migrate-kv', migrateKvHandler);
    // Admin: REVERSE copy disk overlay → Supabase base, to retire the overlay/cPanel
    // (Option B, docs/RETIRE_CPANEL_RUNBOOK.md). Copy-only — never deletes the overlay.
    route('/admin/migrate-to-base', migrateToBaseHandler);
    route('/admin/migrate-images-to-r2', migrateImagesToR2Handler);
    
    // Missions — AI raid token mint (PvP raids cross-validate via PvpSession;
    // AI raids use this short-lived single-use token instead).
    route('/missions/raid-start', raidStartHandler);
    // Battle Towers — 4-player squad tower (start / action / state / settle). Server-authoritative
    // deterministic engine + idempotent reward settlement; see api/towers/.
    route('/towers/floors', towersFloorsHandler);
    route('/towers/start', towersStartHandler);
    route('/towers/action', towersActionHandler);
    route('/towers/state', towersStateHandler);
    route('/towers/settle', towersSettleHandler);
    route('/towers/my-run', towersMyRunHandler);
    route('/towers/join', towersJoinHandler);
    route('/towers/party', towersPartyHandler);
    route('/towers/spire-leaderboard', towersSpireLeaderboardHandler);
    route('/towers/pvp-queue', towersPvpQueueHandler);
    route('/towers/pvp-state', towersPvpStateHandler);
    route('/towers/pvp-action', towersPvpActionHandler);
    route('/towers/pvp-settle', towersPvpSettleHandler);
    // Battle lock — server-side "in a PvE fight" marker (start/resolve/status) so a
    // refresh can't escape a battle; resume-only, pays/punishes nothing (see
    // api/battle/lock.ts).
    route('/battle/lock', battleLockHandler);
    // Missions — pet expedition token mint (single-use, time-gated; redeemed by
    // report-pet-event so expedition rewards require a real, fully-elapsed run).
    route('/missions/expedition-start', expeditionStartHandler);
    // Stat training — single-use token pair (server-auth). start seals the chosen
    // stat's gain; complete time-gates + consumes it and returns the sealed amount.
    route('/training/start', trainingStartHandler);
    route('/training/complete', trainingCompleteHandler);
    
    // Village treasury — atomic Kage-gift endpoint that replaces the broken
    // 2-write client flow (deduct treasury + patch recipient).
    route('/village/treasury/transfer', villageTreasuryTransferHandler);
    // Village treasury — atomic player donation (debit donor + credit treasury).
    route('/village/treasury/donate', villageTreasuryDonateHandler);
    // Village daily-agenda — server-authoritative shared-treasury credit (NX once/day).
    route('/village/claim-daily-agenda', villageClaimDailyAgendaHandler);
    // Village map-control — server-authoritative PERSONAL daily reward (server counts
    // owned world:territory:* sectors, computes payout, credits once/day via NX marker).
    route('/village/claim-map-control', villageClaimMapControlHandler);
    // Village war mercenaries — server-authoritative Honor Seal sink: hire a tiered
    // merc band (once/war/tier) that lands sealed war damage on the enemy village.
    route('/village/hire-mercenary', hireMercenaryHandler);
    // Village War Map structures — Kage-only server-authoritative upgrade: debits
    // Honor Seals from the village treasury, raises a shared structure level.
    // Server-gated by the default-on Sector Map campaign kill switch.
    route('/village/war-structure', villageWarStructureHandler);
    // Village War Map — Kage sets a home sector's sector-war win-condition (Combat/
    // Card; max-7 diversity rule). Server-gated by the Sector Map campaign switch.
    route('/village/war-win-condition', villageWarWinConditionHandler);
    // Village War Map — Kage (3 sectors) / elders (1 each) set a home sector's
    // terrain (the defender jutsu-school buff). Gated by the Sector Map switch.
    route('/village/war-terrain', villageWarTerrainHandler);
    // Village War Map — sector-war battle wiring (Phase 4c): the Kage declares a
    // contest (250 WR), a single-use token binds the resulting PvP battle, and
    // resolve applies the authoritative winner to Control HP — flipping the sector's
    // ownerVillage on capture. Server-gated by the Sector Map campaign switch.
    route('/village/sector-war', villageSectorWarHandler);
    // Village War Map — sector-war "Card" win-condition (Phase 4c-2): an interactive
    // 6-turn Card Clash between an attacker- and defender-village member, settling
    // the same contest Control HP (forked clan-war engine). Gated by the Sector Map switch.
    route('/village/sector-card', villageSectorCardHandler);
    // Village War Map — sector-war "Pet" win-condition (Phase 7): a deterministic 1v1
    // pet duel resolved server-side by the generated pet engine (api/pet-sim), settling
    // the same contest Control HP. The client replays the same (pets, seed). Gated.
    route('/village/sector-pet',  villageSectorPetHandler);
    // Anbu Vault Infiltration — L100 sector-attrition raid (start/act/state/report/
    // turn-in action switch): fight a daily-sealed Anbu snapshot (Solo PvE engine)
    // to skim 1% of the enemy war economy into turn-in caches. NEVER flips
    // sector ownership. Independently gated by the default-on ANBU kill switch.
    route('/village/anbu-infiltration', anbuInfiltrationHandler);
    // Village War Map — read-only aggregator for the client War-Map panel (Phase 6):
    // WR/seal pools, structures + upkeep + dormancy, tax tier, active contests.
    // GET only, gated by the Sector Map campaign switch.
    route('/village/war-map', villageWarMapHandler);
    // Daily village tax (the ryo sink). Idempotent per UTC day via the server-owned
    // lastTaxDate stamp; DISABLE_VILLAGE_TAX=1 is the kill switch.
    route('/village/tax', villageTaxHandler);
    // Village Stores — INTEL. Per-viewer read (what your village scouted + who has
    // been scouting you). Deliberately NOT on /api/world-state: that GET is shared
    // and CDN-cached, and a per-viewer block forced `private, no-store` on every
    // logged-in poll. GET only, auth required, proc-cached per village.
    route('/village/intel', villageIntelHandler);
    // War crate — server-authoritative claim of a village-war-win Legendary War
    // Crate, validated against the authoritative world:war record (P0.2c). POST,
    // idempotent (claimedWarCrateIds). Client gates on warCrateServerAuth.v1.
    route('/village/claim-war-crate', villageClaimWarCrateHandler);
    // Village-war daily mission claim. The reward fields are all server-owned in
    // the save sanitizer, so this is the only path that can actually pay it out.
    route('/village/war-mission', villageWarMissionHandler);
    // Complete post-war settlement: winner crate, per-side MVP, contributor
    // consolation, and lifetime war statistics are derived from locked server records.
    route('/war/claim-reward', warClaimRewardHandler);
    // Village War Map — mercenaries (Phase 5): the Kage spends village WR to field a
    // 2-day AI merc squad (comeback + Barracks discounted) that fights in Combat
    // sector wars. POST hire/list/attack, gated by the Sector Map campaign switch.
    route('/village/war-merc', villageWarMercHandler);
    // Bank interest — server-authoritative personal claim (server computes
    // floor(bankRyo×rate) under the save lock + 24h gate). Audit #7 / Stage 3 Phase 4f.
    route('/bank/claim-interest', bankClaimInterestHandler);
    // Wallet <-> bank moves are authenticated save-lock transactions. Raw
    // autosaves cannot reproduce either side of the transfer.
    route('/bank/transfer', bankTransferHandler);
    // Paid profile changes and war-crate loot settle from the locked stored save;
    // clients only adopt the exact authoritative character returned by these APIs.
    route('/profile/settle', profileSettleHandler);
    route('/inventory/open-war-crate', inventoryOpenWarCrateHandler);
    route('/shop/settle', shopSettleHandler);
    route('/inventory/sell', inventorySellHandler);
    
    // Admin: snapshot / list / restore a player save (90-day TTL). Survives
    // server-reset because the `save-snapshot:` prefix isn't matched by the
    // reset's `save:*` glob.
    route('/admin/save-snapshot', saveSnapshotHandler);
    
    // ─── Cron: manual save-snapshot trigger ────────────────────────────────────────
    // The nightly run happens in-process (startSnapshotCron, below). This HTTP
    // endpoint matches the documented GET /api/cron/snapshot-saves so ops/admin can
    // force a run manually; auth is CRON_SECRET bearer or full-admin password (the
    // handler enforces it). Read-only — it only writes save-snapshot: copies.
    route('/cron/snapshot-saves', snapshotSavesHandler);
    
    // ─── Clan: wars ────────────────────────────────────────────────────────────────
    // Council Hall "Clan Battles" tab + the village-war flow (which reuses the
    // clan-war engine with the village name as the clan key).
    route('/clan/war/list',      clanWarListHandler);
    route('/clan/war/declare',   clanWarDeclareHandler);
    route('/clan/war/challenge', clanWarChallengeHandler);
    // Clan War shinobi 2v2: start/settle only — the fight itself reuses the shared
    // Tower MPvP reducer at /towers/pvp-action and /towers/pvp-state.
    route('/clan/war/pvp-2v2', clanWarPvp2v2Handler);
    route('/clan/war/report',    clanWarReportHandler);
    route('/clan/war/tilecards', clanWarTilecardsHandler);
    // Server-authoritative clan-war PET battle: both sides field a pet, the server runs
    // the deterministic duel and finalizes the challenge. /clan/war/report refuses
    // client-reported pet results.
    route('/clan/war/pet', clanWarPetHandler);
    
    // ─── Card Clash: free-play PvP ─────────────────────────────────────────────────
    route('/card-clash/queue', cardClashQueueHandler);
    route('/card-clash/match', cardClashMatchHandler);
    route('/card-clash/ai-start', cardClashAiStartHandler);
    route('/card-clash/ai-move', cardClashAiMoveHandler);
    route('/card-clash/echoes-witness', cardClashEchoesWitnessHandler);
    
    // ─── Clan: seal pool ───────────────────────────────────────────────────────────
    route('/clan/seal-pool/get',        clanSealPoolGetHandler);
    route('/clan/seal-pool/donate',     clanSealPoolDonateHandler);
    route('/clan/seal-pool/distribute', clanSealPoolDistributeHandler);
    
    // ─── Clan: treasury donate ─────────────────────────────────────────────────────
    // Atomic player donation (debit donor save + credit clan treasury).
    route('/clan/treasury/donate',      clanTreasuryDonateHandler);
    route('/clan/treasury/transfer',    clanTreasuryTransferHandler);
    
    // ─── Clan: collect territory war supply (server-authoritative) ──────────────────
    // Scans owned world:territory:* sectors, accrues + zeroes them, credits treasury.
    route('/clan/territory/collect-supply', clanCollectSupplyHandler);
    // Debits the shared clan treasury and advances/captures one sector in the same
    // replay-safe command. Generic world-state writes cannot mint this progress.
    route('/clan/territory/assign-scrolls', clanAssignTerritoryScrollsHandler);
    
    // ─── Clan: upgrade tree purchase (server-authoritative spend) ───────────────────
    // Locks the clan row, debits treasury ryo + warSupply, increments the building.
    route('/clan/upgrade/purchase', clanUpgradePurchaseHandler);
    
    // ─── Clan: claim a completed clan-mission reward (server-authoritative) ─────────
    // GET lists claimed missions; POST recomputes progress + credits treasury/clan XP.
    route('/clan/mission/claim', clanMissionClaimHandler);
    route('/clan/exchange/purchase', clanExchangePurchaseHandler);
    
    // ─── Clan chat: membership-gated text chat (GET since-cursor, POST send) ────────
    route('/clan/chat/get',  clanChatGetHandler);
    route('/clan/chat/send', clanChatSendHandler);
    
    // ─── Clan Boss Gauntlet: default-on weekly server-wide co-op competition ──────
    // get returns the week's boss + clan pool + standings; assault-start mints a co-op
    // tower session on the clan-boss floor; assault-settle banks the finished fight's
    // server-computed damage into the clan's shared pool. Weekly cron ranks + rewards top 3.
    route('/clan-boss/get',            clanBossGetHandler);
    route('/clan-boss/party',          clanBossPartyHandler);
    route('/clan-boss/assault-start',  clanBossAssaultStartHandler);
    route('/clan-boss/assault-settle', clanBossAssaultSettleHandler);
    
    // ─── Hollow Gate: server-authoritative run token + augments ─────────────────────
    // start mints a sealed token (entry snapshot + depth + augment offers) under a
    // server daily-run cap; choose-augment re-seals the pick; settle credits
    // min(claimed, sealed ceiling) anchored to the entry snapshot, single-use.
    route('/hollow-gate/start', hollowGateStartHandler);
    route('/hollow-gate/descend', hollowGateDescendHandler);
    route('/hollow-gate/choose-augment', hollowGateChooseAugmentHandler);
    route('/hollow-gate/settle', hollowGateSettleHandler);
    route('/hollow-gate/combat-start', hollowGateCombatStartHandler);
    route('/hollow-gate/combat-settle', hollowGateCombatSettleHandler);
    route('/hollow-gate/use-consumable', hollowGateUseConsumableHandler);
    route('/hollow-gate/event', hollowGateEventHandler);
    route('/hollow-gate/step', hollowGateStepHandler);
    route('/hollow-gate/floor-seal', hollowGateFloorSealHandler);
    route('/hollow-gate/attune', hollowGateAttuneHandler);
    
    // ─── Clan: kick a member (server-authoritative) ─────────────────────────────────
    // Leadership-only. Removes the member from the clan row AND clears their
    // character.clan on their own save (the cross-save write a client can't do).
    route('/clan/kick', clanKickHandler);
    // Clan — Sensei->Student mentorship (assign / claim milestone rewards / release).
    route('/clan/mentor', clanMentorHandler);
    
    // ─── Clan: pet escort ──────────────────────────────────────────────────────────
    route('/clan/pet-escort/list',   clanPetEscortListHandler);
    route('/clan/pet-escort/offer',  clanPetEscortOfferHandler);
    route('/clan/pet-escort/cancel', clanPetEscortCancelHandler);
    
    // ─── Missions: daily + reporting ───────────────────────────────────────────────
    route('/missions/daily',            missionsDailyHandler);
    route('/missions/weekly-board',     missionsWeeklyBoardHandler);
    route('/missions/report-raid',      missionsReportRaidHandler);
    route('/missions/report-pvp-win',   missionsReportPvpWinHandler);
    route('/missions/report-pet-event', missionsReportPetEventHandler);
    route('/missions/ai-fight-start',   missionsAiFightStartHandler);
    route('/missions/report-ai-fight',  missionsReportAiFightHandler);
    route('/missions/hunt-trail',       missionsHuntTrailHandler);
    route('/missions/field-trail',      missionsFieldTrailHandler);
    route('/missions/claim-mission',    missionsClaimMissionHandler);
    route('/missions/queue-combat-claim', missionsQueueCombatClaimHandler);
    route('/missions/combat-start', missionsCombatStartHandler);
    route('/missions/record-progress',  missionsRecordProgressHandler);
    // The physical cost of a server-resolved PvE fight (surviving HP / hospital on a
    // defeat or a forfeit). Pays nothing — the reward settles stay where they are.
    route('/pve/fight-outcome', pveFightOutcomeHandler);
    // Durable solo-PvE sessions share these routes across every deployed server.
    route('/solo-pve/action', soloPveActionHandler);
    route('/solo-pve/state', soloPveStateHandler);
    // Tebex purchase webhook — the delivery mechanism for every shard package.
    // Tebex refuses to publish a package with no deliverable unless a VALIDATED
    // webhook endpoint exists, so this route has to be live before the storefront
    // can be finished. Reads req.rawBody (see the scoped parser above).
    route('/tebex/webhook', tebexWebhookHandler);
    // Opens a checkout basket bound to the authenticated player. Grants nothing —
    // the webhook above is the only thing that credits shards.
    route('/tebex/basket', tebexBasketHandler);
    // Public price list, so the shop shows what Tebex will actually charge.
    route('/tebex/catalogue', tebexCatalogueHandler);
    // Sector Wanderers — server-authoritative gift (recompute + daily cap)
    route('/sector/wanderer-gift',      sectorWandererGiftHandler);
    route('/sector/wanderer-quest',     sectorWandererQuestHandler);
    route('/sector/rift-quest',         sectorRiftQuestHandler);
    route('/sector/wanderer-ambush',    sectorWandererAmbushHandler);
    route('/sector/wanderer-service',   sectorWandererServiceHandler);
    route('/sector/questbook',          sectorQuestbookHandler);
    route('/sector/story-reckoning',    sectorStoryReckoningHandler);
    route('/sector/merc-roam',          sectorMercRoamHandler);
    // Sector traces — footfall + trail signs + shrine offerings (world remembers you)
    route('/sector/traces',             sectorTracesHandler);
    route('/sector/trail-sign',         sectorTrailSignHandler);
    route('/sector/shrine-offer',       sectorShrineOfferHandler);
    route('/sector/contract',           sectorContractHandler);
    
    // ─── Story (server-authoritative interlude + road-event record) ────────────────
    route('/story/interlude',           storyInterludeHandler);
    route('/story/road-event',          storyRoadEventHandler);
    
    // ─── Legacy system (ENABLE_LEGACY) ─────────────────────────────────────────────
    // Earned identity paths: definitions codex, per-player stats/eligibility, the
    // Wandering Sage offer flow (permanent one-legacy-forever choice), trials,
    // plus the world announcements feed and the permanent Hall of Legends.
    route('/legacy/definitions',        legacyDefinitionsHandler);
    route('/legacy/stats',              legacyStatsHandler);
    route('/legacy/evaluate',           legacyEvaluateHandler);
    route('/legacy/sage',               legacySageHandler);
    route('/legacy/trial',              legacyTrialHandler);
    route('/eras',                      erasHandler);
    route('/announcements',             announcementsHandler);
    route('/world-crisis',              worldCrisisHandler);
    route('/world-crisis-80',           worldCrisis80Handler);
    route('/world-crisis-80/combat-start',  worldCrisis80CombatStartHandler);
    route('/world-crisis-80/combat-settle', worldCrisis80CombatSettleHandler);
    route('/hall-of-legends',           hallOfLegendsHandler);
    route('/admin/legacy',              adminLegacyHandler);
    
    // ─── PvP: realtime, rewards, ranked queues ─────────────────────────────────────
    // stream/spectate hold the connection open (SSE / long-poll); the generic
    // route() wrapper passes res straight through so the handlers stream normally.
    route('/pvp/chat',             pvpChatHandler);
    route('/pvp/spectate',         pvpSpectateHandler);
    route('/pvp/stream',           pvpStreamHandler);
    route('/pvp/combat-log',       pvpCombatLogHandler);
    route('/pvp/combat-history',   pvpCombatHistoryHandler);
    route('/pvp/claim-rewards',    pvpClaimRewardsHandler);
    route('/pvp/bounty',           pvpBountyHandler);
    route('/pvp/ranked-queue',     pvpRankedQueueHandler);
    route('/pvp/pet-ranked-queue', pvpPetRankedQueueHandler);
    // Ranked 2v2: duo pairing, duo-vs-duo matchmaking and ladder settlement. The
    // fight reuses /towers/pvp-action + /towers/pvp-state.
    route('/pvp/ranked-2v2',       pvpRanked2v2Handler);
    
    // ─── Pet battle result ─────────────────────────────────────────────────────────
    route('/pet/battle-start',  petBattleStartHandler);
    route('/pet/battle-result', petBattleResultHandler);
    route('/pet/warfront-start', petWarfrontStartHandler);
    route('/pet/ranked-start',  petRankedStartHandler);
    route('/pet/ranked-watch',  petRankedWatchHandler);
    route('/pet/evolve',        petEvolveHandler);
    route('/weapon/apply-elemental-core', applyElementalCoreHandler);
    route('/weapon/forge-elemental-core', forgeElementalCoreHandler);
    route('/pet/gauntlet',      petGauntletHandler);
    route('/pet/showdown',      petShowdownHandler);
    route('/first-pact/state',  firstPactStateHandler);
    
    // ─── Co-op Tactical Pet Arena lobby ─────────────────────────────────────────────
    route('/arena/lobby', arenaLobbyHandler);
    
    // ─── Global Pet Ladders (Coliseum 1v1 + Tactical 4v4, offline defense) ───────────
    route('/pet-ladder', petLadderHandler);
    
    // ─── Jutsu training ────────────────────────────────────────────────────────────
    route('/jutsu/speedup',         jutsuSpeedupHandler);
    route('/jutsu/train-with-seals', jutsuTrainWithSealsHandler);
    
    // ─── Profession ────────────────────────────────────────────────────────────────
    route('/profession/choose', professionChooseHandler);
    
    // ─── Player: injured villagers (Hospital screen) ───────────────────────────────
    route('/player/injured-villagers', injuredVillagersHandler);
    
    // ─── Weekly boss (Hall of Legends) ─────────────────────────────────────────────
    route('/weekly-boss', weeklyBossHandler);
    route('/ranked-season', rankedSeasonHandler);
    
    // ─── Admin: moderation (bans / silences / IP linkage) ──────────────────────────
    route('/admin/moderation', moderationHandler);
    
    // ─── Admin: durable battle-receipt lookup (support / reward-dispute triage) ─────
    route('/admin/battle-receipts', adminBattleReceiptsHandler);
    
    // ─── Admin: asset-registry report + per-domain audit-log reader ─────────────────
    route('/admin/asset-report', adminAssetReportHandler);
    route('/admin/audit-log', adminAuditLogHandler);
    route('/admin/economy', adminEconomyHandler);
    route('/admin/economy-reconcile', adminEconomyReconcileHandler);
    route('/admin/economy-settlements', adminEconomySettlementsHandler);
    route('/admin/beta-metrics', adminBetaMetricsHandler);
    route('/admin/clan-boss-operations', adminClanBossOperationsHandler);
    
    // Release-handoff endpoints. Express has no folder-convention routing, so every
    // handler added during the feature and settlement work must be mounted here.
    route('/achievements/sync', achievementsSyncHandler);
    route('/aura/feed', auraFeedHandler);
    route('/awakening/roll', awakeningRollHandler);
    route('/bloodlines/forge', bloodlinesForgeHandler);
    route('/card-clash/open-pack', cardClashOpenPackHandler);
    route('/card-clash/claim-starter', cardClashClaimStarterHandler);
    route('/card-clash/sync-progression', cardClashSyncProgressionHandler);
    route('/craft/forge', craftForgeHandler);
    route('/craft/named', craftNamedHandler);
    route('/dungeon/run', dungeonRunHandler);
    route('/endless/run', endlessRunHandler);
    route('/endless/wave-start', endlessWaveStartHandler);
    route('/events/claim', eventsClaimHandler);
    route('/exams/pass', examsPassHandler);
    route('/hollow-gate/forge-key', hollowGateForgeKeyHandler);
    route('/hollow-gate/locked-door', hollowGateLockedDoorHandler);
    route('/hunter/rank-up', hunterRankUpHandler);
    route('/pet/befriend', petBefriendHandler);
    route('/pet/encounter-decline', petEncounterDeclineHandler);
    route('/pet/choose-starter', petChooseStarterHandler);
    route('/pet/encounter-start', petEncounterStartHandler);
    route('/pet/progress', petProgressHandler);
    route('/pet/breeding/status', petBreedingStatusHandler);
    route('/pet/breeding/start', petBreedingStartHandler);
    route('/pet/breeding/hatch', petBreedingHatchHandler);
    route('/pet/sanctuary/list', petSanctuaryListHandler);
    route('/pet/sanctuary/transfer', petSanctuaryTransferHandler);
    route('/player/profile-title', playerProfileTitleHandler);
    route('/player/stat-respec', playerStatRespecHandler);
    route('/profession/mastery', professionMasteryHandler);
    route('/shop/purchase', shopPurchaseHandler);
    route('/shop/sell', shopSellHandler);
    route('/story/settle', storySettleHandler);
    route('/story/boss-start', storyBossStartHandler);
    route('/story/spar-start', storySparStartHandler);
    route('/training/jutsu-ryo', trainingJutsuRyoHandler);
    route('/village/elder-focus', villageElderFocusHandler);
    route('/village/hollow-gate-unlock', villageHollowGateUnlockHandler);
    route('/village/open-war-crate', villageOpenWarCrateHandler);
    route('/village/upgrade', villageUpgradeHandler);
    route('/world/explore', worldExploreHandler);
    route('/world/open-chest', worldOpenChestHandler);
}
