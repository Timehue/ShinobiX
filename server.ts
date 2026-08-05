/**
 * Active Railway Express server for the ShinobiX runtime.
 *
 * cPanel / Phusion Passenger is retained only as a compatibility and rollback
 * target while its retirement runbook remains available; it is not the active
 * deployment path.
 *
 * Wraps the existing Vercel-style handler functions so they run under
 * Express without any changes to the individual handler files.
 *
 * Route registration pattern:
 *   Both the bare path (/save/:name) and the prefixed path (/api/save/:name)
 *   are registered so the app works regardless of whether Passenger strips
 *   the /api prefix before it reaches the Node process.
 */

// Must be first: pins outbound connections to IPv4 when FORCE_IPV4=1 (Railway).
// No-op on cPanel (gated on the env var) so it never clobbers app.js's dispatcher.
import './api/_force-ipv4.js';

import { startGameLoop, stopGameLoop } from './api/_realtime/game-loop.js';
import { attachSocketServer, closeSocketServer } from './api/_realtime/socket.js';
import { restorePresenceSnapshot, savePresenceSnapshot, startPresenceSnapshots, stopPresenceSnapshots } from './api/_realtime/presence-snapshot.js';
import { startSnapshotCron, stopSnapshotCron } from './api/cron/_scheduler.js';
import { closeStoragePool } from './api/_storage.js';
import compression from 'compression';
import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { enforceRateLimit } from './api/_ratelimit.js';
import { readRequestMetrics, recordRequestMetric, requestSloAlert } from './api/_request-metrics.js';
import { safeLogValue } from './api/_safe-log.js';

// ─── Handler imports ─────────────────────────────────────────────────────────
// All handlers use import type { VercelRequest, VercelResponse } for TypeScript
// only — those types are erased at compile time, so there is zero runtime
// dependency on @vercel/node in the Railway bundle.

import saveHandler       from './api/save/[name].js';
import heartbeatHandler  from './api/player/heartbeat.js';
import travelHandler     from './api/player/travel.js';
import challengeHandler  from './api/player/challenge.js';
import friendsHandler    from './api/player/friends.js';
import attackHandler     from './api/player/attack.js';
import sleeperKillHandler from './api/player/sleeper-kill.js';
import clearAttackHandler from './api/player/clear-attack.js';
import healHandler       from './api/player/heal.js';
import cafeteriaHandler  from './api/player/cafeteria.js';
import rosterHandler     from './api/player/roster.js';
import playerLeaderboardsHandler from './api/player/leaderboards.js';
import playerTradeHandler from './api/player/trade.js';
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
import adminPlayerIndexHealthHandler from './api/admin/player-index-health.js';
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
import towersSpireLeaderboardHandler from './api/towers/spire-leaderboard.js';
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
import clanWarReportHandler    from './api/clan/war/report.js';
import clanWarTilecardsHandler from './api/clan/war/tilecards.js';
// Card Clash — free-play PvP (open matchmaking + server-authoritative match)
import cardClashQueueHandler   from './api/card-clash/queue.js';
import cardClashMatchHandler   from './api/card-clash/match.js';
import cardClashAiStartHandler from './api/card-clash/ai-start.js';
import cardClashAiMoveHandler  from './api/card-clash/ai-move.js';
// Clan — seal pool
import clanSealPoolGetHandler        from './api/clan/seal-pool/get.js';
import clanSealPoolDonateHandler     from './api/clan/seal-pool/donate.js';
import clanSealPoolDistributeHandler from './api/clan/seal-pool/distribute.js';
// Clan — treasury donate (atomic)
import clanTreasuryDonateHandler     from './api/clan/treasury/donate.js';
import clanTreasuryTransferHandler   from './api/clan/treasury/transfer.js';
// Clan — territory war-supply collect (server-authoritative)
import clanCollectSupplyHandler      from './api/clan/territory/collect-supply.js';
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
import missionsClaimMissionHandler   from './api/missions/claim-mission.js';
import missionsQueueCombatClaimHandler from './api/missions/queue-combat-claim.js';
import missionsCombatStartHandler from './api/missions/combat-start.js';
import missionsRecordProgressHandler from './api/missions/record-progress.js';
import pveFightOutcomeHandler from './api/pve/fight-outcome.js';
import soloPveActionHandler from './api/solo-pve/action.js';
import soloPveStateHandler from './api/solo-pve/state.js';
import patreonOauthStartHandler       from './api/patreon/oauth-start.js';
import patreonOauthCallbackHandler    from './api/patreon/oauth-callback.js';
import patreonWebhookHandler          from './api/patreon/webhook.js';
import patreonStatusHandler           from './api/patreon/status.js';
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
// Pet
import petBattleStartHandler from './api/pet/battle-start.js';
import petBattleResultHandler from './api/pet/battle-result.js';
import petWarfrontStartHandler from './api/pet/warfront-start.js';
import petRankedStartHandler from './api/pet/ranked-start.js';
import petEvolveHandler from './api/pet/evolve.js';
import applyElementalCoreHandler from './api/weapon/apply-elemental-core.js';
import forgeElementalCoreHandler from './api/weapon/forge-elemental-core.js';
import petGauntletHandler from './api/pet/gauntlet.js';
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

// Shared auth helper — constant-time compare for the restart endpoint.
import { safeEqual, maybeRefreshPlayerToken, PLAYER_TOKEN_REFRESH_HEADER } from './api/_auth.js';
// CORS origin predicate — single source of truth, shared with cors() and the
// Socket.IO layer so the three CORS surfaces can't drift (CLAUDE.md). Handles
// the static allowlist, EXTRA_ALLOWED_ORIGINS env additions, and *.up.railway.app.
import { isAllowedOrigin, isMalformedJsonBodyError, MALFORMED_JSON_BODY_ERROR } from './api/_utils.js';
import { classifyBodyLimit } from './api/_body-limits.js';
import { publicErrorPayload, securityHeaders } from './api/_http-security.js';
import { evaluateLaunchControl } from './api/_launch-controls.js';
import { captureExpressException } from './api/_sentry-context.js';
import { sanitizeSentryEvent } from './shared/observability-sanitize.js';
import {
    canonicalRedirectLocation,
    isLegacyDuplicateHost,
    robotsTxt,
    shouldRedirectToCanonical,
    sitemapXml,
} from './api/_canonical-domain.js';

// ─── Sentry (optional, env-gated server error reporting) ───────────────────────
// Activates ONLY when SENTRY_DSN is set. The require is guarded so a cPanel box
// whose node_modules predates this dependency still boots — the cPanel auto-deploy
// does git reset + Passenger restart but NOT `npm install`, so an unconditional
// require of a not-yet-installed module would crash-loop the box. Here it just
// logs a warning and runs without reporting. Set SENTRY_DSN on Railway (and, after
// a manual cPanel "Run NPM Install", on cPanel) to enable. Errors only — no perf
// tracing — to stay inside the free-tier event quota.
let Sentry: typeof import('@sentry/node') | null = null;
if (process.env.SENTRY_DSN) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        Sentry = require('@sentry/node') as typeof import('@sentry/node');
        Sentry.init({
            dsn: process.env.SENTRY_DSN,
            environment: process.env.NODE_ENV || 'production',
            release: [
                process.env.RAILWAY_GIT_COMMIT_SHA,
                process.env.BUILD_COMMIT,
                process.env.GIT_COMMIT_SHA,
                process.env.SOURCE_VERSION,
            ].map((value) => String(value ?? '').trim()).find((value) => /^[0-9a-f]{7,64}$/i.test(value)),
            tracesSampleRate: 0,
            sendDefaultPii: false,
            beforeSend: (event) => sanitizeSentryEvent(event),
        });
        console.log('[sentry] server error reporting enabled');
    } catch (err) {
        console.warn('[sentry] @sentry/node unavailable — error reporting disabled:', (err as Error)?.message);
        Sentry = null;
    }
}

// ─── Process-level resilience ──────────────────────────────────────────────────

// The HTTP server handle, assigned once it's created below. Referenced by
// gracefulShutdown so a restart or an uncaught crash can drain in-flight
// requests before exiting, instead of severing them mid-response.
let _httpServer: import('node:http').Server | undefined;
let _shutdownStarted = false;

// Drain in-flight requests, then exit so the supervisor respawns a fresh worker
// (Passenger on cPanel, the platform on Railway). A bare process.exit() cuts
// whatever request is in flight — on cPanel that reaches the caller as a
// Passenger 502 "Incomplete response received from application" (exactly the
// GET /api/save/* error this guards against). server.close() stops accepting new
// connections and fires its callback once active requests finish;
// closeIdleConnections() drops parked keep-alive sockets so the callback isn't
// held open by an idle client. A bounded backstop force-exits if draining stalls
// (a slow/streaming response), so a restart can never hang forever.
function gracefulShutdown(code: number, reason: string): void {
    if (_shutdownStarted) return;
    _shutdownStarted = true;
    console.log(`[shutdown] draining in-flight requests (${reason})`);
    stopGameLoop();
    stopSnapshotCron();
    // Hand the live online roster to the next process. Presence is process memory, so
    // without this every deploy blanks the world — players vanish from each other's
    // sectors and the online count reads 0 until each client's next heartbeat. Started
    // before the awaits below so it is queued even if the 4s backstop fires.
    stopPresenceSnapshots();
    void savePresenceSnapshot().catch(() => undefined);
    // Close the realtime layer and the pg pool cleanly on the way out. Both are
    // shutdown-only and fire-and-forget under the 4s backstop below, so they can
    // only improve the exit path, never hang it:
    //   • closeSocketServer() disconnects live websockets so _httpServer.close()
    //     can actually finish draining (long-lived sockets otherwise hold it open
    //     until the backstop). Clients reconnect to the fresh worker / fall back
    //     to the HTTP heartbeat — the same outcome as the old abrupt sever, but
    //     with a clean disconnect event instead of a TCP reset.
    //   • closeStoragePool() ends idle connections and waits for in-flight queries
    //     to finish before releasing them, instead of leaving the supervisor to
    //     reap half-open connections against the Supabase ceiling on every deploy.
    void closeSocketServer().catch(() => undefined);
    void closeStoragePool().catch(() => undefined);
    let exited = false;
    const exit = (how: string): void => {
        if (exited) return;
        exited = true;
        console.log(`[shutdown] exiting worker (${reason}: ${how})`);
        process.exit(code);
    };
    const backstop = setTimeout(() => exit('drain-timeout'), 4_000);
    backstop.unref?.();
    if (_httpServer) {
        _httpServer.close(() => exit('drained'));
        _httpServer.closeIdleConnections();
    } else {
        exit('no-server'); // crashed during startup — nothing to drain
    }
}

// Last-resort crash guards — but ONLY when Sentry is not active. Sentry's Node
// SDK registers its own uncaughtException/unhandledRejection integrations
// (capture + flush + exit); registering ours alongside would fight it. So on
// Railway (Sentry on) Sentry owns this path; on cPanel (Sentry usually absent —
// it needs a manual "Run NPM Install") these are the only net. Without them a
// single stray async throw kills the worker mid-response as a 502 AND leaves no
// app-level stack trace (the blind spot this investigation hit). An
// unhandledRejection is logged and SURVIVED — Node 22 would otherwise crash the
// worker, and a rejection is rarely process-corrupting. An uncaughtException is
// logged with its stack, then drained-and-exited: the process state is undefined
// after one, so we don't resume — but we exit cleanly instead of hard-crashing.
if (!Sentry) {
    process.on('unhandledRejection', (reason) => {
        console.error('[fatal-guard] unhandledRejection (surviving):',
            reason instanceof Error ? (reason.stack ?? reason.message) : reason);
    });
    process.on('uncaughtException', (err) => {
        console.error('[fatal-guard] uncaughtException:', err?.stack ?? err);
        gracefulShutdown(1, 'uncaughtException');
    });
}

// Railway and other container supervisors use SIGTERM for deploy replacement.
// Drain exactly the same way as an operator restart or fatal exception so an
// in-flight save/reward write is not cut in half. Railway should allow at least
// 10 seconds of deployment draining; our own bounded backstop exits after 4s.
process.once('SIGTERM', () => gracefulShutdown(0, 'SIGTERM'));
process.once('SIGINT', () => gracefulShutdown(0, 'SIGINT'));

// ─── App setup ───────────────────────────────────────────────────────────────

// Village War Map is now ALWAYS ON (Combat/Card/Pet sector wars, mercenaries, the
// merc cron). Every handler + cron gates on ENABLE_VILLAGE_WAR==='1', so default it
// on here once, at startup, for the whole process. Kill-switch: set DISABLE_VILLAGE_WAR=1
// to turn the entire system back off without code changes.
if (process.env.DISABLE_VILLAGE_WAR !== '1') process.env.ENABLE_VILLAGE_WAR = '1';

// Weekly Clan Boss Gauntlet — ON by default in the testing phase (every clan-boss
// handler + the cron gate on ENABLE_CLAN_BOSS==='1'). Kill-switch: DISABLE_CLAN_BOSS=1.
if (process.env.DISABLE_CLAN_BOSS !== '1') process.env.ENABLE_CLAN_BOSS = '1';

// Legacy is the one live system with a REQUIRED opt-in: api/_legacy-track.ts
// gates on ENABLE_LEGACY==='1' and every /legacy/* route 404s without it — while
// the client keeps rendering the Legacy tab, so the failure is invisible to
// operators and merely broken for players. It is deliberately NOT force-set
// here (that would be a balance decision, not a config fix); say so loudly at
// startup instead, so a missing var shows up in the deploy log rather than in
// a player report.
if (process.env.ENABLE_LEGACY !== '1') {
    console.warn(
        '[startup] ENABLE_LEGACY is not set — the Legacy system (Sage/Trial, Hall of Legends, era titles) '
        + 'is OFF and every /legacy/* route will 404, but the client still shows its UI. '
        + 'Set ENABLE_LEGACY=1 to enable it, or ignore this if Legacy is intentionally disabled.',
    );
}

const app = express();

app.use((_req: Request, res: Response, next: NextFunction) => {
    for (const [name, value] of Object.entries(securityHeaders())) {
        res.setHeader(name, value);
    }
    next();
});

// JSON body parsing. The vast majority of routes carry tiny JSON (polls, moves,
// player actions); only the image-pipe and admin-import routes legitimately POST
// multi-MB base64 payloads. Cap the default at 5 MB to shrink the synchronous
// parse / memory-pressure surface on the hot gameplay/poll routes — a malicious
// 50 MB body to e.g. /api/pvp/move can no longer force a 50 MB buffer+parse — and
// grant the 50 MB ceiling only to the routes that need it. Player saves are
// <=1 MB-gated in api/save/[name].ts and the leadership-portrait POST to
// /api/game-state both fit the 5 MB default with room to spare.
// Route-specific JSON body limits (see api/_body-limits.ts). The 50 MB parser is
// scoped to the exact image/import routes that need it — NOT the whole /admin/*
// tree, so an unauthenticated caller can't force a 50 MB buffer + parse before a
// handler's auth check. Player saves get a 1 MB parser (the save handler already
// rejects >1 MB), rejecting an oversized save at the parser boundary rather than
// after a larger parse. game-state's leadership portrait still fits the 5 MB
// default with room to spare.
const jsonBig = express.json({ limit: '50mb' });
const jsonSave = express.json({ limit: '1mb' });
const jsonDefault = express.json({ limit: '5mb' });
// The Patreon webhook must verify an HMAC-MD5 over the EXACT raw request body,
// so this parser stashes the raw Buffer on req.rawBody. The capture runs ONLY
// for that one path — every other request skips it. See api/patreon/webhook.ts.
const jsonWebhook = express.json({
    limit: '512kb',
    verify: (req, _res, buf) => { (req as unknown as { rawBody?: Buffer }).rawBody = buf; },
});
function isPatreonWebhookPath(path: string): boolean {
    return path === '/patreon/webhook' || path === '/api/patreon/webhook';
}
app.use((req: Request, res: Response, next: NextFunction) => {
    if (isPatreonWebhookPath(req.path)) return jsonWebhook(req, res, next);
    switch (classifyBodyLimit(req.path)) {
        case 'big':  return jsonBig(req, res, next);
        case 'save': return jsonSave(req, res, next);
        default:     return jsonDefault(req, res, next);
    }
});
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Per-request correlation id — a short, greppable token on every request,
// echoed in the x-request-id response header (visible in the browser network
// tab even cross-origin) and included in the 500 error log + body. Lets a
// player's "it broke" screenshot be matched to the exact server log line — the
// single biggest observability lift for a one-person ops team. Reuses an
// inbound id if an upstream proxy already set one.
app.use((req: Request, res: Response, next: NextFunction) => {
    const inbound = req.headers['x-request-id'];
    const id = (typeof inbound === 'string' && inbound.length > 0 && inbound.length <= 64)
        ? inbound
        : randomUUID().slice(0, 8);
    (req as Request & { id?: string }).id = id;
    res.setHeader('x-request-id', id);
    next();
});

// Short rolling request telemetry for release health. It is intentionally
// in-process, bounded, and path-grouped: no player names are retained and a
// request flood cannot grow memory without limit. A protected deep-health call
// exposes p50/p95/p99 and 5xx rates; sustained SLO breaches also emit a
// throttled warning to logs and Sentry.
app.use((req: Request, res: Response, next: NextFunction) => {
    const started = process.hrtime.bigint();
    res.once('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
        recordRequestMetric({
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            durationMs,
        });
        const alert = requestSloAlert();
        if (alert) {
            console.warn(alert);
            try {
                // The SLO snapshot is global. This callback still runs inside
                // the request that triggered evaluation, so explicitly replace
                // that request's transaction label before reporting to Sentry.
                // Otherwise a global p95 breach can look like it belongs to an
                // innocent route such as /api/player/roster.
                Sentry?.withScope((scope) => {
                    scope.setTransactionName('request-slo/global');
                    scope.setTag('request_slo_scope', 'global');
                    scope.setContext(
                        'request_slo',
                        readRequestMetrics() as unknown as Record<string, unknown>,
                    );
                    Sentry?.captureMessage(alert, 'warning');
                });
            } catch { /* reporting must never affect a response */ }
        }
    });
    next();
});

// Global CORS — restrict to known origins so a malicious site can't initiate
// authenticated requests from a visitor's browser. The origin predicate is
// imported from api/_utils.ts (single source of truth) so this middleware and
// cors() can never drift.
// Mirror the safe-method allowlist from api/_utils.ts cors(). The old
// version sent `*` for ANY method when no Origin was present, which is
// strictly looser than the Vercel path (which only allows `*` for safe
// methods). An unsafe method with no Origin gets no ACAO header now,
// matching Vercel behaviour.
const SAFE_METHODS = new Set<string>(['GET', 'HEAD', 'OPTIONS']);
app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = (req.headers.origin as string | undefined) ?? '';
    const method = (req.method ?? 'GET').toUpperCase();
    if (origin && isAllowedOrigin(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    } else if (!origin && SAFE_METHODS.has(method)) {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password, x-admin-token, x-player-password, x-player-name, x-player-token, x-kv-token, x-client-fp');
    // Response headers the browser is allowed to read cross-origin. Without this
    // the sliding-token refresh header is invisible to the client on the dev
    // origin (vite :5173 → API), and sessions would still expire there.
    res.setHeader('Access-Control-Expose-Headers', PLAYER_TOKEN_REFRESH_HEADER);
    // HSTS: tell browsers to always use HTTPS for this host (1 year). Only emit
    // it on responses that actually arrived over HTTPS — both Railway's edge and
    // cPanel's Apache terminate TLS and forward with x-forwarded-proto. Per the
    // HSTS spec the header must not be sent over plain HTTP, and gating this way
    // also avoids HSTS-locking http://localhost during local dev. Apex only — no
    // includeSubDomains, so it can't affect a not-yet-configured subdomain.
    if (req.headers['x-forwarded-proto'] === 'https') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    }
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    next();
});

// Sliding session-token refresh. A player token is valid for 24h and used to be
// mintable ONLY at login, so an ordinary player was thrown a "session timed out,
// re-enter your password" modal once a day — the client is token-first and keeps
// no password to silently re-mint with. Here, any request arriving with a token
// that is still valid but more than halfway through its life gets a freshly
// minted replacement handed back on a response header, which the client swaps in
// transparently. Active play therefore never expires; the TTL now bounds
// INACTIVITY instead.
//
// Runs before the routes so it covers every handler, and is entirely
// best-effort: maybeRefreshPlayerToken returns null (and any throw is swallowed)
// whenever the token is absent, malformed, already expired, epoch-revoked, or
// still fresh, and the request then proceeds untouched. It never authenticates
// anything — handlers still run their own authedPlayer checks.
//
// UNSAFE METHODS ONLY. A minted token is a credential scoped to ONE account, so
// it must never land in a shared cache: Cloudflare fronts this origin and does
// cache some GET responses, and a cached refresh header would hand one player's
// session token to whoever got the cache hit. Restricting emission to methods
// Cloudflare never caches removes that risk structurally, rather than relying on
// a Cache-Control header that a downstream handler is free to overwrite. Nothing
// is lost in coverage: an active client POSTs constantly (api/player/heartbeat
// is POST-only, and the autosave POSTs to /api/save/:name every 15s), so it will
// always be offered a refresh well inside the 12h window.
const TOKEN_REFRESH_METHODS = new Set<string>(['POST', 'PUT', 'PATCH', 'DELETE']);
app.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
        const raw = req.headers['x-player-token'];
        const token = Array.isArray(raw) ? raw[0] : raw;
        if (token && TOKEN_REFRESH_METHODS.has((req.method ?? '').toUpperCase())) {
            const refreshed = await maybeRefreshPlayerToken(token);
            if (refreshed) {
                res.setHeader(PLAYER_TOKEN_REFRESH_HEADER, refreshed);
                // Belt-and-braces against any intermediary that would cache this
                // response despite the unsafe method.
                res.setHeader('Cache-Control', 'private, no-store');
            }
        }
    } catch {
        /* refresh is a convenience — never let it fail a request */
    }
    next();
});

// gzip/deflate response compression. Registered BEFORE the routes so it covers
// API JSON responses too — not just the static SPA bundle (it used to sit after
// every route(), so only the bundle was ever compressed). The filter skips
// Server-Sent Events (text/event-stream, e.g. api/pvp/stream.ts): compression
// buffers the response, which would stall a live stream, so SSE must pass
// through uncompressed. Params are left unannotated so they pick up
// compression's own (IncomingMessage, ServerResponse) signature.
app.use(compression({
    filter: (req, res) => {
        const type = String(res.getHeader('Content-Type') ?? '');
        if (type.includes('text/event-stream')) return false;
        return compression.filter(req, res);
    },
}));

// ─── Route helper ────────────────────────────────────────────────────────────

// Handler type: the default-exported async function from each handler module.
// In ESM, `import fn from './module'` gives you the function directly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (...args: any[]) => any;

/**
 * Register a handler on both the bare path and /api-prefixed path.
 * req.params are merged into req.query so handlers using req.query.name
 * (e.g. save/[name].ts) work with Express route params too.
 */
function route(path: string, handler: AnyHandler) {
    const paths = [path, `/api${path}`];
    app.all(paths, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const control = evaluateLaunchControl({
                path,
                method: req.method,
                body: req.body,
            });
            if (!control.allowed) {
                res.setHeader('Cache-Control', 'no-store');
                res.setHeader('Retry-After', String(control.retryAfterSeconds));
                res.status(control.status).json({
                    ok: false,
                    error: control.error,
                    code: control.code,
                });
                return;
            }
            // Merge route params into query so Vercel-style handlers work, then pass
            // the REAL request object through.
            //
            // This used to build `{ ...req, query, headers, method, body, rawBody }`.
            // Object spread copies own enumerable properties only, so every prototype
            // method was silently dropped — `{...req}.on` is `undefined`. That broke
            // the one handler using request stream methods: api/pvp/stream.ts calls
            // `req.on('close', …)` to notice a disconnect, which threw AFTER the SSE
            // headers and first event were already sent. The client saw the stream
            // open, marked itself connected, then received nothing more and never
            // fired `onerror`, so it never fell back to polling — a PvP board frozen
            // on stale state until Cloudflare's idle timeout. The response was never
            // ended either, holding the socket and logging a Sentry exception on every
            // connect.
            //
            // `query` is a getter with no setter on the Express 5 request prototype, so
            // plain assignment throws in strict mode; define an own property to shadow
            // it. Everything else the Vercel-style handlers read (headers, method,
            // body, and rawBody from the webhook parser) already lives on `req`.
            Object.defineProperty(req, 'query', {
                value: { ...req.query, ...req.params },
                writable: true,
                enumerable: true,
                configurable: true,
            });
            await handler(req, res);
        } catch (err) {
            next(err);
        }
    });
}

// ─── Health / debug routes ───────────────────────────────────────────────────
// (auto-deploy smoke test)

// Cached at module-load time so each request is a free read.
const _BUILD_INFO = (() => {
    const startedAt = new Date().toISOString();
    const configured = [
        process.env.RAILWAY_GIT_COMMIT_SHA,
        process.env.BUILD_COMMIT,
        process.env.GIT_COMMIT_SHA,
        process.env.SOURCE_VERSION,
    ].map((value) => String(value ?? '').trim()).find((value) => /^[0-9a-f]{7,64}$/i.test(value));
    if (configured) {
        const commit = configured.toLowerCase();
        return { commit, commitShort: commit.slice(0, 8), commitSource: 'environment', startedAt };
    }
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require('node:fs') as typeof import('node:fs');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const path = require('node:path') as typeof import('node:path');
        const headPath = path.join(__dirname, '..', '.git', 'HEAD');
        const head = fs.readFileSync(headPath, 'utf8').trim();
        const ref = head.startsWith('ref: ') ? head.slice(5) : null;
        const sha = ref
            ? fs.readFileSync(path.join(__dirname, '..', '.git', ref), 'utf8').trim()
            : head;
        if (!/^[0-9a-f]{7,64}$/i.test(sha)) throw new Error('invalid git commit');
        const commit = sha.toLowerCase();
        return { commit, commitShort: commit.slice(0, 8), commitSource: 'git', startedAt };
    } catch {
        return { commit: 'unknown', commitShort: 'unknown', commitSource: 'unknown', startedAt };
    }
})();

type DbHealthResult = Awaited<ReturnType<typeof runDbHealthProbe>>;
type DeepHealthSource = 'hit' | 'shared' | 'miss';
const _DEEP_HEALTH_CACHE_MS = Math.min(60_000, Math.max(1_000, Number(process.env.DEEP_HEALTH_CACHE_MS) || 15_000));
let _deepHealthCache: { expiresAt: number; result: DbHealthResult } | null = null;
let _deepHealthInFlight: Promise<DbHealthResult> | null = null;

function deepHealthAuthorized(req: Request): boolean {
    const expected = String(process.env.HEALTH_DEEP_TOKEN ?? '').trim();
    // Local development can run the probe without secret plumbing. Production
    // fails closed: the deep route mutates storage and exposes topology/metrics.
    if (!expected) return process.env.NODE_ENV !== 'production';
    const authorization = headerValue(req.headers.authorization);
    const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    const explicit = headerValue(req.headers['x-health-token']);
    const provided = explicit || bearer;
    return !!provided && safeEqual(provided, expected);
}

async function getDbHealthProbe(): Promise<{ result: DbHealthResult; source: DeepHealthSource }> {
    const now = Date.now();
    if (_deepHealthCache && _deepHealthCache.expiresAt > now) {
        return { result: _deepHealthCache.result, source: 'hit' };
    }
    if (_deepHealthInFlight) {
        return { result: await _deepHealthInFlight, source: 'shared' };
    }
    const pending = runDbHealthProbe();
    _deepHealthInFlight = pending;
    try {
        const result = await pending;
        _deepHealthCache = { result, expiresAt: Date.now() + _DEEP_HEALTH_CACHE_MS };
        return { result, source: 'miss' };
    } finally {
        if (_deepHealthInFlight === pending) _deepHealthInFlight = null;
    }
}

async function sendDeepHealth(req: Request, res: Response): Promise<void> {
    res.setHeader('Cache-Control', 'private, no-store');
    if (!deepHealthAuthorized(req)) {
        res.status(401).json({ ok: false, error: 'Deep health token required.', ..._BUILD_INFO });
        return;
    }
    if (!enforceRateLimit(req, res, 'deep-health', 30, 60_000)) return;
    const { result, source } = await getDbHealthProbe();
    res.setHeader('X-Health-Probe', source);
    res.status(result.ok ? 200 : 503).json({
        ...result,
        requestMetrics: readRequestMetrics(),
        ..._BUILD_INFO,
    });
}

app.get(['/health', '/api/health'], async (req, res) => {
    // Default: cheap process-liveness (what Railway's configured health check
    // hits — must stay fast so a slow DB can't flap the deploy). ?deep=1 runs
    // the full DB/KV readiness probe (same as /health/db).
    if (req.query.deep === '1') {
        await sendDeepHealth(req, res);
        return;
    }
    res.json({ ok: true, ..._BUILD_INFO });
});

// Deep DB/KV readiness probe. The plain /health above only proves the process
// is up — Railway can report "healthy" while the storage layer is unreachable,
// which is exactly the failure that makes /api/missions/daily and
// /api/clans/list return 500. This endpoint exercises the real kv operations
// those endpoints depend on against throwaway probe keys (base store: get/set/
// set-nx/hset/hdel/del, plus the disk-routed `save:` overlay), so an operator
// can tell a DB outage apart from a code bug. Reachable at /health/db or
// /health?deep=1. The expensive probe is single-flight and briefly cached so a
// public request burst cannot amplify into repeated KV/overlay writes. Returns
// 503 (not 200) when any check fails.
async function runDbHealthProbe(): Promise<{
    ok: boolean;
    checks: Record<string, boolean>;
    latencyMs: number;
    saveStore?: string;
    backup?: { completedAt?: number; ageMs?: number; fresh: boolean };
    error?: string;
}> {
    const checks: Record<string, boolean> = {};
    const t0 = Date.now();
    // Which backend `save:*` resolves to. Since the cPanel overlay retirement
    // (2026-07-17) 'base-store' is the EXPECTED production value; a
    // 'disk'/'remote-proxy' value means the rollback overlay was deliberately
    // re-enabled (docs/RETIRE_CPANEL_RUNBOOK.md). Surfaced so release health
    // can gate on EXPECTED_SAVE_STORE and an operator can spot a drifted env.
    let saveStore: string | undefined;
    try {
        const { kv, saveStoreKind } = await import('./api/_storage.js');
        saveStore = saveStoreKind;
        const tag = `${process.pid}-${Date.now()}`;
        const token = Math.random().toString(36).slice(2);

        // Base store: write → read-back → delete.
        const baseKey = `health:probe:${tag}`;
        await kv.set(baseKey, token, { ex: 60 });
        checks.set = true;
        checks.get = (await kv.get<string>(baseKey)) === token;
        checks.del = (await kv.del(baseKey)) >= 1;

        // kv_set_nx RPC.
        const nxKey = `health:probe:nx:${tag}`;
        checks.setNx = (await kv.set(nxKey, token, { nx: true, ex: 60 })) === 'OK';
        await kv.del(nxKey).catch(() => undefined);

        // kv_hset / kv_hdel RPCs.
        const hashKey = `health:probe:hash:${tag}`;
        await kv.hset(hashKey, { f: token });
        const hash = await kv.hgetall<Record<string, unknown>>(hashKey);
        checks.hset = !!hash && hash.f === token;
        await kv.hdel(hashKey, 'f');
        checks.hdel = true;
        await kv.del(hashKey).catch(() => undefined);

        // A `save:`-prefixed key — the exact path /api/save/* and missions read.
        // Post-retirement this resolves to the base store like everything else
        // (saveStore above says which); during a rollback it exercises the
        // re-enabled overlay. The 60s TTL means a failed del can't leave a
        // permanent probe row sitting next to real saves.
        const diskKey = `save:health-probe-${tag}`;
        await kv.set(diskKey, { probe: token }, { ex: 60 });
        checks.diskWrite = true;
        const disk = await kv.get<{ probe?: string }>(diskKey);
        checks.diskRead = !!disk && disk.probe === token;
        await kv.del(diskKey).catch(() => undefined);

        const { isSnapshotMarkerFresh, readSnapshotSuccessMarker } = await import('./api/cron/snapshot-saves.js');
        const marker = await readSnapshotSuccessMarker();
        const fresh = isSnapshotMarkerFresh(marker);
        const backup = {
            completedAt: marker?.completedAt,
            ageMs: marker?.completedAt ? Math.max(0, Date.now() - marker.completedAt) : undefined,
            fresh,
        };
        if (process.env.REQUIRE_FRESH_BACKUP === '1') checks.backupFresh = fresh;

        const ok = Object.values(checks).every(Boolean);
        return { ok, checks, latencyMs: Date.now() - t0, saveStore, backup };
    } catch (err) {
        return { ok: false, checks, latencyMs: Date.now() - t0, saveStore, error: (err as Error).message };
    }
}

app.get(['/health/db', '/api/health/db'], async (req, res) => {
    await sendDeepHealth(req, res);
});

// Normalize a possibly-array header to a single string (Express can hand
// back string[] for repeated headers).
function headerValue(h: string | string[] | undefined): string {
    if (Array.isArray(h)) return h[0] ?? '';
    return h ?? '';
}

// Internal restart endpoint. Passenger respawns the worker when the process
// exits, which reliably picks up new code from disk even when tmp/restart.txt
// isn't honored.
//
// Auth hardening (see "Route parity + deployment safety" handoff):
//   • Prefer a DEDICATED `RESTART_TOKEN` so the powerful KV_PROXY_TOKEN does
//     not double as a worker kill-switch — a KV-token leak should not also
//     grant restart. Falls back to KV_PROXY_TOKEN only when RESTART_TOKEN is
//     unset, so existing operations keep working until the dedicated secret
//     is configured (a one-time warning nudges the migration).
//   • Constant-time compare via safeEqual (no early-exit timing leak).
//   • Array-header safe (headerValue) — repeated headers no longer bypass the
//     `!==` check by arriving as an array.
//   • Small in-memory throttle + audit logging blunt brute-force guessing.
//
// The token is still sent in the existing `x-kv-token` header (also accepts
// `x-restart-token`) so no CORS change is needed — restart is an operational
// server-to-server call, never a browser request.
const RESTART_MAX_ATTEMPTS = 5;
const RESTART_WINDOW_MS = 60_000;
let restartAttempts: number[] = [];   // epoch-ms of recent attempts
let warnedRestartFallback = false;

app.post(['/restart', '/api/restart'], (req, res) => {
    const now = Date.now();
    restartAttempts = restartAttempts.filter((t) => now - t < RESTART_WINDOW_MS);
    const ip = safeLogValue(
        headerValue(req.headers['x-forwarded-for']).split(',')[0].trim()
            || req.socket.remoteAddress
            || 'unknown',
        96,
    );

    if (restartAttempts.length >= RESTART_MAX_ATTEMPTS) {
        console.warn(`[restart] RATE-LIMITED — ${restartAttempts.length} attempts in ${RESTART_WINDOW_MS}ms from ${ip}`); // lgtm[js/log-injection]
        res.status(429).json({ error: 'too many restart attempts' });
        return;
    }
    restartAttempts.push(now);

    const dedicated = process.env.RESTART_TOKEN;
    const expected = dedicated || process.env.KV_PROXY_TOKEN;
    if (!dedicated && process.env.KV_PROXY_TOKEN && !warnedRestartFallback) {
        warnedRestartFallback = true;
        console.warn('[restart] RESTART_TOKEN not set — falling back to KV_PROXY_TOKEN. Set a dedicated RESTART_TOKEN to separate restart auth from the KV proxy secret.');
    }

    const provided = headerValue(req.headers['x-restart-token']) || headerValue(req.headers['x-kv-token']);
    if (!expected || !provided || !safeEqual(provided, expected)) {
        console.warn(`[restart] DENIED from ${ip} at ${new Date(now).toISOString()}`); // lgtm[js/log-injection]
        res.status(401).json({ error: 'invalid restart token' });
        return;
    }

    console.log(`[restart] AUTHORIZED from ${ip} at ${new Date(now).toISOString()} (prevCommit ${_BUILD_INFO.commit})`); // lgtm[js/log-injection]
    res.json({ ok: true, restarting: true, prevCommit: _BUILD_INFO.commit });
    // Let THIS response flush, then drain any OTHER in-flight requests before
    // exiting. The old hard process.exit(0) severed concurrent requests — on
    // cPanel a save-read proxied here mid-restart came back as a Passenger 502.
    setTimeout(() => gracefulShutdown(0, 'operator restart'), 250);
});

// ─── API routes ───────────────────────────────────────────────────────────────

// Save — dynamic :name param merged into req.query.name for the handler.
route('/save/:name', saveHandler);

// Player
route('/player/heartbeat',    heartbeatHandler);
route('/player/travel',       travelHandler);
route('/player/challenge',    challengeHandler);
route('/player/friends',      friendsHandler);
route('/player/attack',       attackHandler);
route('/player/sleeper-kill', sleeperKillHandler);
route('/player/clear-attack', clearAttackHandler);
route('/player/heal',         healHandler);
route('/player/cafeteria',    cafeteriaHandler);
route('/player/roster',       rosterHandler);
route('/player/leaderboards', playerLeaderboardsHandler);
route('/player/trade',        playerTradeHandler);
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

// Admin
route('/admin/players',      adminPlayersHandler);
route('/admin/grant-subscription', adminGrantSubscriptionHandler);
route('/admin/player-index-health', adminPlayerIndexHealthHandler);
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
route('/towers/spire-leaderboard', towersSpireLeaderboardHandler);
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
// Server-gated (404 unless ENABLE_VILLAGE_WAR=1) — inert until launch.
route('/village/war-structure', villageWarStructureHandler);
// Village War Map — Kage sets a home sector's sector-war win-condition (Combat/
// Card; max-7 diversity rule). Server-gated (404 unless ENABLE_VILLAGE_WAR=1).
route('/village/war-win-condition', villageWarWinConditionHandler);
// Village War Map — Kage (3 sectors) / elders (1 each) set a home sector's
// terrain (the defender jutsu-school buff). Server-gated (404 unless flag).
route('/village/war-terrain', villageWarTerrainHandler);
// Village War Map — sector-war battle wiring (Phase 4c): the Kage declares a
// contest (250 WR), a single-use token binds the resulting PvP battle, and
// resolve applies the authoritative winner to Control HP — flipping the sector's
// ownerVillage on capture. Server-gated (404 unless ENABLE_VILLAGE_WAR=1).
route('/village/sector-war', villageSectorWarHandler);
// Village War Map — sector-war "Card" win-condition (Phase 4c-2): an interactive
// 6-turn Card Clash between an attacker- and defender-village member, settling
// the same contest Control HP (forked clan-war engine). Gated (404 unless flag).
route('/village/sector-card', villageSectorCardHandler);
// Village War Map — sector-war "Pet" win-condition (Phase 7): a deterministic 1v1
// pet duel resolved server-side by the generated pet engine (api/pet-sim), settling
// the same contest Control HP. The client replays the same (pets, seed). Gated.
route('/village/sector-pet',  villageSectorPetHandler);
// Anbu Vault Infiltration — L100 sector-attrition raid (start/act/state/report/
// turn-in action switch): fight a daily-sealed Anbu snapshot (Battle Towers
// engine) to skim 1% of the enemy war economy into turn-in caches. NEVER flips
// sector ownership. Gated (404 unless ENABLE_VILLAGE_WAR=1 + ENABLE_ANBU_INFILTRATION=1).
route('/village/anbu-infiltration', anbuInfiltrationHandler);
// Village War Map — read-only aggregator for the client War-Map panel (Phase 6):
// WR/seal pools, structures + upkeep + dormancy, tax tier, active contests.
// GET only, gated (404 unless ENABLE_VILLAGE_WAR=1).
route('/village/war-map', villageWarMapHandler);
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
// sector wars. POST hire/list/attack, gated (404 unless ENABLE_VILLAGE_WAR=1).
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
route('/clan/war/report',    clanWarReportHandler);
route('/clan/war/tilecards', clanWarTilecardsHandler);

// ─── Card Clash: free-play PvP ─────────────────────────────────────────────────
route('/card-clash/queue', cardClashQueueHandler);
route('/card-clash/match', cardClashMatchHandler);
route('/card-clash/ai-start', cardClashAiStartHandler);
route('/card-clash/ai-move', cardClashAiMoveHandler);

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

// ─── Clan Boss Gauntlet: weekly server-wide co-op competition (404 unless ENABLE_CLAN_BOSS=1) ─
// get returns the week's boss + clan pool + standings; assault-start mints a co-op
// tower session on the clan-boss floor; assault-settle banks the finished fight's
// server-computed damage into the clan's shared pool. Weekly cron ranks + rewards top 3.
route('/clan-boss/get',            clanBossGetHandler);
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
// Patreon — OAuth account-link + membership webhook + subscriber status.
// Perks are gated on the server-owned character.patreon flag, written ONLY by
// the signature-verified webhook / OAuth callback (api/patreon/_patreon.ts).
route('/patreon/oauth-start',       patreonOauthStartHandler);
route('/patreon/oauth-callback',    patreonOauthCallbackHandler);
route('/patreon/webhook',           patreonWebhookHandler);
route('/patreon/status',            patreonStatusHandler);
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

// ─── Pet battle result ─────────────────────────────────────────────────────────
route('/pet/battle-start',  petBattleStartHandler);
route('/pet/battle-result', petBattleResultHandler);
route('/pet/warfront-start', petWarfrontStartHandler);
route('/pet/ranked-start',  petRankedStartHandler);
route('/pet/evolve',        petEvolveHandler);
route('/weapon/apply-elemental-core', applyElementalCoreHandler);
route('/weapon/forge-elemental-core', forgeElementalCoreHandler);
route('/pet/gauntlet',      petGauntletHandler);

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

// Release-handoff endpoints. Express has no folder-convention routing, so every
// handler added during the feature and settlement work must be mounted here.
route('/achievements/sync', achievementsSyncHandler);
route('/aura/feed', auraFeedHandler);
route('/awakening/roll', awakeningRollHandler);
route('/bloodlines/forge', bloodlinesForgeHandler);
route('/card-clash/open-pack', cardClashOpenPackHandler);
route('/card-clash/claim-starter', cardClashClaimStarterHandler);
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

// NOTE: Route parity is guarded by `server-routes.test.ts`, which fails
// `npm test` if the client calls an /api path that isn't registered here, or if
// an api/** handler file is never wired in. There is no folder-convention
// auto-routing (Vercel is retired) — add the route above AND the import when you
// add a client-facing endpoint; do not rely on this comment alone.

// ─── Static files (React SPA) ─────────────────────────────────────────────────
// STATIC_DIR env var overrides the default so the same compiled server.js works
// both in the repo (shinobij.client/dist) and in a manual cPanel upload (public/).
// SEO / canonical-domain files. These must be registered before express.static
// and the SPA fallback so crawlers do not receive index.html for robots/sitemap.
app.get('/robots.txt', (_req, res) => {
    res.type('text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(robotsTxt());
});

app.get('/sitemap.xml', (_req, res) => {
    res.type('application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(sitemapXml());
});

// Responsible-disclosure contact (RFC 9116). Served at the well-known path plus
// a root alias. Expires is stamped ~1 year out on each request so the file never
// goes stale. Registered before express.static / SPA fallback so it isn't
// shadowed by index.html.
app.get(['/.well-known/security.txt', '/security.txt'], (_req, res) => {
    res.type('text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    res.send(
        `Contact: mailto:rillt27@gmail.com\n` +
        `Expires: ${expires}\n` +
        `Preferred-Languages: en\n` +
        `Canonical: https://shinobijourney.com/.well-known/security.txt\n` +
        `Policy: https://shinobijourney.com/notices\n`,
    );
});

const staticDir = process.env.STATIC_DIR ?? join(__dirname, '..', 'shinobij.client', 'dist');

// Cache-Control for static assets. Cloudflare (the edge cache in front of
// Railway) only caches what the origin marks cacheable, so without these
// headers edge caching is a near no-op. Two rules:
//   • Content-hashed bundle files (e.g. index-a1b2c3d4.js) are immutable — a
//     content change yields a new filename — so cache them for a year. This is
//     what lets the heavy JS/CSS/img bytes serve from the edge instead of the
//     Railway origin (the only metered-egress tier).
//   • index.html must NEVER be cached: it's the chunk map. A stale index.html
//     pins old hashed <script> URLs that 404 after a deploy — the exact cause
//     of the post-deploy white screen (also guarded now by the ErrorBoundary).
// Content-hashed bundle output. Everything Vite emits under the build's assets/
// dir is content-hashed (e.g. index-D5HRMFzs.js, react-vendor-B5ZEWdOX.js,
// 001-5JXH1tsk.png) — a content change yields a new filename — so it's safe to
// cache for a year, immutable. This is what lets the heavy JS/CSS/img bytes (the
// ~2 MB main bundle, the ~521 KB CSS, every lazy chunk) serve from the edge cache
// instead of the Railway origin (the only metered-egress tier).
//   We match BOTH the assets/ dir AND Vite's hash signature (an exactly-8-char
//   base64 token after the final hyphen). The old `\.[0-9a-f]{8,}\.` pattern
//   assumed a dot-separated lowercase-hex hash and so NEVER matched Vite's real
//   `name-HASH.ext` base64 output — these bundles were silently served max-age=0
//   (revalidated against origin on every load). The dir+hash pair also correctly
//   EXCLUDES verbatim public files that happen to live under assets/ (e.g.
//   public/assets/dungeon/atlas-floor.png), which are fixed-name and must stay on
//   the revalidating media rule below.
const _HASHED_ASSET_RE = /[\\/]assets[\\/].*-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/i;
// Fixed-name media copied verbatim from the client's public/ dir (pet-poses,
// badges, music, sfx, sector-map, arena floors, favicon, dungeon tiles, …). These
// keep their original, reusable names, so they must NOT be immutable: an in-place
// art overwrite would otherwise pin the stale version forever (the same trap that
// keeps index.html uncached). Without an explicit header they fall back to
// express.static's default max-age=0, which makes Cloudflare revalidate against
// the Railway origin on essentially every battle / profile open — the single
// biggest in-session re-fetch cost (pet poses alone are ~31 MB). Give them a
// 1-week cache + a day of stale-while-revalidate: served from the edge, but
// self-healing within a week if art changes. The bulk asset (pet poses) is
// additionally ?v=POSE_ASSET_V cache-busted client-side, so a pose re-clean
// changes the URL and never waits on this TTL. JS/CSS/JSON are excluded here so no
// chunk map or data manifest can go stale.
// 3D model payloads (glb/gltf + their sidecar buffers and compressed textures)
// were missing here, so every pet/arena model served max-age=0 and Cloudflare
// revalidated against the Railway origin on each load — by far the largest
// re-fetched payload in the build (~621 MB of GLBs). They are fixed-name like
// the rest of this group, and the roster URLs additionally carry a ?v= revision
// (ROSTER_MODEL_ASSET_REVISION), so a week of edge cache is safe and a model
// swap that bumps the revision is picked up immediately.
const _STATIC_MEDIA_RE = /\.(?:png|jpe?g|webp|gif|svg|avif|ico|mp3|ogg|wav|woff2?|ttf|otf|glb|gltf|bin|ktx2|basis|hdr)$/i;
const _STATIC_ASSET_URL_RE = /^\/(?:assets|badges|music|sfx|sector-map|scenes)\/.+\.[a-z0-9]+$/i;
// Any request for a file with a real asset extension, wherever it lives
// (/pet-models/roster/*.glb, /combat-vfx/*.webp, /anbu/*, …). Client routes never
// carry a file extension, so matching on extension alone cannot shadow one.
const _ASSET_EXT_URL_RE = /\.(?:js|mjs|css|map|json|png|jpe?g|webp|gif|svg|avif|ico|mp3|ogg|wav|woff2?|ttf|otf|glb|gltf|bin|ktx2|basis|hdr)$/i;

app.use((req, res, next) => {
    if (shouldRedirectToCanonical(req.headers.host, req.path)) {
        res.redirect(301, canonicalRedirectLocation(req.originalUrl));
        return;
    }
    if (isLegacyDuplicateHost(req.headers.host)) {
        res.setHeader('X-Robots-Tag', 'noindex');
    }
    next();
});

app.use(express.static(staticDir, {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache');
        } else if (_HASHED_ASSET_RE.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (_STATIC_MEDIA_RE.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
        }
    },
}));

// If a browser has an old Vite chunk URL after a deploy, do not let the SPA
// fallback serve index.html at that .js/.css URL. Module scripts require a JS
// MIME type; caching HTML under a chunk URL strands players until the bad cache
// entry expires. Real client routes still fall through to the SPA fallback.
app.get(_STATIC_ASSET_URL_RE, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).type('text/plain').send('Static asset not found');
});

// Same guard, widened to ANY asset extension outside those directories — most
// importantly /pet-models/**/*.glb. A missing model previously fell through to
// the SPA fallback and came back as index.html with HTTP 200; the GLTF loader
// then choked on HTML, which surfaces as a hung or crashed 3D scene rather than
// a plain missing asset. A 404 lets the caller fall back cleanly.
app.get(_ASSET_EXT_URL_RE, (req, res, next) => {
    // Never shadow the API's own 404 (which answers JSON) — every real handler
    // is registered above this, so anything left under /api belongs to that path.
    if (/^\/api(?:\/|$)/.test(req.path)) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).type('text/plain').send('Static asset not found');
});

// SPA fallback — any non-API path serves index.html so React Router handles it.
// no-cache so a deploy never serves a stale chunk map (matches express.static above).
app.all(/^\/api(?:\/|$)/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).json({ error: 'API route not found.' });
});

// The SPA fallback is the hottest static path (every deep link / client-route
// navigation lands here), so serve index.html from memory instead of a
// stat+open per request. The file only changes on deploy, and a deploy always
// restarts the process on both hosts (Railway container swap; cPanel
// auto-deploy restarts Passenger), so a boot-time-frozen copy can never go
// stale. Lazily read on first hit — staticDir is env-dependent — and falls
// back to sendFile if the read ever fails so a missing file still surfaces
// through the normal error path.
let _indexHtmlCache: Buffer | null = null;
app.get(/(.*)/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    if (_indexHtmlCache) {
        res.type('html').send(_indexHtmlCache);
        return;
    }
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require('node:fs') as typeof import('node:fs');
        _indexHtmlCache = fs.readFileSync(join(staticDir, 'index.html'));
        res.type('html').send(_indexHtmlCache);
    } catch {
        res.sendFile(join(staticDir, 'index.html'));
    }
});

// ─── Error handler ────────────────────────────────────────────────────────────

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const reqId = (req as Request & { id?: string }).id ?? '-';
    if (isMalformedJsonBodyError(err, req.body)) {
        if (!res.headersSent) {
            res.status(400).json({ error: MALFORMED_JSON_BODY_ERROR, requestId: reqId });
        }
        return;
    }

    // Keep request-controlled values out of the format-string position. Some
    // loggers interpret percent directives in their first argument.
    console.error(
        '[server error]',
        '[req]',
        safeLogValue(reqId, 128),
        safeLogValue(req.method, 16),
        safeLogValue(req.path, 512),
        safeLogValue(err instanceof Error ? (err.stack ?? err.message) : err, 2_000), // lgtm[js/log-injection]
    );
    // Every route() handler error funnels here via next(err), so this is the one
    // place that sees them all. Report before responding; never let a reporting
    // failure mask the 500. No-op when Sentry is disabled (SENTRY_DSN unset).
    if (Sentry) {
        captureExpressException(Sentry, req, err);
    }
    if (!res.headersSent) {
        // Echo the correlation id so a player can quote it in a bug report and an
        // admin can grep the exact server log line.
        res.status(500).json(publicErrorPayload(err, reqId));
    }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3000);

// Phusion Passenger sets the PORT env var automatically.
// When running locally, defaults to 3000.
const server = createServer(app);
_httpServer = server; // expose to gracefulShutdown (drain-before-exit on restart/crash)
// Phase 2/Step 3: attach the Socket.IO realtime layer to the SAME HTTP server
// (registers the sweep→presence:gone listener). No-op when DISABLE_REALTIME=1;
// the client then falls back to the HTTP heartbeat. Done before startGameLoop
// so the sweep listener is registered before the first tick.
attachSocketServer(server);
server.listen(PORT, () => {
    console.log(`ShinobiX API listening on port ${PORT}`);
    // SESSION_SECRET is optional by design — without it, token issuing/verifying is
    // disabled and auth transparently falls back to verifying the password on every
    // request (see api/_auth.ts). That fallback works, but it is MUCH more expensive
    // (a scrypt hash per authenticated request instead of an HMAC compare) and it
    // silently un-does the token-first model. It is never the intended production
    // state, and a missing value is invisible until the site is slow under load, so
    // say so loudly at boot rather than leaving it to be discovered in an incident.
    if (!String(process.env.SESSION_SECRET ?? '').trim()) {
        console.error(
            '[startup] SESSION_SECRET is NOT set. Session tokens are disabled and every '
            + 'authenticated request will re-verify the password with scrypt. Set it in the '
            + 'Railway environment and redeploy.',
        );
    }
    // Rehydrate the online roster the previous process handed over, so a deploy does
    // not present an empty world for a beat. Rows past the offline window are dropped
    // on restore, and a live heartbeat always wins, so this can only ever add players
    // who were genuinely online seconds ago.
    void restorePresenceSnapshot()
        .then((restored) => { if (restored > 0) console.log(`[presence] restored ${restored} online player(s) across restart`); })
        .catch(() => undefined);
    startPresenceSnapshots();
    // Phase 2: start the 1s in-memory presence/game tick (single instance).
    startGameLoop();
    // Vercel removal: the always-on server now runs the daily save-snapshot
    // backup itself (was a Vercel cron). No-op if DISABLE_SNAPSHOT_CRON=1.
    startSnapshotCron();
});

export default app;
