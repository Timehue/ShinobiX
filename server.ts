/**
 * Express server for cPanel / Phusion Passenger.
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

import { startGameLoop } from './api/_realtime/game-loop.js';
import { attachSocketServer } from './api/_realtime/socket.js';
import { startSnapshotCron } from './api/cron/_scheduler.js';
import compression from 'compression';
import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer } from 'node:http';
import { join } from 'node:path';

// ─── Handler imports ─────────────────────────────────────────────────────────
// All handlers use import type { VercelRequest, VercelResponse } for TypeScript
// only — those types are erased at compile time, so there is zero runtime
// dependency on @vercel/node in the cPanel build.

import saveHandler       from './api/save/[name].js';
import heartbeatHandler  from './api/player/heartbeat.js';
import challengeHandler  from './api/player/challenge.js';
import friendsHandler    from './api/player/friends.js';
import attackHandler     from './api/player/attack.js';
import clearAttackHandler from './api/player/clear-attack.js';
import healHandler       from './api/player/heal.js';
import rosterHandler     from './api/player/roster.js';
import pvpSessionHandler from './api/pvp/session.js';
import pvpMoveHandler    from './api/pvp/move.js';
import imagesHandler     from './api/images.js';
import imgHandler        from './api/img.js';
import playerAuthHandler from './api/player-auth.js';
import adminAuthHandler  from './api/admin-auth.js';
import adminPlayersHandler from './api/admin/players.js';
import serverResetHandler from './api/admin/server-reset.js';
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
import perfBeaconHandler   from './api/perf-beacon.js';
import kageHandler         from './api/village/kage.js';
import kageChallengeHandler from './api/village/kage-challenge.js';
import bloodlineReviewHandler from './api/admin/bloodline-review.js';
import itemReviewHandler   from './api/admin/item-review.js';
import bloodlinesListHandler from './api/bloodlines/list.js';
import kvProxyHandler     from './api/kv-proxy.js';
import migrateKvHandler   from './api/admin/migrate-kv.js';
import raidStartHandler   from './api/missions/raid-start.js';
import expeditionStartHandler from './api/missions/expedition-start.js';
import battleLockHandler  from './api/battle/lock.js';
import villageTreasuryTransferHandler from './api/village/treasury/transfer.js';
import villageTreasuryDonateHandler from './api/village/treasury/donate.js';
import villageClaimDailyAgendaHandler from './api/village/claim-daily-agenda.js';
import villageClaimMapControlHandler from './api/village/claim-map-control.js';
import bankClaimInterestHandler from './api/bank/claim-interest.js';
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
// Clan — membership: kick (server-authoritative cross-save removal)
import clanKickHandler               from './api/clan/kick.js';
// Clan — pet escort
import clanPetEscortListHandler   from './api/clan/pet-escort/list.js';
import clanPetEscortOfferHandler  from './api/clan/pet-escort/offer.js';
import clanPetEscortCancelHandler from './api/clan/pet-escort/cancel.js';
// Missions — daily + reporting
import missionsDailyHandler          from './api/missions/daily.js';
import missionsReportRaidHandler     from './api/missions/report-raid.js';
import missionsReportPvpWinHandler   from './api/missions/report-pvp-win.js';
import missionsReportPetEventHandler from './api/missions/report-pet-event.js';
import missionsClaimMissionHandler   from './api/missions/claim-mission.js';
// PvP — realtime + rewards + queues
import pvpChatHandler           from './api/pvp/chat.js';
import pvpSpectateHandler       from './api/pvp/spectate.js';
import pvpStreamHandler         from './api/pvp/stream.js';
import pvpCombatLogHandler      from './api/pvp/combat-log.js';
import pvpClaimRewardsHandler   from './api/pvp/claim-rewards.js';
import pvpRankedQueueHandler    from './api/pvp/ranked-queue.js';
import pvpPetRankedQueueHandler from './api/pvp/pet-ranked-queue.js';
// Pet
import petBattleResultHandler from './api/pet/battle-result.js';
import petRankedStartHandler from './api/pet/ranked-start.js';
import petEvolveHandler from './api/pet/evolve.js';
import arenaLobbyHandler from './api/arena/lobby.js';
// Jutsu
import jutsuSpeedupHandler       from './api/jutsu/speedup.js';
import jutsuTrainWithSealsHandler from './api/jutsu/train-with-seals.js';
// Profession
import professionChooseHandler from './api/profession/choose.js';
// Player
import injuredVillagersHandler from './api/player/injured-villagers.js';
// Weekly boss
import weeklyBossHandler from './api/weekly-boss.js';
// Admin moderation
import moderationHandler from './api/admin/moderation.js';
// Admin: durable battle-receipt lookup (support / reward-dispute debugging)
import adminBattleReceiptsHandler from './api/admin/battle-receipts.js';
// Admin: asset-registry report + per-domain audit-log reader (diagnostics)
import adminAssetReportHandler from './api/admin/asset-report.js';
import adminAuditLogHandler from './api/admin/audit-log.js';

// Shared auth helper — constant-time compare for the restart endpoint.
import { safeEqual } from './api/_auth.js';
// CORS origin predicate — single source of truth, shared with cors() and the
// Socket.IO layer so the three CORS surfaces can't drift (CLAUDE.md). Handles
// the static allowlist, EXTRA_ALLOWED_ORIGINS env additions, and *.up.railway.app.
import { isAllowedOrigin } from './api/_utils.js';

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
            tracesSampleRate: 0,
            sendDefaultPii: false,
        });
        console.log('[sentry] server error reporting enabled');
    } catch (err) {
        console.warn('[sentry] @sentry/node unavailable — error reporting disabled:', (err as Error)?.message);
        Sentry = null;
    }
}

// ─── App setup ───────────────────────────────────────────────────────────────

const app = express();

// Parse JSON bodies up to 50 MB (needed for saves that include base64 images).
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password, x-player-password, x-player-name, x-player-token, x-kv-token, x-client-fp');
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
            // Merge route params into query so Vercel-style handlers work.
            const augmented = {
                ...req,
                query: { ...req.query, ...req.params },
                headers: req.headers,
                method: req.method,
                body: req.body,
            };
            await handler(augmented, res);
        } catch (err) {
            next(err);
        }
    });
}

// ─── Health / debug routes ───────────────────────────────────────────────────
// (auto-deploy smoke test)

// Cached at module-load time so each request is a free read.
const _BUILD_INFO = (() => {
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
        return { commit: sha.slice(0, 8), startedAt: new Date().toISOString() };
    } catch {
        return { commit: 'unknown', startedAt: new Date().toISOString() };
    }
})();

app.get(['/health', '/api/health'], async (req, res) => {
    // Default: cheap process-liveness (what Railway's configured health check
    // hits — must stay fast so a slow DB can't flap the deploy). ?deep=1 runs
    // the full DB/KV readiness probe (same as /health/db).
    if (req.query.deep === '1') {
        res.setHeader('Cache-Control', 'no-store');
        const result = await runDbHealthProbe();
        res.status(result.ok ? 200 : 503).json({ ...result, ..._BUILD_INFO });
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
// /health?deep=1. Never cached. Returns 503 (not 200) when any check fails.
async function runDbHealthProbe(): Promise<{ ok: boolean; checks: Record<string, boolean>; latencyMs: number; saveStore?: string; error?: string }> {
    const checks: Record<string, boolean> = {};
    const t0 = Date.now();
    // Which backend `save:*` resolves to. 'base-store' on a host that serves
    // /api/save/* means the disk overlay is misconfigured and saves are being
    // read/written against the wrong (empty) store — see REQUIRE_DISK_OVERLAY
    // in api/_storage.ts. Surfacing it here lets an operator catch that instantly.
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

        // Disk-routed overlay (the `save:<player>` reads missions depend on).
        const diskKey = `save:health-probe-${tag}`;
        await kv.set(diskKey, { probe: token });
        checks.diskWrite = true;
        const disk = await kv.get<{ probe?: string }>(diskKey);
        checks.diskRead = !!disk && disk.probe === token;
        await kv.del(diskKey).catch(() => undefined);

        const ok = Object.values(checks).every(Boolean);
        return { ok, checks, latencyMs: Date.now() - t0, saveStore };
    } catch (err) {
        return { ok: false, checks, latencyMs: Date.now() - t0, saveStore, error: (err as Error).message };
    }
}

app.get(['/health/db', '/api/health/db'], async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const result = await runDbHealthProbe();
    res.status(result.ok ? 200 : 503).json({ ...result, ..._BUILD_INFO });
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
    const ip = headerValue(req.headers['x-forwarded-for']).split(',')[0].trim()
        || req.socket.remoteAddress || 'unknown';

    if (restartAttempts.length >= RESTART_MAX_ATTEMPTS) {
        console.warn(`[restart] RATE-LIMITED — ${restartAttempts.length} attempts in ${RESTART_WINDOW_MS}ms from ${ip}`);
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
        console.warn(`[restart] DENIED from ${ip} at ${new Date(now).toISOString()}`);
        res.status(401).json({ error: 'invalid restart token' });
        return;
    }

    console.log(`[restart] AUTHORIZED from ${ip} at ${new Date(now).toISOString()} (prevCommit ${_BUILD_INFO.commit})`);
    res.json({ ok: true, restarting: true, prevCommit: _BUILD_INFO.commit });
    // Give the response a chance to flush before exiting.
    setTimeout(() => {
        console.log('[restart] exiting worker on operator request');
        process.exit(0);
    }, 250);
});

// ─── API routes ───────────────────────────────────────────────────────────────

// Save — dynamic :name param merged into req.query.name for the handler.
route('/save/:name', saveHandler);

// Player
route('/player/heartbeat',    heartbeatHandler);
route('/player/challenge',    challengeHandler);
route('/player/friends',      friendsHandler);
route('/player/attack',       attackHandler);
route('/player/clear-attack', clearAttackHandler);
route('/player/heal',         healHandler);
route('/player/roster',       rosterHandler);

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
route('/admin/server-reset', serverResetHandler);

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

// Phase 0 load/refresh telemetry — anonymous, zero-storage beacon sink. Logs a
// single `[perf]` line per page load to stdout (see api/perf-beacon.ts).
route('/perf-beacon', perfBeaconHandler);

// Village
route('/village/kage', kageHandler);
// Village — server-authoritative Kage succession (declare/press/accept/resolve).
route('/village/kage-challenge', kageChallengeHandler);

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

// Missions — AI raid token mint (PvP raids cross-validate via PvpSession;
// AI raids use this short-lived single-use token instead).
route('/missions/raid-start', raidStartHandler);
// Battle lock — server-side "in a PvE fight" marker (start/resolve/status) so a
// refresh can't escape a battle; resume-only, pays/punishes nothing (see
// api/battle/lock.ts).
route('/battle/lock', battleLockHandler);
// Missions — pet expedition token mint (single-use, time-gated; redeemed by
// report-pet-event so expedition rewards require a real, fully-elapsed run).
route('/missions/expedition-start', expeditionStartHandler);

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
// Bank interest — server-authoritative personal claim (server computes
// floor(bankRyo×rate) under the save lock + 24h gate). Audit #7 / Stage 3 Phase 4f.
route('/bank/claim-interest', bankClaimInterestHandler);

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

// ─── Clan: kick a member (server-authoritative) ─────────────────────────────────
// Leadership-only. Removes the member from the clan row AND clears their
// character.clan on their own save (the cross-save write a client can't do).
route('/clan/kick', clanKickHandler);

// ─── Clan: pet escort ──────────────────────────────────────────────────────────
route('/clan/pet-escort/list',   clanPetEscortListHandler);
route('/clan/pet-escort/offer',  clanPetEscortOfferHandler);
route('/clan/pet-escort/cancel', clanPetEscortCancelHandler);

// ─── Missions: daily + reporting ───────────────────────────────────────────────
route('/missions/daily',            missionsDailyHandler);
route('/missions/report-raid',      missionsReportRaidHandler);
route('/missions/report-pvp-win',   missionsReportPvpWinHandler);
route('/missions/report-pet-event', missionsReportPetEventHandler);
route('/missions/claim-mission',    missionsClaimMissionHandler);

// ─── PvP: realtime, rewards, ranked queues ─────────────────────────────────────
// stream/spectate hold the connection open (SSE / long-poll); the generic
// route() wrapper passes res straight through so the handlers stream normally.
route('/pvp/chat',             pvpChatHandler);
route('/pvp/spectate',         pvpSpectateHandler);
route('/pvp/stream',           pvpStreamHandler);
route('/pvp/combat-log',       pvpCombatLogHandler);
route('/pvp/claim-rewards',    pvpClaimRewardsHandler);
route('/pvp/ranked-queue',     pvpRankedQueueHandler);
route('/pvp/pet-ranked-queue', pvpPetRankedQueueHandler);

// ─── Pet battle result ─────────────────────────────────────────────────────────
route('/pet/battle-result', petBattleResultHandler);
route('/pet/ranked-start',  petRankedStartHandler);
route('/pet/evolve',        petEvolveHandler);

// ─── Co-op Tactical Pet Arena lobby ─────────────────────────────────────────────
route('/arena/lobby', arenaLobbyHandler);

// ─── Jutsu training ────────────────────────────────────────────────────────────
route('/jutsu/speedup',         jutsuSpeedupHandler);
route('/jutsu/train-with-seals', jutsuTrainWithSealsHandler);

// ─── Profession ────────────────────────────────────────────────────────────────
route('/profession/choose', professionChooseHandler);

// ─── Player: injured villagers (Hospital screen) ───────────────────────────────
route('/player/injured-villagers', injuredVillagersHandler);

// ─── Weekly boss (Hall of Legends) ─────────────────────────────────────────────
route('/weekly-boss', weeklyBossHandler);

// ─── Admin: moderation (bans / silences / IP linkage) ──────────────────────────
route('/admin/moderation', moderationHandler);

// ─── Admin: durable battle-receipt lookup (support / reward-dispute triage) ─────
route('/admin/battle-receipts', adminBattleReceiptsHandler);

// ─── Admin: asset-registry report + per-domain audit-log reader ─────────────────
route('/admin/asset-report', adminAssetReportHandler);
route('/admin/audit-log', adminAuditLogHandler);

// NOTE: Route parity is guarded by `server-routes.test.ts`, which fails
// `npm test` if the client calls an /api path that isn't registered here, or if
// an api/** handler file is never wired in. There is no folder-convention
// auto-routing (Vercel is retired) — add the route above AND the import when you
// add a client-facing endpoint; do not rely on this comment alone.

// ─── Static files (React SPA) ─────────────────────────────────────────────────
// STATIC_DIR env var overrides the default so the same compiled server.js works
// both in the repo (shinobij.client/dist) and in a manual cPanel upload (public/).
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
const _HASHED_ASSET_RE = /\.[0-9a-f]{8,}\.(?:js|css|woff2?|png|jpe?g|webp|gif|svg|avif|mp3|ogg|wav)$/i;
app.use(express.static(staticDir, {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache');
        } else if (_HASHED_ASSET_RE.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
    },
}));

// SPA fallback — any non-API path serves index.html so React Router handles it.
// no-cache so a deploy never serves a stale chunk map (matches express.static above).
app.get(/(.*)/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(join(staticDir, 'index.html'));
});

// ─── Error handler ────────────────────────────────────────────────────────────

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[server error]', err);
    // Every route() handler error funnels here via next(err), so this is the one
    // place that sees them all. Report before responding; never let a reporting
    // failure mask the 500. No-op when Sentry is disabled (SENTRY_DSN unset).
    if (Sentry) {
        try { Sentry.captureException(err); } catch { /* swallow */ }
    }
    if (!res.headersSent) {
        res.status(500).json({ error: String(err) });
    }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3000);

// Phusion Passenger sets the PORT env var automatically.
// When running locally, defaults to 3000.
const server = createServer(app);
// Phase 2/Step 3: attach the Socket.IO realtime layer to the SAME HTTP server
// (registers the sweep→presence:gone listener). No-op when DISABLE_REALTIME=1;
// the client then falls back to the HTTP heartbeat. Done before startGameLoop
// so the sweep listener is registered before the first tick.
attachSocketServer(server);
server.listen(PORT, () => {
    console.log(`ShinobiX API listening on port ${PORT}`);
    // Phase 2: start the 1s in-memory presence/game tick (single instance).
    startGameLoop();
    // Vercel removal: the always-on server now runs the daily save-snapshot
    // backup itself (was a Vercel cron). No-op if DISABLE_SNAPSHOT_CRON=1.
    startSnapshotCron();
});

export default app;
