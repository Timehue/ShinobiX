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
const attack_js_1 = __importDefault(require("./api/player/attack.js"));
const clear_attack_js_1 = __importDefault(require("./api/player/clear-attack.js"));
const heal_js_1 = __importDefault(require("./api/player/heal.js"));
const roster_js_1 = __importDefault(require("./api/player/roster.js"));
const session_js_1 = __importDefault(require("./api/pvp/session.js"));
const move_js_1 = __importDefault(require("./api/pvp/move.js"));
const images_js_1 = __importDefault(require("./api/images.js"));
const player_auth_js_1 = __importDefault(require("./api/player-auth.js"));
const admin_auth_js_1 = __importDefault(require("./api/admin-auth.js"));
const players_js_1 = __importDefault(require("./api/admin/players.js"));
const server_reset_js_1 = __importDefault(require("./api/admin/server-reset.js"));
const list_js_1 = __importDefault(require("./api/clans/list.js"));
const chat_js_1 = __importDefault(require("./api/village/chat.js"));
const queue_js_1 = __importDefault(require("./api/village-guard/queue.js"));
const dequeue_js_1 = __importDefault(require("./api/village-guard/dequeue.js"));
const list_js_2 = __importDefault(require("./api/village-guard/list.js"));
const challenge_js_2 = __importDefault(require("./api/village-guard/challenge.js"));
const generate_image_js_1 = __importDefault(require("./api/generate-image.js"));
const game_state_js_1 = __importDefault(require("./api/game-state.js"));
const world_state_js_1 = __importDefault(require("./api/world-state.js"));
const kage_js_1 = __importDefault(require("./api/village/kage.js"));
const bloodline_review_js_1 = __importDefault(require("./api/admin/bloodline-review.js"));
const item_review_js_1 = __importDefault(require("./api/admin/item-review.js"));
const list_js_3 = __importDefault(require("./api/bloodlines/list.js"));
const join_js_1 = __importDefault(require("./api/ranked-queue/join.js"));
const leave_js_1 = __importDefault(require("./api/ranked-queue/leave.js"));
const kv_proxy_js_1 = __importDefault(require("./api/kv-proxy.js"));
const migrate_kv_js_1 = __importDefault(require("./api/admin/migrate-kv.js"));
const raid_start_js_1 = __importDefault(require("./api/missions/raid-start.js"));
const treasury_transfer_js_1 = __importDefault(require("./api/village/treasury-transfer.js"));
const donate_js_1 = __importDefault(require("./api/village/treasury/donate.js"));
const claim_daily_agenda_js_1 = __importDefault(require("./api/village/claim-daily-agenda.js"));
const claim_map_control_js_1 = __importDefault(require("./api/village/claim-map-control.js"));
const save_snapshot_js_1 = __importDefault(require("./api/admin/save-snapshot.js"));
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
// Clan — territory war-supply collect (server-authoritative)
const collect_supply_js_1 = __importDefault(require("./api/clan/territory/collect-supply.js"));
// Clan — pet escort
const list_js_5 = __importDefault(require("./api/clan/pet-escort/list.js"));
const offer_js_1 = __importDefault(require("./api/clan/pet-escort/offer.js"));
const cancel_js_1 = __importDefault(require("./api/clan/pet-escort/cancel.js"));
// Missions — daily + reporting
const daily_js_1 = __importDefault(require("./api/missions/daily.js"));
const report_raid_js_1 = __importDefault(require("./api/missions/report-raid.js"));
const report_pvp_win_js_1 = __importDefault(require("./api/missions/report-pvp-win.js"));
const report_pet_event_js_1 = __importDefault(require("./api/missions/report-pet-event.js"));
// PvP — realtime + rewards + queues
const chat_js_2 = __importDefault(require("./api/pvp/chat.js"));
const spectate_js_1 = __importDefault(require("./api/pvp/spectate.js"));
const stream_js_1 = __importDefault(require("./api/pvp/stream.js"));
const claim_rewards_js_1 = __importDefault(require("./api/pvp/claim-rewards.js"));
const ranked_queue_js_1 = __importDefault(require("./api/pvp/ranked-queue.js"));
const pet_ranked_queue_js_1 = __importDefault(require("./api/pvp/pet-ranked-queue.js"));
// Pet
const battle_result_js_1 = __importDefault(require("./api/pet/battle-result.js"));
// Jutsu
const speedup_js_1 = __importDefault(require("./api/jutsu/speedup.js"));
const train_with_seals_js_1 = __importDefault(require("./api/jutsu/train-with-seals.js"));
// Profession
const choose_js_1 = __importDefault(require("./api/profession/choose.js"));
// Player
const injured_villagers_js_1 = __importDefault(require("./api/player/injured-villagers.js"));
// Weekly boss
const weekly_boss_js_1 = __importDefault(require("./api/weekly-boss.js"));
// Admin moderation
const moderation_js_1 = __importDefault(require("./api/admin/moderation.js"));
// Shared auth helper — constant-time compare for the restart endpoint.
const _auth_js_1 = require("./api/_auth.js");
// ─── App setup ───────────────────────────────────────────────────────────────
const app = (0, express_1.default)();
// Parse JSON bodies up to 50 MB (needed for saves that include base64 images).
app.use(express_1.default.json({ limit: '50mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '50mb' }));
// Global CORS — restrict to known origins so a malicious site can't initiate
// authenticated requests from a visitor's browser. Same allowlist as
// api/_utils.ts cors().
const ALLOWED_ORIGINS = new Set([
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
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
app.use((req, res, next) => {
    const origin = req.headers.origin ?? '';
    const method = (req.method ?? 'GET').toUpperCase();
    if (origin && ALLOWED_ORIGINS.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    else if (!origin && SAFE_METHODS.has(method)) {
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
app.get(['/health', '/api/health'], (_req, res) => {
    res.json({ ok: true, ..._BUILD_INFO });
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
route('/player/attack', attack_js_1.default);
route('/player/clear-attack', clear_attack_js_1.default);
route('/player/heal', heal_js_1.default);
route('/player/roster', roster_js_1.default);
// PvP
route('/pvp/session', session_js_1.default);
route('/pvp/move', move_js_1.default);
// Images
route('/images', images_js_1.default);
// Auth
route('/player-auth', player_auth_js_1.default);
route('/admin-auth', admin_auth_js_1.default);
// Admin
route('/admin/players', players_js_1.default);
route('/admin/server-reset', server_reset_js_1.default);
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
// Village
route('/village/kage', kage_js_1.default);
// Bloodlines
route('/bloodlines/list', list_js_3.default);
// Admin review queues
route('/admin/bloodline-review', bloodline_review_js_1.default);
route('/admin/item-review', item_review_js_1.default);
// Ranked queue
route('/ranked-queue/join', join_js_1.default);
route('/ranked-queue/leave', leave_js_1.default);
// Internal KV proxy — Vercel forwards disk-routed keys here.
// Mounted with a trailing :op param so /api/kv/get etc. all hit one handler.
route('/kv/:op', kv_proxy_js_1.default);
// Admin: migrate disk-routed keys from Supabase → disk overlay.
route('/admin/migrate-kv', migrate_kv_js_1.default);
// Missions — AI raid token mint (PvP raids cross-validate via PvpSession;
// AI raids use this short-lived single-use token instead).
route('/missions/raid-start', raid_start_js_1.default);
// Village treasury — atomic Kage-gift endpoint that replaces the broken
// 2-write client flow (deduct treasury + patch recipient).
route('/village/treasury/transfer', treasury_transfer_js_1.default);
// Village treasury — atomic player donation (debit donor + credit treasury).
route('/village/treasury/donate', donate_js_1.default);
// Village daily-agenda — server-authoritative shared-treasury credit (NX once/day).
route('/village/claim-daily-agenda', claim_daily_agenda_js_1.default);
// Village map-control — server-authoritative PERSONAL daily reward (server counts
// owned world:territory:* sectors, computes payout, credits once/day via NX marker).
route('/village/claim-map-control', claim_map_control_js_1.default);
// Admin: snapshot / list / restore a player save (90-day TTL). Survives
// server-reset because the `save-snapshot:` prefix isn't matched by the
// reset's `save:*` glob.
route('/admin/save-snapshot', save_snapshot_js_1.default);
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
// ─── Clan: collect territory war supply (server-authoritative) ──────────────────
// Scans owned world:territory:* sectors, accrues + zeroes them, credits treasury.
route('/clan/territory/collect-supply', collect_supply_js_1.default);
// ─── Clan: pet escort ──────────────────────────────────────────────────────────
route('/clan/pet-escort/list', list_js_5.default);
route('/clan/pet-escort/offer', offer_js_1.default);
route('/clan/pet-escort/cancel', cancel_js_1.default);
// ─── Missions: daily + reporting ───────────────────────────────────────────────
route('/missions/daily', daily_js_1.default);
route('/missions/report-raid', report_raid_js_1.default);
route('/missions/report-pvp-win', report_pvp_win_js_1.default);
route('/missions/report-pet-event', report_pet_event_js_1.default);
// ─── PvP: realtime, rewards, ranked queues ─────────────────────────────────────
// stream/spectate hold the connection open (SSE / long-poll); the generic
// route() wrapper passes res straight through so the handlers stream normally.
route('/pvp/chat', chat_js_2.default);
route('/pvp/spectate', spectate_js_1.default);
route('/pvp/stream', stream_js_1.default);
route('/pvp/claim-rewards', claim_rewards_js_1.default);
route('/pvp/ranked-queue', ranked_queue_js_1.default);
route('/pvp/pet-ranked-queue', pet_ranked_queue_js_1.default);
// ─── Pet battle result ─────────────────────────────────────────────────────────
route('/pet/battle-result', battle_result_js_1.default);
// ─── Jutsu training ────────────────────────────────────────────────────────────
route('/jutsu/speedup', speedup_js_1.default);
route('/jutsu/train-with-seals', train_with_seals_js_1.default);
// ─── Profession ────────────────────────────────────────────────────────────────
route('/profession/choose', choose_js_1.default);
// ─── Player: injured villagers (Hospital screen) ───────────────────────────────
route('/player/injured-villagers', injured_villagers_js_1.default);
// ─── Weekly boss (Hall of Legends) ─────────────────────────────────────────────
route('/weekly-boss', weekly_boss_js_1.default);
// ─── Admin: moderation (bans / silences / IP linkage) ──────────────────────────
route('/admin/moderation', moderation_js_1.default);
// NOTE: Route parity between Vercel (folder convention) and cPanel (this file)
// is now guarded by `server-routes.test.ts`, which fails CI/`npm test` if the
// client calls an /api path that isn't registered here. Add the route above
// AND the import when you add a client-facing endpoint — do not rely on this
// comment alone.
// ─── Static files (React SPA) ─────────────────────────────────────────────────
// STATIC_DIR env var overrides the default so the same compiled server.js works
// both in the repo (shinobij.client/dist) and in a manual cPanel upload (public/).
const staticDir = process.env.STATIC_DIR ?? (0, node_path_1.join)(__dirname, '..', 'shinobij.client', 'dist');
app.use(express_1.default.static(staticDir));
// SPA fallback — any non-API path serves index.html so React Router handles it.
app.get(/(.*)/, (_req, res) => {
    res.sendFile((0, node_path_1.join)(staticDir, 'index.html'));
});
// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
    console.error('[server error]', err);
    if (!res.headersSent) {
        res.status(500).json({ error: String(err) });
    }
});
// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 3000);
// Phusion Passenger sets the PORT env var automatically.
// When running locally, defaults to 3000.
const server = (0, node_http_1.createServer)(app);
server.listen(PORT, () => {
    console.log(`ShinobiX API listening on port ${PORT}`);
});
exports.default = app;
