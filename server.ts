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
import attackHandler     from './api/player/attack.js';
import clearAttackHandler from './api/player/clear-attack.js';
import healHandler       from './api/player/heal.js';
import rosterHandler     from './api/player/roster.js';
import pvpSessionHandler from './api/pvp/session.js';
import pvpMoveHandler    from './api/pvp/move.js';
import imagesHandler     from './api/images.js';
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
import kageHandler         from './api/village/kage.js';
import bloodlineReviewHandler from './api/admin/bloodline-review.js';
import itemReviewHandler   from './api/admin/item-review.js';
import bloodlinesListHandler from './api/bloodlines/list.js';
import rankedJoinHandler  from './api/ranked-queue/join.js';
import rankedLeaveHandler from './api/ranked-queue/leave.js';
import kvProxyHandler     from './api/kv-proxy.js';
import migrateKvHandler   from './api/admin/migrate-kv.js';
import raidStartHandler   from './api/missions/raid-start.js';
import villageTreasuryTransferHandler from './api/village/treasury-transfer.js';
import saveSnapshotHandler from './api/admin/save-snapshot.js';

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
// Clan — pet escort
import clanPetEscortListHandler   from './api/clan/pet-escort/list.js';
import clanPetEscortOfferHandler  from './api/clan/pet-escort/offer.js';
import clanPetEscortCancelHandler from './api/clan/pet-escort/cancel.js';
// Missions — daily + reporting
import missionsDailyHandler          from './api/missions/daily.js';
import missionsReportRaidHandler     from './api/missions/report-raid.js';
import missionsReportPvpWinHandler   from './api/missions/report-pvp-win.js';
import missionsReportPetEventHandler from './api/missions/report-pet-event.js';
// PvP — realtime + rewards + queues
import pvpChatHandler           from './api/pvp/chat.js';
import pvpSpectateHandler       from './api/pvp/spectate.js';
import pvpStreamHandler         from './api/pvp/stream.js';
import pvpClaimRewardsHandler   from './api/pvp/claim-rewards.js';
import pvpRankedQueueHandler    from './api/pvp/ranked-queue.js';
import pvpPetRankedQueueHandler from './api/pvp/pet-ranked-queue.js';
// Pet
import petBattleResultHandler from './api/pet/battle-result.js';
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

// Shared auth helper — constant-time compare for the restart endpoint.
import { safeEqual } from './api/_auth.js';

// ─── App setup ───────────────────────────────────────────────────────────────

const app = express();

// Parse JSON bodies up to 50 MB (needed for saves that include base64 images).
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Global CORS — restrict to known origins so a malicious site can't initiate
// authenticated requests from a visitor's browser. Same allowlist as
// api/_utils.ts cors().
const ALLOWED_ORIGINS = new Set<string>([
    'https://theravensark.com',
    'https://www.theravensark.com',
    'https://test-five-delta-37.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
]);
// Mirror the safe-method allowlist from api/_utils.ts cors(). The old
// version sent `*` for ANY method when no Origin was present, which is
// strictly looser than the Vercel path (which only allows `*` for safe
// methods). An unsafe method with no Origin gets no ACAO header now,
// matching Vercel behaviour.
const SAFE_METHODS = new Set<string>(['GET', 'HEAD', 'OPTIONS']);
app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = (req.headers.origin as string | undefined) ?? '';
    const method = (req.method ?? 'GET').toUpperCase();
    if (origin && ALLOWED_ORIGINS.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    } else if (!origin && SAFE_METHODS.has(method)) {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password, x-player-password, x-player-name, x-player-token, x-kv-token, x-client-fp');
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    next();
});

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

app.get(['/health', '/api/health'], (_req, res) => {
    res.json({ ok: true, ..._BUILD_INFO });
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
route('/player/attack',       attackHandler);
route('/player/clear-attack', clearAttackHandler);
route('/player/heal',         healHandler);
route('/player/roster',       rosterHandler);

// PvP
route('/pvp/session', pvpSessionHandler);
route('/pvp/move',    pvpMoveHandler);

// Images
route('/images', imagesHandler);

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

// Village
route('/village/kage', kageHandler);

// Bloodlines
route('/bloodlines/list', bloodlinesListHandler);

// Admin review queues
route('/admin/bloodline-review', bloodlineReviewHandler);
route('/admin/item-review',      itemReviewHandler);

// Ranked queue
route('/ranked-queue/join',  rankedJoinHandler);
route('/ranked-queue/leave', rankedLeaveHandler);

// Internal KV proxy — Vercel forwards disk-routed keys here.
// Mounted with a trailing :op param so /api/kv/get etc. all hit one handler.
route('/kv/:op', kvProxyHandler);

// Admin: migrate disk-routed keys from Supabase → disk overlay.
route('/admin/migrate-kv', migrateKvHandler);

// Missions — AI raid token mint (PvP raids cross-validate via PvpSession;
// AI raids use this short-lived single-use token instead).
route('/missions/raid-start', raidStartHandler);

// Village treasury — atomic Kage-gift endpoint that replaces the broken
// 2-write client flow (deduct treasury + patch recipient).
route('/village/treasury/transfer', villageTreasuryTransferHandler);

// Admin: snapshot / list / restore a player save (90-day TTL). Survives
// server-reset because the `save-snapshot:` prefix isn't matched by the
// reset's `save:*` glob.
route('/admin/save-snapshot', saveSnapshotHandler);

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

// ─── Clan: pet escort ──────────────────────────────────────────────────────────
route('/clan/pet-escort/list',   clanPetEscortListHandler);
route('/clan/pet-escort/offer',  clanPetEscortOfferHandler);
route('/clan/pet-escort/cancel', clanPetEscortCancelHandler);

// ─── Missions: daily + reporting ───────────────────────────────────────────────
route('/missions/daily',            missionsDailyHandler);
route('/missions/report-raid',      missionsReportRaidHandler);
route('/missions/report-pvp-win',   missionsReportPvpWinHandler);
route('/missions/report-pet-event', missionsReportPetEventHandler);

// ─── PvP: realtime, rewards, ranked queues ─────────────────────────────────────
// stream/spectate hold the connection open (SSE / long-poll); the generic
// route() wrapper passes res straight through so the handlers stream normally.
route('/pvp/chat',             pvpChatHandler);
route('/pvp/spectate',         pvpSpectateHandler);
route('/pvp/stream',           pvpStreamHandler);
route('/pvp/claim-rewards',    pvpClaimRewardsHandler);
route('/pvp/ranked-queue',     pvpRankedQueueHandler);
route('/pvp/pet-ranked-queue', pvpPetRankedQueueHandler);

// ─── Pet battle result ─────────────────────────────────────────────────────────
route('/pet/battle-result', petBattleResultHandler);

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

// NOTE: Route parity between Vercel (folder convention) and cPanel (this file)
// is now guarded by `server-routes.test.ts`, which fails CI/`npm test` if the
// client calls an /api path that isn't registered here. Add the route above
// AND the import when you add a client-facing endpoint — do not rely on this
// comment alone.

// ─── Static files (React SPA) ─────────────────────────────────────────────────
// STATIC_DIR env var overrides the default so the same compiled server.js works
// both in the repo (shinobij.client/dist) and in a manual cPanel upload (public/).
const staticDir = process.env.STATIC_DIR ?? join(__dirname, '..', 'shinobij.client', 'dist');

app.use(express.static(staticDir));

// SPA fallback — any non-API path serves index.html so React Router handles it.
app.get(/(.*)/, (_req, res) => {
    res.sendFile(join(staticDir, 'index.html'));
});

// ─── Error handler ────────────────────────────────────────────────────────────

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[server error]', err);
    if (!res.headersSent) {
        res.status(500).json({ error: String(err) });
    }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3000);

// Phusion Passenger sets the PORT env var automatically.
// When running locally, defaults to 3000.
const server = createServer(app);
server.listen(PORT, () => {
    console.log(`ShinobiX API listening on port ${PORT}`);
});

export default app;
