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
import express from 'express';
import { createServer } from 'node:http';
// ─── Handler imports ─────────────────────────────────────────────────────────
// All handlers use import type { VercelRequest, VercelResponse } for TypeScript
// only — those types are erased at compile time, so there is zero runtime
// dependency on @vercel/node in the cPanel build.
import saveHandler from './api/save/[name].js';
import heartbeatHandler from './api/player/heartbeat.js';
import challengeHandler from './api/player/challenge.js';
import attackHandler from './api/player/attack.js';
import clearAttackHandler from './api/player/clear-attack.js';
import healHandler from './api/player/heal.js';
import rosterHandler from './api/player/roster.js';
import pvpSessionHandler from './api/pvp/session.js';
import pvpMoveHandler from './api/pvp/move.js';
import imagesHandler from './api/images.js';
import playerAuthHandler from './api/player-auth.js';
import adminAuthHandler from './api/admin-auth.js';
import adminPlayersHandler from './api/admin/players.js';
import serverResetHandler from './api/admin/server-reset.js';
import clansListHandler from './api/clans/list.js';
import chatHandler from './api/village/chat.js';
import guardQueueHandler from './api/village-guard/queue.js';
import guardDequeueHandler from './api/village-guard/dequeue.js';
import guardListHandler from './api/village-guard/list.js';
import guardChallengeHandler from './api/village-guard/challenge.js';
import generateImageHandler from './api/generate-image.js';
import gameStateHandler from './api/game-state.js';
import worldStateHandler from './api/world-state.js';
import kageHandler from './api/village/kage.js';
import bloodlineReviewHandler from './api/admin/bloodline-review.js';
import itemReviewHandler from './api/admin/item-review.js';
import bloodlinesListHandler from './api/bloodlines/list.js';
// ─── App setup ───────────────────────────────────────────────────────────────
const app = express();
// Parse JSON bodies up to 50 MB (needed for saves that include base64 images).
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
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
route('/save/:name', saveHandler);
// Player
route('/player/heartbeat', heartbeatHandler);
route('/player/challenge', challengeHandler);
route('/player/attack', attackHandler);
route('/player/clear-attack', clearAttackHandler);
route('/player/heal', healHandler);
route('/player/roster', rosterHandler);
// PvP
route('/pvp/session', pvpSessionHandler);
route('/pvp/move', pvpMoveHandler);
// Images
route('/images', imagesHandler);
// Auth
route('/player-auth', playerAuthHandler);
route('/admin-auth', adminAuthHandler);
// Admin
route('/admin/players', adminPlayersHandler);
route('/admin/server-reset', serverResetHandler);
// Clans
route('/clans/list', clansListHandler);
// Village
route('/village/chat', chatHandler);
// Village guard
route('/village-guard/queue', guardQueueHandler);
route('/village-guard/dequeue', guardDequeueHandler);
route('/village-guard/list', guardListHandler);
route('/village-guard/challenge', guardChallengeHandler);
// AI image generation
route('/generate-image', generateImageHandler);
// Game / world state
route('/game-state', gameStateHandler);
route('/world-state', worldStateHandler);
// Village
route('/village/kage', kageHandler);
// Bloodlines
route('/bloodlines/list', bloodlinesListHandler);
// Admin review queues
route('/admin/bloodline-review', bloodlineReviewHandler);
route('/admin/item-review', itemReviewHandler);
// ─── Frontend static files (cPanel / Passenger) ───────────────────────────────
// Serve the built React app from the public/ subfolder so the whole domain
// works: /api/* hits Express routes above, everything else gets index.html.
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, 'public');
import { existsSync } from 'fs';
if (existsSync(publicDir)) {
    app.use(express.static(publicDir));
    app.get('*', (_req, res) => {
        res.sendFile(join(publicDir, 'index.html'));
    });
}
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
const server = createServer(app);
server.listen(PORT, () => {
    console.log(`ShinobiX API listening on port ${PORT}`);
});
export default app;
