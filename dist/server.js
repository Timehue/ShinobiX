"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Must be first: pins outbound connections to IPv4 when FORCE_IPV4=1 (Railway).
// No-op on cPanel (gated on the env var) so it never clobbers app.js's dispatcher.
require("./api/_force-ipv4.js");
const game_loop_js_1 = require("./api/_realtime/game-loop.js");
const socket_js_1 = require("./api/_realtime/socket.js");
const _scheduler_js_1 = require("./api/cron/_scheduler.js");
const compression_1 = __importDefault(require("compression"));
const express_1 = __importDefault(require("express"));
const node_http_1 = require("node:http");
const node_path_1 = require("node:path");
// ─── Handler imports ─────────────────────────────────────────────────────────
// All handlers use import type { VercelRequest, VercelResponse } for TypeScript
// only — those types are erased at compile time, so there is zero runtime
// dependency on @vercel/node in the cPanel build.
const _name__js_1 = __importDefault(require("./api/save/[name].js"));
const heartbeat_js_1 = __importDefault(require("./api/player/heartbeat.js"));
const challenge_js_1 = __importDefault(require("./api/player/challenge.js"));
const friends_js_1 = __importDefault(require("./api/player/friends.js"));
const attack_js_1 = __importDefault(require("./api/player/attack.js"));
const clear_attack_js_1 = __importDefault(require("./api/player/clear-attack.js"));
const heal_js_1 = __importDefault(require("./api/player/heal.js"));
const roster_js_1 = __importDefault(require("./api/player/roster.js"));
const trade_js_1 = __importDefault(require("./api/player/trade.js"));
const black_market_js_1 = __importDefault(require("./api/festival/black-market.js"));
const session_js_1 = __importDefault(require("./api/pvp/session.js"));
const move_js_1 = __importDefault(require("./api/pvp/move.js"));
const images_js_1 = __importDefault(require("./api/images.js"));
const img_js_1 = __importDefault(require("./api/img.js"));
const player_auth_js_1 = __importDefault(require("./api/player-auth.js"));
const admin_auth_js_1 = __importDefault(require("./api/admin-auth.js"));
const players_js_1 = __importDefault(require("./api/admin/players.js"));
const server_reset_js_1 = __importDefault(require("./api/admin/server-reset.js"));
const ranked_season_js_1 = __importDefault(require("./api/admin/ranked-season.js"));
const list_js_1 = __importDefault(require("./api/clans/list.js"));
const chat_js_1 = __importDefault(require("./api/village/chat.js"));
const queue_js_1 = __importDefault(require("./api/village-guard/queue.js"));
const dequeue_js_1 = __importDefault(require("./api/village-guard/dequeue.js"));
const list_js_2 = __importDefault(require("./api/village-guard/list.js"));
const challenge_js_2 = __importDefault(require("./api/village-guard/challenge.js"));
const generate_image_js_1 = __importDefault(require("./api/generate-image.js"));
const game_state_js_1 = __importDefault(require("./api/game-state.js"));
const world_state_js_1 = __importDefault(require("./api/world-state.js"));
const messages_js_1 = __importDefault(require("./api/messages.js"));
const perf_beacon_js_1 = __importDefault(require("./api/perf-beacon.js"));
const kage_js_1 = __importDefault(require("./api/village/kage.js"));
const kage_challenge_js_1 = __importDefault(require("./api/village/kage-challenge.js"));
const war_debuff_js_1 = __importDefault(require("./api/village/war-debuff.js"));
const bloodline_review_js_1 = __importDefault(require("./api/admin/bloodline-review.js"));
const item_review_js_1 = __importDefault(require("./api/admin/item-review.js"));
const list_js_3 = __importDefault(require("./api/bloodlines/list.js"));
const kv_proxy_js_1 = __importDefault(require("./api/kv-proxy.js"));
const migrate_kv_js_1 = __importDefault(require("./api/admin/migrate-kv.js"));
const raid_start_js_1 = __importDefault(require("./api/missions/raid-start.js"));
const floors_js_1 = __importDefault(require("./api/towers/floors.js"));
const start_js_1 = __importDefault(require("./api/towers/start.js"));
const action_js_1 = __importDefault(require("./api/towers/action.js"));
const state_js_1 = __importDefault(require("./api/towers/state.js"));
const settle_js_1 = __importDefault(require("./api/towers/settle.js"));
const my_run_js_1 = __importDefault(require("./api/towers/my-run.js"));
const join_js_1 = __importDefault(require("./api/towers/join.js"));
const expedition_start_js_1 = __importDefault(require("./api/missions/expedition-start.js"));
const lock_js_1 = __importDefault(require("./api/battle/lock.js"));
const transfer_js_1 = __importDefault(require("./api/village/treasury/transfer.js"));
const donate_js_1 = __importDefault(require("./api/village/treasury/donate.js"));
const claim_daily_agenda_js_1 = __importDefault(require("./api/village/claim-daily-agenda.js"));
const claim_map_control_js_1 = __importDefault(require("./api/village/claim-map-control.js"));
const claim_interest_js_1 = __importDefault(require("./api/bank/claim-interest.js"));
const save_snapshot_js_1 = __importDefault(require("./api/admin/save-snapshot.js"));
// Cron — daily save-snapshot HTTP trigger. The nightly run is in-process via
// startSnapshotCron (api/cron/_scheduler.ts); this endpoint stays for manual
// ops/admin triggers. On Vercel the api/ folder convention exposed it; off
// Vercel it must be registered explicitly or it 404s.
const snapshot_saves_js_1 = __importDefault(require("./api/cron/snapshot-saves.js"));
// Clan — wars
const list_js_4 = __importDefault(require("./api/clan/war/list.js"));
const declare_js_1 = __importDefault(require("./api/clan/war/declare.js"));
const challenge_js_3 = __importDefault(require("./api/clan/war/challenge.js"));
const report_js_1 = __importDefault(require("./api/clan/war/report.js"));
const tilecards_js_1 = __importDefault(require("./api/clan/war/tilecards.js"));
// Clan — seal pool
const get_js_1 = __importDefault(require("./api/clan/seal-pool/get.js"));
const donate_js_2 = __importDefault(require("./api/clan/seal-pool/donate.js"));
const distribute_js_1 = __importDefault(require("./api/clan/seal-pool/distribute.js"));
// Clan — treasury donate (atomic)
const donate_js_3 = __importDefault(require("./api/clan/treasury/donate.js"));
const transfer_js_2 = __importDefault(require("./api/clan/treasury/transfer.js"));
// Clan — territory war-supply collect (server-authoritative)
const collect_supply_js_1 = __importDefault(require("./api/clan/territory/collect-supply.js"));
// Clan — upgrade tree purchase (server-authoritative spend from treasury)
const purchase_js_1 = __importDefault(require("./api/clan/upgrade/purchase.js"));
// Clan — membership: kick (server-authoritative cross-save removal)
const kick_js_1 = __importDefault(require("./api/clan/kick.js"));
const mentor_js_1 = __importDefault(require("./api/clan/mentor.js"));
// Clan — pet escort
const list_js_5 = __importDefault(require("./api/clan/pet-escort/list.js"));
const offer_js_1 = __importDefault(require("./api/clan/pet-escort/offer.js"));
const cancel_js_1 = __importDefault(require("./api/clan/pet-escort/cancel.js"));
// Missions — daily + reporting
const daily_js_1 = __importDefault(require("./api/missions/daily.js"));
const weekly_board_js_1 = __importDefault(require("./api/missions/weekly-board.js"));
const report_raid_js_1 = __importDefault(require("./api/missions/report-raid.js"));
const report_pvp_win_js_1 = __importDefault(require("./api/missions/report-pvp-win.js"));
const report_pet_event_js_1 = __importDefault(require("./api/missions/report-pet-event.js"));
const claim_mission_js_1 = __importDefault(require("./api/missions/claim-mission.js"));
// PvP — realtime + rewards + queues
const chat_js_2 = __importDefault(require("./api/pvp/chat.js"));
const spectate_js_1 = __importDefault(require("./api/pvp/spectate.js"));
const stream_js_1 = __importDefault(require("./api/pvp/stream.js"));
const combat_log_js_1 = __importDefault(require("./api/pvp/combat-log.js"));
const claim_rewards_js_1 = __importDefault(require("./api/pvp/claim-rewards.js"));
const bounty_js_1 = __importDefault(require("./api/pvp/bounty.js"));
const ranked_queue_js_1 = __importDefault(require("./api/pvp/ranked-queue.js"));
const pet_ranked_queue_js_1 = __importDefault(require("./api/pvp/pet-ranked-queue.js"));
// Pet
const battle_result_js_1 = __importDefault(require("./api/pet/battle-result.js"));
const ranked_start_js_1 = __importDefault(require("./api/pet/ranked-start.js"));
const evolve_js_1 = __importDefault(require("./api/pet/evolve.js"));
const lobby_js_1 = __importDefault(require("./api/arena/lobby.js"));
const ladder_js_1 = __importDefault(require("./api/pet-ladder/ladder.js"));
// Jutsu
const speedup_js_1 = __importDefault(require("./api/jutsu/speedup.js"));
const train_with_seals_js_1 = __importDefault(require("./api/jutsu/train-with-seals.js"));
// Profession
const choose_js_1 = __importDefault(require("./api/profession/choose.js"));
// Player
const injured_villagers_js_1 = __importDefault(require("./api/player/injured-villagers.js"));
// Weekly boss
const weekly_boss_js_1 = __importDefault(require("./api/weekly-boss.js"));
const ranked_season_js_2 = __importDefault(require("./api/ranked-season.js"));
// Admin moderation
const moderation_js_1 = __importDefault(require("./api/admin/moderation.js"));
// Admin: durable battle-receipt lookup (support / reward-dispute debugging)
const battle_receipts_js_1 = __importDefault(require("./api/admin/battle-receipts.js"));
// Admin: asset-registry report + per-domain audit-log reader (diagnostics)
const asset_report_js_1 = __importDefault(require("./api/admin/asset-report.js"));
const audit_log_js_1 = __importDefault(require("./api/admin/audit-log.js"));
// Shared auth helper — constant-time compare for the restart endpoint.
const _auth_js_1 = require("./api/_auth.js");
// CORS origin predicate — single source of truth, shared with cors() and the
// Socket.IO layer so the three CORS surfaces can't drift (CLAUDE.md). Handles
// the static allowlist, EXTRA_ALLOWED_ORIGINS env additions, and *.up.railway.app.
const _utils_js_1 = require("./api/_utils.js");
// ─── Sentry (optional, env-gated server error reporting) ───────────────────────
// Activates ONLY when SENTRY_DSN is set. The require is guarded so a cPanel box
// whose node_modules predates this dependency still boots — the cPanel auto-deploy
// does git reset + Passenger restart but NOT `npm install`, so an unconditional
// require of a not-yet-installed module would crash-loop the box. Here it just
// logs a warning and runs without reporting. Set SENTRY_DSN on Railway (and, after
// a manual cPanel "Run NPM Install", on cPanel) to enable. Errors only — no perf
// tracing — to stay inside the free-tier event quota.
let Sentry = null;
if (process.env.SENTRY_DSN) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        Sentry = require('@sentry/node');
        Sentry.init({
            dsn: process.env.SENTRY_DSN,
            environment: process.env.NODE_ENV || 'production',
            tracesSampleRate: 0,
            sendDefaultPii: false,
        });
        console.log('[sentry] server error reporting enabled');
    }
    catch (err) {
        console.warn('[sentry] @sentry/node unavailable — error reporting disabled:', err?.message);
        Sentry = null;
    }
}
// ─── App setup ───────────────────────────────────────────────────────────────
const app = (0, express_1.default)();
// JSON body parsing. The vast majority of routes carry tiny JSON (polls, moves,
// player actions); only the image-pipe and admin-import routes legitimately POST
// multi-MB base64 payloads. Cap the default at 5 MB to shrink the synchronous
// parse / memory-pressure surface on the hot gameplay/poll routes — a malicious
// 50 MB body to e.g. /api/pvp/move can no longer force a 50 MB buffer+parse — and
// grant the 50 MB ceiling only to the routes that need it. Player saves are
// <=1 MB-gated in api/save/[name].ts and the leadership-portrait POST to
// /api/game-state both fit the 5 MB default with room to spare.
const jsonBig = express_1.default.json({ limit: '50mb' });
const jsonDefault = express_1.default.json({ limit: '5mb' });
const BIG_BODY_RE = /(?:^|\/)(?:images|img|generate-image|kv-proxy|admin)(?:\/|$)/;
app.use((req, res, next) => {
    if (BIG_BODY_RE.test(req.path))
        return jsonBig(req, res, next);
    return jsonDefault(req, res, next);
});
app.use(express_1.default.urlencoded({ extended: true, limit: '5mb' }));
// Global CORS — restrict to known origins so a malicious site can't initiate
// authenticated requests from a visitor's browser. The origin predicate is
// imported from api/_utils.ts (single source of truth) so this middleware and
// cors() can never drift.
// Mirror the safe-method allowlist from api/_utils.ts cors(). The old
// version sent `*` for ANY method when no Origin was present, which is
// strictly looser than the Vercel path (which only allows `*` for safe
// methods). An unsafe method with no Origin gets no ACAO header now,
// matching Vercel behaviour.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
app.use((req, res, next) => {
    const origin = req.headers.origin ?? '';
    const method = (req.method ?? 'GET').toUpperCase();
    if (origin && (0, _utils_js_1.isAllowedOrigin)(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    else if (!origin && SAFE_METHODS.has(method)) {
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
app.use((0, compression_1.default)({
    filter: (req, res) => {
        const type = String(res.getHeader('Content-Type') ?? '');
        if (type.includes('text/event-stream'))
            return false;
        return compression_1.default.filter(req, res);
    },
}));
/**
 * Register a handler on both the bare path and /api-prefixed path.
 * req.params are merged into req.query so handlers using req.query.name
 * (e.g. save/[name].ts) work with Express route params too.
 */
function route(path, handler) {
    const paths = [path, `/api${path}`];
    app.all(paths, async (req, res, next) => {
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
        }
        catch (err) {
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
        const fs = require('node:fs');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const path = require('node:path');
        const headPath = path.join(__dirname, '..', '.git', 'HEAD');
        const head = fs.readFileSync(headPath, 'utf8').trim();
        const ref = head.startsWith('ref: ') ? head.slice(5) : null;
        const sha = ref
            ? fs.readFileSync(path.join(__dirname, '..', '.git', ref), 'utf8').trim()
            : head;
        return { commit: sha.slice(0, 8), startedAt: new Date().toISOString() };
    }
    catch {
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
async function runDbHealthProbe() {
    const checks = {};
    const t0 = Date.now();
    // Which backend `save:*` resolves to. 'base-store' on a host that serves
    // /api/save/* means the disk overlay is misconfigured and saves are being
    // read/written against the wrong (empty) store — see REQUIRE_DISK_OVERLAY
    // in api/_storage.ts. Surfacing it here lets an operator catch that instantly.
    let saveStore;
    try {
        const { kv, saveStoreKind } = await import('./api/_storage.js');
        saveStore = saveStoreKind;
        const tag = `${process.pid}-${Date.now()}`;
        const token = Math.random().toString(36).slice(2);
        // Base store: write → read-back → delete.
        const baseKey = `health:probe:${tag}`;
        await kv.set(baseKey, token, { ex: 60 });
        checks.set = true;
        checks.get = (await kv.get(baseKey)) === token;
        checks.del = (await kv.del(baseKey)) >= 1;
        // kv_set_nx RPC.
        const nxKey = `health:probe:nx:${tag}`;
        checks.setNx = (await kv.set(nxKey, token, { nx: true, ex: 60 })) === 'OK';
        await kv.del(nxKey).catch(() => undefined);
        // kv_hset / kv_hdel RPCs.
        const hashKey = `health:probe:hash:${tag}`;
        await kv.hset(hashKey, { f: token });
        const hash = await kv.hgetall(hashKey);
        checks.hset = !!hash && hash.f === token;
        await kv.hdel(hashKey, 'f');
        checks.hdel = true;
        await kv.del(hashKey).catch(() => undefined);
        // Disk-routed overlay (the `save:<player>` reads missions depend on).
        const diskKey = `save:health-probe-${tag}`;
        await kv.set(diskKey, { probe: token });
        checks.diskWrite = true;
        const disk = await kv.get(diskKey);
        checks.diskRead = !!disk && disk.probe === token;
        await kv.del(diskKey).catch(() => undefined);
        const ok = Object.values(checks).every(Boolean);
        return { ok, checks, latencyMs: Date.now() - t0, saveStore };
    }
    catch (err) {
        return { ok: false, checks, latencyMs: Date.now() - t0, saveStore, error: err.message };
    }
}
app.get(['/health/db', '/api/health/db'], async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const result = await runDbHealthProbe();
    res.status(result.ok ? 200 : 503).json({ ...result, ..._BUILD_INFO });
});
// Normalize a possibly-array header to a single string (Express can hand
// back string[] for repeated headers).
function headerValue(h) {
    if (Array.isArray(h))
        return h[0] ?? '';
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
let restartAttempts = []; // epoch-ms of recent attempts
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
    if (!expected || !provided || !(0, _auth_js_1.safeEqual)(provided, expected)) {
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
route('/save/:name', _name__js_1.default);
// Player
route('/player/heartbeat', heartbeat_js_1.default);
route('/player/challenge', challenge_js_1.default);
route('/player/friends', friends_js_1.default);
route('/player/attack', attack_js_1.default);
route('/player/clear-attack', clear_attack_js_1.default);
route('/player/heal', heal_js_1.default);
route('/player/roster', roster_js_1.default);
route('/player/trade', trade_js_1.default);
route('/festival/black-market', black_market_js_1.default);
// PvP
route('/pvp/session', session_js_1.default);
route('/pvp/move', move_js_1.default);
// Images
route('/images', images_js_1.default);
// Phase 2: per-image binary serving (one file per image). Cold load no longer
// pulls the whole base64 bucket — the client fetches only the current screen's
// images, each CDN/browser-cached. ADD '/api/img' to the Cloudflare cache rule
// before the client switches to it (see api/img.ts).
route('/img', img_js_1.default);
// Auth
route('/player-auth', player_auth_js_1.default);
route('/admin-auth', admin_auth_js_1.default);
// Admin
route('/admin/players', players_js_1.default);
route('/admin/server-reset', server_reset_js_1.default);
route('/admin/ranked-season', ranked_season_js_1.default);
// Clans
route('/clans/list', list_js_1.default);
// Village
route('/village/chat', chat_js_1.default);
// Village guard
route('/village-guard/queue', queue_js_1.default);
route('/village-guard/dequeue', dequeue_js_1.default);
route('/village-guard/list', list_js_2.default);
route('/village-guard/challenge', challenge_js_2.default);
// AI image generation
route('/generate-image', generate_image_js_1.default);
// Game / world state
route('/game-state', game_state_js_1.default);
route('/world-state', world_state_js_1.default);
route('/messages', messages_js_1.default);
// Phase 0 load/refresh telemetry — anonymous, zero-storage beacon sink. Logs a
// single `[perf]` line per page load to stdout (see api/perf-beacon.ts).
route('/perf-beacon', perf_beacon_js_1.default);
// Village
route('/village/kage', kage_js_1.default);
// Village — server-authoritative Kage succession (declare/press/accept/resolve).
route('/village/kage-challenge', kage_challenge_js_1.default);
// Village — losing-village "demoralized" training debuff lookup (read-only).
route('/village/war-debuff', war_debuff_js_1.default);
// Bloodlines
route('/bloodlines/list', list_js_3.default);
// Admin review queues
route('/admin/bloodline-review', bloodline_review_js_1.default);
route('/admin/item-review', item_review_js_1.default);
// Internal KV proxy — a remote server (e.g. Railway) forwards disk-routed keys
// to the cPanel disk overlay here. Mounted with a trailing :op param so
// /api/kv/get etc. all hit one handler.
route('/kv/:op', kv_proxy_js_1.default);
// Admin: migrate disk-routed keys from Supabase → disk overlay.
route('/admin/migrate-kv', migrate_kv_js_1.default);
// Missions — AI raid token mint (PvP raids cross-validate via PvpSession;
// AI raids use this short-lived single-use token instead).
route('/missions/raid-start', raid_start_js_1.default);
// Battle Towers — 4-player squad tower (start / action / state / settle). Server-authoritative
// deterministic engine + idempotent reward settlement; see api/towers/.
route('/towers/floors', floors_js_1.default);
route('/towers/start', start_js_1.default);
route('/towers/action', action_js_1.default);
route('/towers/state', state_js_1.default);
route('/towers/settle', settle_js_1.default);
route('/towers/my-run', my_run_js_1.default);
route('/towers/join', join_js_1.default);
// Battle lock — server-side "in a PvE fight" marker (start/resolve/status) so a
// refresh can't escape a battle; resume-only, pays/punishes nothing (see
// api/battle/lock.ts).
route('/battle/lock', lock_js_1.default);
// Missions — pet expedition token mint (single-use, time-gated; redeemed by
// report-pet-event so expedition rewards require a real, fully-elapsed run).
route('/missions/expedition-start', expedition_start_js_1.default);
// Village treasury — atomic Kage-gift endpoint that replaces the broken
// 2-write client flow (deduct treasury + patch recipient).
route('/village/treasury/transfer', transfer_js_1.default);
// Village treasury — atomic player donation (debit donor + credit treasury).
route('/village/treasury/donate', donate_js_1.default);
// Village daily-agenda — server-authoritative shared-treasury credit (NX once/day).
route('/village/claim-daily-agenda', claim_daily_agenda_js_1.default);
// Village map-control — server-authoritative PERSONAL daily reward (server counts
// owned world:territory:* sectors, computes payout, credits once/day via NX marker).
route('/village/claim-map-control', claim_map_control_js_1.default);
// Bank interest — server-authoritative personal claim (server computes
// floor(bankRyo×rate) under the save lock + 24h gate). Audit #7 / Stage 3 Phase 4f.
route('/bank/claim-interest', claim_interest_js_1.default);
// Admin: snapshot / list / restore a player save (90-day TTL). Survives
// server-reset because the `save-snapshot:` prefix isn't matched by the
// reset's `save:*` glob.
route('/admin/save-snapshot', save_snapshot_js_1.default);
// ─── Cron: manual save-snapshot trigger ────────────────────────────────────────
// The nightly run happens in-process (startSnapshotCron, below). This HTTP
// endpoint matches the documented GET /api/cron/snapshot-saves so ops/admin can
// force a run manually; auth is CRON_SECRET bearer or full-admin password (the
// handler enforces it). Read-only — it only writes save-snapshot: copies.
route('/cron/snapshot-saves', snapshot_saves_js_1.default);
// ─── Clan: wars ────────────────────────────────────────────────────────────────
// Council Hall "Clan Battles" tab + the village-war flow (which reuses the
// clan-war engine with the village name as the clan key).
route('/clan/war/list', list_js_4.default);
route('/clan/war/declare', declare_js_1.default);
route('/clan/war/challenge', challenge_js_3.default);
route('/clan/war/report', report_js_1.default);
route('/clan/war/tilecards', tilecards_js_1.default);
// ─── Clan: seal pool ───────────────────────────────────────────────────────────
route('/clan/seal-pool/get', get_js_1.default);
route('/clan/seal-pool/donate', donate_js_2.default);
route('/clan/seal-pool/distribute', distribute_js_1.default);
// ─── Clan: treasury donate ─────────────────────────────────────────────────────
// Atomic player donation (debit donor save + credit clan treasury).
route('/clan/treasury/donate', donate_js_3.default);
route('/clan/treasury/transfer', transfer_js_2.default);
// ─── Clan: collect territory war supply (server-authoritative) ──────────────────
// Scans owned world:territory:* sectors, accrues + zeroes them, credits treasury.
route('/clan/territory/collect-supply', collect_supply_js_1.default);
// ─── Clan: upgrade tree purchase (server-authoritative spend) ───────────────────
// Locks the clan row, debits treasury ryo + warSupply, increments the building.
route('/clan/upgrade/purchase', purchase_js_1.default);
// ─── Clan: kick a member (server-authoritative) ─────────────────────────────────
// Leadership-only. Removes the member from the clan row AND clears their
// character.clan on their own save (the cross-save write a client can't do).
route('/clan/kick', kick_js_1.default);
// Clan — Sensei->Student mentorship (assign / claim milestone rewards / release).
route('/clan/mentor', mentor_js_1.default);
// ─── Clan: pet escort ──────────────────────────────────────────────────────────
route('/clan/pet-escort/list', list_js_5.default);
route('/clan/pet-escort/offer', offer_js_1.default);
route('/clan/pet-escort/cancel', cancel_js_1.default);
// ─── Missions: daily + reporting ───────────────────────────────────────────────
route('/missions/daily', daily_js_1.default);
route('/missions/weekly-board', weekly_board_js_1.default);
route('/missions/report-raid', report_raid_js_1.default);
route('/missions/report-pvp-win', report_pvp_win_js_1.default);
route('/missions/report-pet-event', report_pet_event_js_1.default);
route('/missions/claim-mission', claim_mission_js_1.default);
// ─── PvP: realtime, rewards, ranked queues ─────────────────────────────────────
// stream/spectate hold the connection open (SSE / long-poll); the generic
// route() wrapper passes res straight through so the handlers stream normally.
route('/pvp/chat', chat_js_2.default);
route('/pvp/spectate', spectate_js_1.default);
route('/pvp/stream', stream_js_1.default);
route('/pvp/combat-log', combat_log_js_1.default);
route('/pvp/claim-rewards', claim_rewards_js_1.default);
route('/pvp/bounty', bounty_js_1.default);
route('/pvp/ranked-queue', ranked_queue_js_1.default);
route('/pvp/pet-ranked-queue', pet_ranked_queue_js_1.default);
// ─── Pet battle result ─────────────────────────────────────────────────────────
route('/pet/battle-result', battle_result_js_1.default);
route('/pet/ranked-start', ranked_start_js_1.default);
route('/pet/evolve', evolve_js_1.default);
// ─── Co-op Tactical Pet Arena lobby ─────────────────────────────────────────────
route('/arena/lobby', lobby_js_1.default);
// ─── Global Pet Ladders (Coliseum 1v1 + Tactical 4v4, offline defense) ───────────
route('/pet-ladder', ladder_js_1.default);
// ─── Jutsu training ────────────────────────────────────────────────────────────
route('/jutsu/speedup', speedup_js_1.default);
route('/jutsu/train-with-seals', train_with_seals_js_1.default);
// ─── Profession ────────────────────────────────────────────────────────────────
route('/profession/choose', choose_js_1.default);
// ─── Player: injured villagers (Hospital screen) ───────────────────────────────
route('/player/injured-villagers', injured_villagers_js_1.default);
// ─── Weekly boss (Hall of Legends) ─────────────────────────────────────────────
route('/weekly-boss', weekly_boss_js_1.default);
route('/ranked-season', ranked_season_js_2.default);
// ─── Admin: moderation (bans / silences / IP linkage) ──────────────────────────
route('/admin/moderation', moderation_js_1.default);
// ─── Admin: durable battle-receipt lookup (support / reward-dispute triage) ─────
route('/admin/battle-receipts', battle_receipts_js_1.default);
// ─── Admin: asset-registry report + per-domain audit-log reader ─────────────────
route('/admin/asset-report', asset_report_js_1.default);
route('/admin/audit-log', audit_log_js_1.default);
// NOTE: Route parity is guarded by `server-routes.test.ts`, which fails
// `npm test` if the client calls an /api path that isn't registered here, or if
// an api/** handler file is never wired in. There is no folder-convention
// auto-routing (Vercel is retired) — add the route above AND the import when you
// add a client-facing endpoint; do not rely on this comment alone.
// ─── Static files (React SPA) ─────────────────────────────────────────────────
// STATIC_DIR env var overrides the default so the same compiled server.js works
// both in the repo (shinobij.client/dist) and in a manual cPanel upload (public/).
const staticDir = process.env.STATIC_DIR ?? (0, node_path_1.join)(__dirname, '..', 'shinobij.client', 'dist');
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
app.use(express_1.default.static(staticDir, {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache');
        }
        else if (_HASHED_ASSET_RE.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
    },
}));
// SPA fallback — any non-API path serves index.html so React Router handles it.
// no-cache so a deploy never serves a stale chunk map (matches express.static above).
app.get(/(.*)/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile((0, node_path_1.join)(staticDir, 'index.html'));
});
// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
    console.error('[server error]', err);
    // Every route() handler error funnels here via next(err), so this is the one
    // place that sees them all. Report before responding; never let a reporting
    // failure mask the 500. No-op when Sentry is disabled (SENTRY_DSN unset).
    if (Sentry) {
        try {
            Sentry.captureException(err);
        }
        catch { /* swallow */ }
    }
    if (!res.headersSent) {
        res.status(500).json({ error: String(err) });
    }
});
// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 3000);
// Phusion Passenger sets the PORT env var automatically.
// When running locally, defaults to 3000.
const server = (0, node_http_1.createServer)(app);
// Phase 2/Step 3: attach the Socket.IO realtime layer to the SAME HTTP server
// (registers the sweep→presence:gone listener). No-op when DISABLE_REALTIME=1;
// the client then falls back to the HTTP heartbeat. Done before startGameLoop
// so the sweep listener is registered before the first tick.
(0, socket_js_1.attachSocketServer)(server);
server.listen(PORT, () => {
    console.log(`ShinobiX API listening on port ${PORT}`);
    // Phase 2: start the 1s in-memory presence/game tick (single instance).
    (0, game_loop_js_1.startGameLoop)();
    // Vercel removal: the always-on server now runs the daily save-snapshot
    // backup itself (was a Vercel cron). No-op if DISABLE_SNAPSHOT_CRON=1.
    (0, _scheduler_js_1.startSnapshotCron)();
});
exports.default = app;
