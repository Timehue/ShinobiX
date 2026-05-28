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
const save_snapshot_js_1 = __importDefault(require("./api/admin/save-snapshot.js"));
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password, x-player-password, x-player-name, x-kv-token, x-client-fp');
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
// Internal restart endpoint — auth via KV_PROXY_TOKEN (the same shared
// secret we already trust). Passenger respawns the worker when the
// process exits, which reliably picks up new code from disk even when
// tmp/restart.txt isn't honored.
app.post(['/restart', '/api/restart'], (req, res) => {
    const expected = process.env.KV_PROXY_TOKEN;
    if (!expected || req.headers['x-kv-token'] !== expected) {
        res.status(401).json({ error: 'invalid x-kv-token' });
        return;
    }
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
// Admin: snapshot / list / restore a player save (90-day TTL). Survives
// server-reset because the `save-snapshot:` prefix isn't matched by the
// reset's `save:*` glob.
route('/admin/save-snapshot', save_snapshot_js_1.default);
// NOTE: Many other api/** handlers exist but are not yet routed here:
//   - api/missions/{report-raid, report-pvp-win, report-pet-event, daily}
//   - api/pvp/{chat, spectate, stream, claim-rewards, ranked-queue}
//   - api/jutsu/{speedup, train-with-seals}
//   - api/clan/** (all)
//   - api/pet/battle-result
//   - api/admin/moderation
//   - api/weekly-boss, api/profession/choose
// Vercel deploys hit them via the api/ folder convention; cPanel needs them
// added here if cPanel becomes a primary deployment target.
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
