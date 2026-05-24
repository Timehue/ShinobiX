import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite';
import plugin from '@vitejs/plugin-react';
import { ViteImageOptimizer } from 'vite-plugin-image-optimizer';
import fs from 'fs';
import path from 'path';
import child_process from 'child_process';
import { env } from 'process';
import type { IncomingMessage, ServerResponse } from 'http';

// ── Cert setup (dev only — skipped on CI / Vercel / production builds) ────────
const isBuildMode = process.argv.includes('build');

let httpsConfig: { key: Buffer; cert: Buffer } | undefined;

if (!isBuildMode && !env.VITE_SKIP_HTTPS) {
    try {
        const baseFolder =
            env.APPDATA !== undefined && env.APPDATA !== ''
                ? `${env.APPDATA}/ASP.NET/https`
                : `${env.HOME}/.aspnet/https`;

        const certificateName = "shinobij.client";
        const certFilePath = path.join(baseFolder, `${certificateName}.pem`);
        const keyFilePath = path.join(baseFolder, `${certificateName}.key`);

        if (!fs.existsSync(baseFolder)) {
            fs.mkdirSync(baseFolder, { recursive: true });
        }

        if (!fs.existsSync(certFilePath) || !fs.existsSync(keyFilePath)) {
            const result = child_process.spawnSync('dotnet', [
                'dev-certs', 'https',
                '--export-path', certFilePath,
                '--format', 'Pem',
                '--no-password',
            ], { stdio: 'inherit' });
            if (result.status !== 0) {
                console.warn('[vite] Could not create dev cert — running without HTTPS.');
            }
        }

        if (fs.existsSync(certFilePath) && fs.existsSync(keyFilePath)) {
            httpsConfig = {
                key: fs.readFileSync(keyFilePath),
                cert: fs.readFileSync(certFilePath),
            };
        }
    } catch {
        console.warn('[vite] Dev cert setup skipped — running without HTTPS.');
    }
}

const target = env.ASPNETCORE_HTTPS_PORT
    ? `https://localhost:${env.ASPNETCORE_HTTPS_PORT}`
    : env.ASPNETCORE_URLS
        ? env.ASPNETCORE_URLS.split(';')[0]
        : 'https://localhost:7275';

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString()));
        req.on('error', reject);
    });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
    const json = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
    res.end(json);
}

type CharacterSummary = {
    level?: number;
    village?: string;
    specialty?: string;
};

type OpenAiImageResponse = {
    error?: { message?: string };
    data?: Array<{ b64_json?: string }>;
};

function recordId(value: unknown) {
    return value && typeof value === 'object' && 'id' in value
        ? String((value as { id?: unknown }).id)
        : undefined;
}

function characterSummary(character: unknown): CharacterSummary {
    return character && typeof character === 'object' ? character as CharacterSummary : {};
}

function errorMessage(err: unknown, fallback = 'Request failed.') {
    return err instanceof Error ? err.message : fallback;
}

function isImageField(key: string, value: unknown) {
    return (key === 'image' || key === 'avatarImage') && typeof value === 'string';
}

function mergePreservingImages(incoming: unknown, existing: unknown): unknown {
    if (Array.isArray(incoming)) {
        return incoming.map((item, index) => {
            const existingArray = Array.isArray(existing) ? existing : [];
            const itemId = recordId(item);
            const existingById = itemId
                ? existingArray.find(candidate => recordId(candidate) === itemId)
                : undefined;
            return mergePreservingImages(item, existingById ?? existingArray[index]);
        });
    }

    if (!incoming || typeof incoming !== 'object') return incoming;

    const incomingRecord = incoming as Record<string, unknown>;
    const existingRecord = existing && typeof existing === 'object' ? existing as Record<string, unknown> : {};
    const merged: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(incomingRecord)) {
        if (isImageField(key, value) && value === '' && typeof existingRecord[key] === 'string' && String(existingRecord[key]).startsWith('data:image')) {
            merged[key] = existingRecord[key];
            continue;
        }

        merged[key] = value && typeof value === 'object'
            ? mergePreservingImages(value, existingRecord[key])
            : value;
    }

    return merged;
}

// ── In-process multiplayer presence (dev server only) ──────────────────────
type PlayerPresence = {
    name: string;
    sector: number;
    character: unknown;
    lastSeen: number;
    pendingAttacker: unknown | null;
};
const playerPresence = new Map<string, PlayerPresence>();
setInterval(() => {
    const cutoff = Date.now() - 30_000;
    for (const [key, p] of playerPresence) {
        if (p.lastSeen < cutoff) playerPresence.delete(key);
    }
}, 10_000).unref();

// ── Village Guard store ────────────────────────────────────────────────────
type GuardEntry = { name: string; village: string; level: number; lastSeen: number };
const villageGuards = new Map<string, GuardEntry>();
setInterval(() => {
    const cutoff = Date.now() - 5 * 60_000;
    for (const [key, g] of villageGuards) {
        if (g.lastSeen < cutoff) villageGuards.delete(key);
    }
}, 30_000).unref();

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        plugin(),
        ViteImageOptimizer({
            // Skip SVGs — favicon/icons are already tiny and svgo isn't installed
            exclude: /\.svg$/i,
            // Compress PNGs — background images drop from ~2.5–3.5 MB to ~300–700 KB
            png: {
                quality: 78,         // 0–100, 78 is visually lossless for backgrounds
                compressionLevel: 9, // max zlib compression (no quality loss)
                adaptiveFiltering: true,
            },
            // Compress JPGs (frostfang / moonshadow / stormveil scene images)
            jpg: { quality: 78 },
            jpeg: { quality: 78 },
            // Also emit a WebP copy alongside every PNG/JPG so browsers that
            // support WebP get the smallest possible file automatically.
            webp: { quality: 75, lossless: false },
        }),
        {
            name: 'api-multiplayer',
            configureServer(server) {
                server.middlewares.use('/api/player/heartbeat', async (req: IncomingMessage, res: ServerResponse, next) => {
                    if (req.method !== 'POST') { next(); return; }
                    try {
                        const { name, sector, character } = JSON.parse(await readBody(req)) as { name?: string; sector?: number; character?: unknown };
                        if (!name) { sendJson(res, 400, { error: 'Missing name.' }); return; }
                        const existing = playerPresence.get(name) ?? { name, sector: sector ?? 40, character, lastSeen: 0, pendingAttacker: null };
                        const pendingAttacker = existing.pendingAttacker;
                        playerPresence.set(name, { name, sector: sector ?? existing.sector, character: character ?? existing.character, lastSeen: Date.now(), pendingAttacker: null });
                        const sectorMates = [...playerPresence.values()]
                            .filter(p => p.name !== name && p.sector === (sector ?? existing.sector))
                            .map(({ name: n, sector: s, character: c }) => {
                                const summary = characterSummary(c);
                                return {
                                    name: n, sector: s, character: c,
                                    level: summary.level ?? 1,
                                    village: summary.village ?? '',
                                    specialty: summary.specialty ?? 'Ninjutsu',
                                };
                            });
                        sendJson(res, 200, { sectorMates, pendingAttacker });
                    } catch (err: unknown) {
                        sendJson(res, 500, { error: errorMessage(err) });
                    }
                });

                server.middlewares.use('/api/player/attack', async (req: IncomingMessage, res: ServerResponse, next) => {
                    if (req.method !== 'POST') { next(); return; }
                    try {
                        const { targetName, attacker } = JSON.parse(await readBody(req)) as { targetName?: string; attacker?: unknown };
                        if (!targetName) { sendJson(res, 400, { error: 'Missing targetName.' }); return; }
                        const target = playerPresence.get(targetName);
                        if (!target) { sendJson(res, 404, { error: 'Target not online.' }); return; }
                        playerPresence.set(targetName, { ...target, pendingAttacker: attacker ?? null });
                        sendJson(res, 200, { ok: true });
                    } catch (err: unknown) {
                        sendJson(res, 500, { error: errorMessage(err) });
                    }
                });

                server.middlewares.use('/api/player/clear-attack', async (req: IncomingMessage, res: ServerResponse, next) => {
                    if (req.method !== 'POST') { next(); return; }
                    try {
                        const { name } = JSON.parse(await readBody(req)) as { name?: string };
                        if (!name) { sendJson(res, 400, { error: 'Missing name.' }); return; }
                        const p = playerPresence.get(name);
                        if (p) playerPresence.set(name, { ...p, pendingAttacker: null });
                        sendJson(res, 200, { ok: true });
                    } catch (err: unknown) {
                        sendJson(res, 500, { error: errorMessage(err) });
                    }
                });
            },
        },
        {
            name: 'api-village-guard',
            configureServer(server) {
                server.middlewares.use('/api/village-guard/queue', async (req: IncomingMessage, res: ServerResponse, next) => {
                    if (req.method !== 'POST') { next(); return; }
                    try {
                        const { name, village, level } = JSON.parse(await readBody(req)) as { name?: string; village?: string; level?: number };
                        if (!name || !village) { sendJson(res, 400, { error: 'Missing name or village.' }); return; }
                        villageGuards.set(name, { name, village, level: level ?? 1, lastSeen: Date.now() });
                        sendJson(res, 200, { ok: true });
                    } catch (err: unknown) { sendJson(res, 500, { error: errorMessage(err) }); }
                });

                server.middlewares.use('/api/village-guard/dequeue', async (req: IncomingMessage, res: ServerResponse, next) => {
                    if (req.method !== 'POST') { next(); return; }
                    try {
                        const { name } = JSON.parse(await readBody(req)) as { name?: string };
                        if (!name) { sendJson(res, 400, { error: 'Missing name.' }); return; }
                        villageGuards.delete(name);
                        sendJson(res, 200, { ok: true });
                    } catch (err: unknown) { sendJson(res, 500, { error: errorMessage(err) }); }
                });

                server.middlewares.use('/api/village-guard/list', async (req: IncomingMessage, res: ServerResponse, next) => {
                    if (req.method !== 'POST') { next(); return; }
                    try {
                        const { village } = JSON.parse(await readBody(req)) as { village?: string };
                        if (!village) { sendJson(res, 400, { error: 'Missing village.' }); return; }
                        const guards = [...villageGuards.values()]
                            .filter(g => g.village === village)
                            .map(({ name, level, village: v }) => ({ name, level, village: v }));
                        sendJson(res, 200, guards);
                    } catch (err: unknown) { sendJson(res, 500, { error: errorMessage(err) }); }
                });
            },
        },
        {
            name: 'api-save',
            configureServer(server) {
                const savesDir = path.resolve(process.cwd(), 'saves');
                if (!fs.existsSync(savesDir)) fs.mkdirSync(savesDir, { recursive: true });

                function safeName(name: string) {
                    return name.replace(/[^a-z0-9\-_]/g, '').toLowerCase();
                }

                server.middlewares.use('/api/clans/list', async (req: IncomingMessage, res: ServerResponse, next) => {
                    if (req.method !== 'GET') { next(); return; }
                    try {
                        const clans = fs.readdirSync(savesDir)
                            .filter(file => file.startsWith('clan-') && file.endsWith('.json'))
                            .map(file => {
                                try {
                                    return JSON.parse(fs.readFileSync(path.join(savesDir, file), 'utf8'));
                                } catch {
                                    return null;
                                }
                            })
                            .filter(Boolean);
                        sendJson(res, 200, clans);
                    } catch (err: unknown) {
                        sendJson(res, 500, { error: errorMessage(err, 'Clan list failed') });
                    }
                });

                server.middlewares.use('/api/save', async (req: IncomingMessage, res: ServerResponse, next) => {
                    const rawName = (req.url ?? '').replace(/^\//, '').split('?')[0];
                    const name = safeName(rawName);
                    if (!name) { next(); return; }

                    const filePath = path.join(savesDir, `${name}.json`);

                    if (req.method === 'GET') {
                        if (!fs.existsSync(filePath)) { res.writeHead(404); res.end(); return; }
                        const data = fs.readFileSync(filePath, 'utf8');
                        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
                        res.end(data);
                        return;
                    }

                    if (req.method === 'POST') {
                        try {
                            const body = await readBody(req);
                            const incoming = JSON.parse(body);
                            let payload = incoming;

                            if (fs.existsSync(filePath)) {
                                try {
                                    const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                                    payload = mergePreservingImages(incoming, existing);
                                    fs.copyFileSync(filePath, `${filePath}.bak`);
                                } catch {
                                    fs.copyFileSync(filePath, `${filePath}.corrupt-${Date.now()}.bak`);
                                }
                            }

                            const tmpPath = `${filePath}.tmp`;
                            fs.writeFileSync(tmpPath, JSON.stringify(payload), 'utf8');
                            fs.renameSync(tmpPath, filePath);
                            res.writeHead(200);
                            res.end();
                        } catch (err: unknown) {
                            res.writeHead(500);
                            res.end(JSON.stringify({ error: errorMessage(err, 'Write failed') }));
                        }
                        return;
                    }

                    next();
                });
            },
        },
        {
            name: 'api-generate-image',
            configureServer(server) {
                server.middlewares.use('/api/generate-image', async (req: IncomingMessage, res: ServerResponse, next) => {
                    if (req.method !== 'POST') { next(); return; }

                    try {
                        const body = JSON.parse(await readBody(req)) as { prompt?: string; label?: string };
                        const { prompt, label } = body;

                        if (!prompt?.trim()) {
                            sendJson(res, 400, { error: 'Missing image prompt.' });
                            return;
                        }

                        const dotenvPath = path.resolve(process.cwd(), '.env');
                        let apiKey = env.OPENAI_API_KEY ?? '';
                        if (!apiKey && fs.existsSync(dotenvPath)) {
                            const lines = fs.readFileSync(dotenvPath, 'utf8').split('\n');
                            for (const line of lines) {
                                const m = line.match(/^OPENAI_API_KEY\s*=\s*(.+)$/);
                                if (m) { apiKey = m[1].trim(); break; }
                            }
                        }

                        if (!apiKey) {
                            sendJson(res, 500, { error: 'OPENAI_API_KEY is not set. Add it to shinobij.client/.env' });
                            return;
                        }

                        const finalPrompt = `Create a polished 2D anime shinobi RPG game asset.\n\nUser request:\n${prompt}\n\nAsset label:\n${label ?? ''}\n\nStyle rules:\n- original ninja RPG fantasy style\n- clean game asset composition\n- dramatic lighting\n- no text\n- no logos\n- no UI\n- no watermarks\n- high detail\n- suitable for a browser RPG`;

                        const openaiRes = await fetch('https://api.openai.com/v1/images/generations', {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${apiKey}`,
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                model: 'gpt-image-1',
                                prompt: finalPrompt,
                                size: '1024x1024',
                                quality: 'low',
                                n: 1,
                            }),
                        });

                        const data = await openaiRes.json() as OpenAiImageResponse;

                        if (!openaiRes.ok) {
                            sendJson(res, 502, { error: data?.error?.message ?? `OpenAI error ${openaiRes.status}` });
                            return;
                        }

                        const b64 = data?.data?.[0]?.b64_json;
                        if (!b64) {
                            sendJson(res, 502, { error: 'OpenAI did not return image data.' });
                            return;
                        }

                        sendJson(res, 200, { image: `data:image/png;base64,${b64}` });
                    } catch (err: unknown) {
                        sendJson(res, 500, { error: errorMessage(err, 'Image generation failed.') });
                    }
                });
            },
        },
    ],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url))
        }
    },
    server: {
        proxy: {
            '^/weatherforecast': {
                target,
                secure: false
            },
        },
        port: parseInt(env.DEV_SERVER_PORT || '50891'),
        ...(httpsConfig ? { https: httpsConfig } : {}),
    }
});
