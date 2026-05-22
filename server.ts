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

// ─── App setup ───────────────────────────────────────────────────────────────

const app = express();

// Parse JSON bodies up to 50 MB (needed for saves that include base64 images).
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Global CORS — individual handlers also call cors(), but this catches
// preflight OPTIONS requests before they reach any route handler.
app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password, x-player-password');
    if (_req.method === 'OPTIONS') {
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

        // Test DNS resolution directly via c-ares (dns.resolve4 with explicit servers).
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const dns = require('dns') as typeof import('dns');
        const supabaseHost = new URL(url).hostname;
        const dnsTest = await new Promise<string>((resolve) => {
            const timer = setTimeout(() => resolve('resolve4 Timeout after 5s'), 5000);
            try {
                dns.setServers(['8.8.8.8', '1.1.1.1']);
                dns.resolve4(supabaseHost, (err, addrs) => {
                    clearTimeout(timer);
                    if (err) resolve(`resolve4 Error: ${err.message} code=${err.code}`);
                    else resolve(`resolve4 OK: ${addrs.join(', ')}`);
                });
            } catch (e: unknown) {
                clearTimeout(timer);
                resolve(`resolve4 threw: ${String(e)}`);
            }
        });

        // Test raw HTTPS connectivity using Node's built-in https module
        // (bypasses fetch/undici to isolate the issue).
        const httpsTest = await new Promise<string>((resolve) => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const https = require('https') as typeof import('https');
            const req = https.get(url + '/rest/v1/', {
                headers: { apikey: key, Authorization: `Bearer ${key}` },
                timeout: 8000,
            }, (r) => resolve(`HTTP ${r.statusCode}`));
            req.on('error', (e: NodeJS.ErrnoException) => resolve(`Error: ${e.message} code=${e.code}`));
            req.on('timeout', () => { req.destroy(); resolve('Timeout'); });
        });

        // Raw TCP test: connect directly to the hardcoded Supabase IPv4 on port 443.
        // This bypasses DNS and TLS to check if the firewall allows outbound port 443.
        const tcpTest = await new Promise<string>((resolve) => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const net = require('net') as typeof import('net');
            const socket = net.createConnection({ host: '172.64.149.246', port: 443, family: 4 });
            const timer = setTimeout(() => { socket.destroy(); resolve('TCP Timeout (port 443 blocked?)'); }, 6000);
            socket.on('connect', () => { clearTimeout(timer); socket.destroy(); resolve('TCP OK (port 443 reachable)'); });
            socket.on('error', (e: NodeJS.ErrnoException) => { clearTimeout(timer); resolve(`TCP Error: ${e.message} code=${e.code}`); });
        });

        // Direct undici fetch test with detailed error capture.
        const undiciTest = await new Promise<string>((resolve) => {
            try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
                const undici = require('undici') as any;
                function lookup(h: string, _o: unknown, cb: (e: null, a: string, f: number) => void) {
                    cb(null, '172.64.149.246', 4);
                }
                const agent = new undici.Agent({ connect: { family: 4, lookup } });
                const ctrl = new AbortController();
                const timer = setTimeout(() => { ctrl.abort(); resolve('undici Timeout after 8s'); }, 8000);
                undici.fetch(url + '/rest/v1/', {
                    signal: ctrl.signal,
                    dispatcher: agent,
                    headers: { apikey: key, Authorization: `Bearer ${key}` },
                }).then((r: { status: number }) => {
                    clearTimeout(timer);
                    resolve(`undici HTTP ${r.status}`);
                }).catch((e: unknown) => {
                    clearTimeout(timer);
                    const err = e as any;
                    resolve(`undici Error: ${String(e)} code=${err?.cause?.code ?? err?.code ?? '?'} type=${err?.constructor?.name}`);
                });
            } catch (e) {
                resolve(`undici threw: ${String(e)}`);
            }
        });

        let kvError: string | null = null;
        try {
            // Import lazily so we don't crash at startup if env vars aren't ready.
            const { kv } = await import('./api/_storage.js');
            await kv.get('__health_check__');
        } catch (err) {
            kvError = String(err);
        }

        res.json({
            v: 5,
            ok: kvError === null,
            supabase_url: url,
            key_prefix: key.slice(0, 12) + '…',
            dnsTest,
            httpsTest,
            tcpTest,
            undiciTest,
            kvError,
        });
    } catch (err) {
        const e = err as any;
        res.status(500).json({
            ok: false,
            error: String(err),
            cause: e?.cause ? String(e.cause) : undefined,
            errors: Array.isArray(e?.errors) ? e.errors.map((x: unknown) => String(x)) : undefined,
        });
    }
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
