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
// ─── App setup ───────────────────────────────────────────────────────────────
const app = (0, express_1.default)();
// Parse JSON bodies up to 50 MB (needed for saves that include base64 images).
app.use(express_1.default.json({ limit: '50mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '50mb' }));
// Global CORS — individual handlers also call cors(), but this catches
// preflight OPTIONS requests before they reach any route handler.
app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password, x-player-password');
    if (_req.method === 'OPTIONS') {
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
app.get(['/health', '/api/health'], (_req, res) => {
    res.json({ ok: true });
});
app.get(['/debug/storage', '/api/debug/storage'], async (_req, res) => {
    try {
        const url = process.env.SUPABASE_URL ?? '';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
        if (!url || !key) {
            res.status(500).json({ ok: false, error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set.' });
            return;
        }
        // Import lazily so we don't crash at startup if env vars aren't ready.
        const { kv } = await import('./api/_storage.js');
        // Perform a harmless read to confirm connectivity.
        await kv.get('__health_check__');
        res.json({
            ok: true,
            supabase_url: url,
            key_prefix: key.slice(0, 12) + '…',
        });
    }
    catch (err) {
        res.status(500).json({ ok: false, error: String(err) });
    }
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
