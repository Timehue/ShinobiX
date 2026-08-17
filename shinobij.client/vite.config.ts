import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite';
import plugin from '@vitejs/plugin-react';
import { ViteImageOptimizer } from 'vite-plugin-image-optimizer';
import fs from 'fs';
import path from 'path';
import child_process from 'child_process';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { env } from 'process';
import type { IncomingMessage, ServerResponse } from 'http';
import { playerPasswordPolicyError } from './src/lib/player-auth-policy';
import { sectorExitById } from '../shared/sector-links';
import { SHRINE_DEFS } from '../shared/shrines';
import { issueSignedDevSessionToken, verifySignedDevSessionToken } from './dev-session-auth';

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

const PRESENCE_TTL_MS = 60_000;
const MAX_PROMPT_LENGTH = 1_500;
const MAX_LABEL_LENGTH = 120;
const MAX_DEV_IMAGE_CHARS = 3_000_000;
const MAX_DEV_AVATAR_BYTES = 2 * 1024 * 1024;
const CLIENT_ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_ROOT = path.join(CLIENT_ROOT, 'public');
const PUBLIC_AUTHORING_PREFIXES = [
    'pet-models/qa',
    'pet-models/sources',
    'pet-models/proofs',
    'pet-models/roster-concepts',
    'pet-models/roster-references',
] as const;
const PUBLIC_LOCAL_ONLY_ASSETS = new Set([
    'pet-models/mythic-10.glb',
    'pet-models/mythic-11.glb',
    'pet-models/mythic-12.glb',
    'pet-models/mythic-13.glb',
    'pet-models/mythic-14.glb',
]);

/**
 * Vite's default public copy is all-or-nothing. The pet pipeline intentionally
 * keeps QA turnarounds, Blender sources, proofs, and concept sheets beside the
 * reviewed runtime roster; copying that tree made a production artifact exceed
 * 6 GB. Disable the blanket copy and merge only runtime files into the output.
 * Authoring assets stay untouched in public/ for the local pipeline.
 */
function runtimePublicAssetsPlugin() {
    const isRuntimePath = (sourcePath: string) => {
        const relative = path.relative(PUBLIC_ROOT, sourcePath).replace(/\\/g, '/');
        return !PUBLIC_LOCAL_ONLY_ASSETS.has(relative)
            && !PUBLIC_AUTHORING_PREFIXES.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`));
    };
    const mergeRuntimePath = (sourcePath: string, destinationPath: string) => {
        if (!isRuntimePath(sourcePath)) return;
        const stat = fs.statSync(sourcePath);
        if (stat.isDirectory()) {
            fs.mkdirSync(destinationPath, { recursive: true });
            for (const entry of fs.readdirSync(sourcePath)) {
                mergeRuntimePath(path.join(sourcePath, entry), path.join(destinationPath, entry));
            }
            return;
        }
        fs.copyFileSync(sourcePath, destinationPath);
    };
    return {
        name: 'runtime-public-assets',
        apply: 'build' as const,
        enforce: 'pre' as const,
        writeBundle(options: { dir?: string }) {
            const outputRoot = path.resolve(CLIENT_ROOT, options.dir ?? 'dist');
            for (const entry of fs.readdirSync(PUBLIC_ROOT, { withFileTypes: true })) {
                const sourcePath = path.join(PUBLIC_ROOT, entry.name);
                const destinationPath = path.join(outputRoot, entry.name);
                if (!isRuntimePath(sourcePath)) continue;
                mergeRuntimePath(sourcePath, destinationPath);
            }
        },
    };
}

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

function safeName(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9\-_]/g, '');
}

const RESERVED_DEV_AUTH_NAMES = new Set(['admin', 'admin1', 'admin2', 'system', 'server', 'player', 'kage', 'narrator']);
const RESERVED_DEV_AUTH_PREFIXES = ['clan-', 'admin-', 'system-', 'server-'];

type DevAuthRecord = {
    salt: string;
    hash: string;
};

type DevAuthStore = Record<string, DevAuthRecord>;

function isReservedDevAuthName(playerId: string) {
    return RESERVED_DEV_AUTH_NAMES.has(playerId)
        || RESERVED_DEV_AUTH_PREFIXES.some(prefix => playerId.startsWith(prefix));
}

function hashDevPassword(password: string, salt: string) {
    return scryptSync(password, salt, 32).toString('hex');
}

function createDevAuthRecord(password: string): DevAuthRecord {
    const salt = randomBytes(16).toString('hex');
    return { salt, hash: hashDevPassword(password, salt) };
}

// The production API returns a signed, revocable session token after register
// and verify. Local Vite middleware has no production SESSION_SECRET or shared
// epoch store, but the client still correctly refuses password-only sessions.
// Mint an opaque dev-only token so authenticated browser journeys exercise the
// same token-first client path. This value is accepted nowhere outside Vite.
function issueDevSessionToken(playerId: string) {
    return issueSignedDevSessionToken(playerId);
}

function devTokenPlayer(req: IncomingMessage): string | null {
    const token = req.headers['x-player-token'];
    const claimedName = req.headers['x-player-name'];
    if (typeof token !== 'string' || typeof claimedName !== 'string') return null;
    return verifySignedDevSessionToken(token, claimedName);
}

function validDevImage(image: string) {
    if (image.length > MAX_DEV_IMAGE_CHARS) return false;
    if (/^https?:\/\//i.test(image)) {
        try {
            const host = new URL(image).hostname.toLowerCase();
            return host.includes('.') && host !== 'localhost' && !/^127\./.test(host);
        } catch {
            return false;
        }
    }
    return /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(image);
}

function decodedDevImageBytes(image: string) {
    const b64 = image.slice(image.indexOf(',') + 1);
    const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    return Math.floor((b64.length * 3) / 4) - padding;
}

type DevImageStore = Record<string, string>;
let devImageWriteChain = Promise.resolve();

function loadDevImages(imagePath: string): DevImageStore {
    if (!fs.existsSync(imagePath)) return {};
    try {
        const parsed = JSON.parse(fs.readFileSync(imagePath, 'utf8')) as unknown;
        return parsed && typeof parsed === 'object' ? parsed as DevImageStore : {};
    } catch {
        return {};
    }
}

function saveDevImages(imagePath: string, images: DevImageStore) {
    const tmpPath = `${imagePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(images), 'utf8');
    fs.renameSync(tmpPath, imagePath);
}

async function updateDevImages(imagePath: string, update: (images: DevImageStore) => void) {
    const write = devImageWriteChain.then(() => {
        const images = loadDevImages(imagePath);
        update(images);
        saveDevImages(imagePath, images);
    });
    devImageWriteChain = write.catch(() => undefined);
    await write;
}

function devPasswordMatches(record: DevAuthRecord, password: string) {
    const expected = Buffer.from(record.hash, 'hex');
    const actual = Buffer.from(hashDevPassword(password, record.salt), 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function devStringMatches(expectedValue: string, actualValue: string) {
    const expected = Buffer.from(expectedValue);
    const actual = Buffer.from(actualValue);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function loadDevAuthStore(authPath: string): DevAuthStore {
    if (!fs.existsSync(authPath)) return {};

    try {
        const parsed = JSON.parse(fs.readFileSync(authPath, 'utf8')) as unknown;
        if (!parsed || typeof parsed !== 'object') return {};

        const store: DevAuthStore = {};
        for (const [playerId, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (!value || typeof value !== 'object') continue;
            const record = value as Partial<DevAuthRecord>;
            if (typeof record.salt === 'string' && typeof record.hash === 'string') {
                store[playerId] = { salt: record.salt, hash: record.hash };
            }
        }
        return store;
    } catch {
        return {};
    }
}

function saveDevAuthStore(authPath: string, store: DevAuthStore) {
    const tmpPath = `${authPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmpPath, authPath);
}

function sectorFrom(value: unknown, fallback: number): number {
    const sector = Math.floor(Number(value));
    return Number.isFinite(sector) && sector >= 0 ? sector : fallback;
}

type JsonBodyResult =
    | { ok: true; body: unknown }
    | { ok: false; error: string };

function parseJsonBody(rawBody: string): JsonBodyResult {
    const trimmed = rawBody.trim();
    if (!trimmed) return { ok: true, body: {} };

    try {
        return { ok: true, body: JSON.parse(trimmed) as unknown };
    } catch {
        return { ok: false, error: 'Malformed JSON body.' };
    }
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
    tile: number;
    character: unknown;
    lastSeen: number;
    travelingUntil: number;
    destinationSector?: number;
    pendingAttacker: unknown | null;
};
const playerPresence = new Map<string, PlayerPresence>();
setInterval(() => {
    const cutoff = Date.now() - PRESENCE_TTL_MS;
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
        runtimePublicAssetsPlugin(),
        ViteImageOptimizer({
            // Skip SVGs (already tiny, svgo isn't installed) and WebP. The
            // background art is pre-converted to WebP q80 via scripts/to-webp.mjs;
            // re-encoding it here (the webp setting below is q70) would be a
            // needless second lossy pass. New WebP added by that script is final.
            // Pet QA turnarounds and generation proofs are already final review
            // artifacts. Processing thousands of them concurrently can exhaust
            // Windows' file-handle limit; none are shipped by the live build.
            exclude: /(?:[\\/]pet-models[\\/](?:qa|roster-concepts|proofs|sources|roster-references)[\\/])|(?:\.(?:svg|webp)$)/i,
            // Compress PNGs — background images drop from ~2.5–3.5 MB to
            // ~250–600 KB. Quality dropped from 78 → 70: at 70 the visual
            // difference on decorative game art is imperceptible, but
            // payload shrinks ~15-20% more across the heavy sector PNGs.
            // If a future asset needs higher fidelity (UI sprites that look
            // muddy at 70), bump quality back up locally for that file.
            png: {
                quality: 70,
                compressionLevel: 9,
                adaptiveFiltering: true,
                effort: 10,          // pngquant searches harder for an optimal palette
            },
            // Same quality drop for JPGs (frostfang / moonshadow / stormveil
            // scene images). 70 is the standard "web high" preset.
            jpg: { quality: 70, mozjpeg: true },
            jpeg: { quality: 70, mozjpeg: true },
            // Sharp's webp encoder; sidecar emission isn't enabled here
            // (would require a separate plugin). Settings stay so any
            // .webp source assets we add later compress consistently.
            webp: { quality: 70, lossless: false, effort: 6 },
        }),
        {
            name: 'api-multiplayer',
            configureServer(server) {
                server.middlewares.use('/api/player/heartbeat', async (req: IncomingMessage, res: ServerResponse, next) => {
                    if (req.method !== 'POST') { next(); return; }
                    try {
                        const parsed = parseJsonBody(await readBody(req));
                        if ('error' in parsed) { sendJson(res, 400, { error: parsed.error }); return; }
                        const { name, sector, tile, character, travelingUntil } = parsed.body as { name?: string; sector?: number; tile?: number; character?: unknown; travelingUntil?: number };
                        if (!name) { sendJson(res, 400, { error: 'Missing name.' }); return; }
                        const playerId = safeName(name);
                        if (!playerId) { sendJson(res, 400, { error: 'Invalid name.' }); return; }
                        const existing = playerPresence.get(playerId) ?? { name: name.trim(), sector: sectorFrom(sector, 40), tile: sectorFrom(tile, 78), character, lastSeen: 0, travelingUntil: 0, pendingAttacker: null };
                        const pendingAttacker = existing.pendingAttacker;
                        const now = Date.now();
                        const travelFinished = existing.destinationSector !== undefined && existing.travelingUntil <= now;
                        const nextSector = existing.travelingUntil > now
                            ? existing.sector
                            : travelFinished ? existing.destinationSector! : sectorFrom(sector, existing.sector);
                        playerPresence.set(playerId, {
                            name: name.trim(),
                            sector: nextSector,
                            tile: sectorFrom(tile, existing.tile),
                            character: character ?? existing.character,
                            lastSeen: now,
                            travelingUntil: existing.travelingUntil > now ? existing.travelingUntil : Math.max(0, Number(travelingUntil) || 0),
                            pendingAttacker: null,
                        });
                        const sectorMates = [...playerPresence.values()]
                            .filter(p => safeName(p.name) !== playerId && p.sector === nextSector)
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
                        const parsed = parseJsonBody(await readBody(req));
                        if ('error' in parsed) { sendJson(res, 400, { error: parsed.error }); return; }
                        const { targetName, attacker } = parsed.body as { targetName?: string; attacker?: unknown };
                        if (!targetName) { sendJson(res, 400, { error: 'Missing targetName.' }); return; }
                        const targetId = safeName(targetName);
                        if (!targetId) { sendJson(res, 400, { error: 'Invalid targetName.' }); return; }
                        const target = playerPresence.get(targetId);
                        if (!target) { sendJson(res, 404, { error: 'Target not online.' }); return; }
                        playerPresence.set(targetId, { ...target, pendingAttacker: attacker ?? null });
                        sendJson(res, 200, { ok: true });
                    } catch (err: unknown) {
                        sendJson(res, 500, { error: errorMessage(err) });
                    }
                });

                server.middlewares.use('/api/player/clear-attack', async (req: IncomingMessage, res: ServerResponse, next) => {
                    if (req.method !== 'POST') { next(); return; }
                    try {
                        const parsed = parseJsonBody(await readBody(req));
                        if ('error' in parsed) { sendJson(res, 400, { error: parsed.error }); return; }
                        const { name } = parsed.body as { name?: string };
                        if (!name) { sendJson(res, 400, { error: 'Missing name.' }); return; }
                        const playerId = safeName(name);
                        if (!playerId) { sendJson(res, 400, { error: 'Invalid name.' }); return; }
                        const p = playerPresence.get(playerId);
                        if (p) playerPresence.set(playerId, { ...p, pendingAttacker: null });
                        sendJson(res, 200, { ok: true });
                    } catch (err: unknown) {
                        sendJson(res, 500, { error: errorMessage(err) });
                    }
                });

                // Development parity for the production-authoritative travel route.
                // Vite has no Socket.IO world store, so the edge tile comes from the
                // same movement frame included in this request; production ignores
                // that field and validates against its authoritative online store.
                server.middlewares.use('/api/player/travel', async (req: IncomingMessage, res: ServerResponse, next) => {
                    if (req.method !== 'POST') { next(); return; }
                    try {
                        const playerId = devTokenPlayer(req);
                        if (!playerId) { sendJson(res, 401, { error: 'Player authentication required.' }); return; }
                        const parsed = parseJsonBody(await readBody(req));
                        if ('error' in parsed) { sendJson(res, 400, { error: parsed.error }); return; }
                        const body = parsed.body as { destinationSector?: number; mode?: string; originSector?: number; originTile?: number; exitId?: string };
                        const destinationSector = sectorFrom(body.destinationSector, -1);
                        if (destinationSector < 1 || (destinationSector > 60 && destinationSector !== 99)) {
                            sendJson(res, 400, { error: 'Invalid travel destination.' }); return;
                        }
                        const player = playerPresence.get(playerId);
                        if (!player) { sendJson(res, 409, { error: 'World presence is not ready. Please try again.' }); return; }
                        const now = Date.now();
                        if (player.travelingUntil > now) {
                            sendJson(res, 409, { error: 'You cannot travel while moving or fighting.' }); return;
                        }
                        let arrivalTile: number | undefined;
                        if (body.mode === 'edge') {
                            const exit = sectorExitById(player.sector, String(body.exitId ?? ''));
                            if (!exit
                                || player.sector !== Number(body.originSector)
                                || exit.destinationSector !== destinationSector
                                || exit.tile !== Number(body.originTile)) {
                                sendJson(res, 409, { error: 'Move onto that road exit before crossing sectors.' }); return;
                            }
                            arrivalTile = exit.destinationTile;
                        }
                        // Mirror api/player/travel.ts: edge crossings are instant
                        // (walking is free movement); only map fast-travel wears the
                        // 3s mask. Keep the response's travelMs in sync with prod.
                        const travelMs = body.mode === 'edge' ? 0 : 3_000;
                        const arrivalAt = now + travelMs;
                        playerPresence.set(playerId, { ...player, travelingUntil: arrivalAt, destinationSector });
                        sendJson(res, 200, { ok: true, destinationSector, arrivalAt, travelMs, arrivalTile });
                    } catch (err: unknown) {
                        sendJson(res, 500, { error: errorMessage(err) });
                    }
                });
            },
        },
        {
            // Dev parity for the production sector-traces endpoints (api/sector/
            // traces | trail-sign | shrine-offer): in-memory stores, same response
            // shapes, so the traces UI is exercisable without the Express server.
            name: 'api-sector-traces',
            configureServer(server) {
                type DevSign = { id: string; name: string; tile: number; text: string; at: number; sparks: number; sparkedBy: string[] };
                const devSigns = new Map<number, DevSign[]>();
                const devShrines = new Map<string, { total: number; weekTotal: number; topWeek: { name: string; amount: number }[] }>();
                const DEV_SHRINE_SECTORS = Object.fromEntries(
                    SHRINE_DEFS.map(({ sector, ...definition }) => [sector, definition]),
                );
                const devShrineTier = (total: number) => total >= 2_000_000 ? 4 : total >= 500_000 ? 3 : total >= 100_000 ? 2 : total >= 25_000 ? 1 : 0;
                const shrineView = (sector: number) => {
                    const def = DEV_SHRINE_SECTORS[sector];
                    if (!def) return undefined;
                    const state = devShrines.get(def.id) ?? { total: 0, weekTotal: 0, topWeek: [] };
                    return { ...def, tier: devShrineTier(state.total), total: state.total, weekTotal: state.weekTotal, topWeek: state.topWeek.slice(0, 5), lastWeek: null };
                };

                server.middlewares.use('/api/sector/traces', async (req: IncomingMessage, res: ServerResponse, next) => {
                    if (req.method !== 'GET') { next(); return; }
                    const url = new URL(req.url ?? '/', 'http://vite.local');
                    const sector = sectorFrom(url.searchParams.get('sector'), 0);
                    if (sector < 1 || sector > 60) { sendJson(res, 400, { error: 'Invalid sector.' }); return; }
                    const player = safeName(url.searchParams.get('player') ?? '');
                    const signs = devSigns.get(sector) ?? [];
                    const shrine = shrineView(sector);
                    sendJson(res, 200, {
                        ok: true, sector, footfallToday: 0,
                        signs: signs.map(({ sparkedBy: _s, ...sign }) => sign),
                        mySparked: player ? signs.filter(s => s.sparkedBy.includes(player)).map(s => s.id) : [],
                        ...(shrine ? { shrine } : {}),
                    });
                });

                server.middlewares.use('/api/sector/trail-sign', async (req: IncomingMessage, res: ServerResponse, next) => {
                    if (req.method !== 'POST') { next(); return; }
                    const playerId = devTokenPlayer(req);
                    if (!playerId) { sendJson(res, 401, { error: 'Authentication required.' }); return; }
                    const parsed = parseJsonBody(await readBody(req));
                    if ('error' in parsed) { sendJson(res, 400, { error: parsed.error }); return; }
                    const body = parsed.body as { sector?: number; tile?: number; text?: string; action?: string; signId?: string };
                    const sector = sectorFrom(body.sector, 0);
                    if (sector < 1 || sector > 60) { sendJson(res, 400, { error: 'Invalid sector.' }); return; }
                    const signs = devSigns.get(sector) ?? [];
                    if (body.action === 'spark') {
                        const sign = signs.find(s => s.id === body.signId);
                        if (!sign) { sendJson(res, 200, { ok: false, reason: 'not-found' }); return; }
                        if (sign.name === playerId || sign.sparkedBy.includes(playerId)) { sendJson(res, 200, { ok: false, reason: 'already-sparked' }); return; }
                        sign.sparks += 1;
                        sign.sparkedBy.push(playerId);
                        sendJson(res, 200, { ok: true, sparks: sign.sparks });
                        return;
                    }
                    const text = String(body.text ?? '').trim().slice(0, 120);
                    if (!text) { sendJson(res, 400, { error: 'Write something on the sign first.' }); return; }
                    const tile = sectorFrom(body.tile, 77);
                    const sign: DevSign = { id: `ts-dev-${Date.now().toString(36)}`, name: playerId, tile: Math.min(143, tile), text, at: Date.now(), sparks: 0, sparkedBy: [] };
                    const next_ = [...signs.filter(s => s.name !== playerId), sign].slice(-8);
                    devSigns.set(sector, next_);
                    sendJson(res, 200, { ok: true, sign: { ...sign, sparkedBy: undefined }, signs: next_.map(({ sparkedBy: _s, ...rest }) => rest) });
                });

                server.middlewares.use('/api/sector/shrine-offer', async (req: IncomingMessage, res: ServerResponse, next) => {
                    if (req.method !== 'POST') { next(); return; }
                    const playerId = devTokenPlayer(req);
                    if (!playerId) { sendJson(res, 401, { error: 'Authentication required.' }); return; }
                    const parsed = parseJsonBody(await readBody(req));
                    if ('error' in parsed) { sendJson(res, 400, { error: parsed.error }); return; }
                    const body = parsed.body as { shrineId?: string; amount?: number };
                    const entry = Object.entries(DEV_SHRINE_SECTORS).find(([, def]) => def.id === body.shrineId);
                    if (!entry) { sendJson(res, 400, { error: 'Unknown shrine.' }); return; }
                    const amount = Math.floor(Number(body.amount) || 0);
                    if (amount < 10 || amount > 250_000) { sendJson(res, 400, { error: 'Offerings are 10–250,000 ryo.' }); return; }
                    const savePath = path.join(path.resolve(process.cwd(), 'saves'), `${playerId}.json`);
                    let ryo: number;
                    try {
                        const save = JSON.parse(fs.readFileSync(savePath, 'utf8'));
                        const onHand = Math.floor(Number(save?.character?.ryo) || 0);
                        if (onHand < amount) { sendJson(res, 400, { error: `Not enough ryo — you have ${onHand.toLocaleString()}.` }); return; }
                        save.character.ryo = onHand - amount;
                        fs.writeFileSync(savePath, JSON.stringify(save));
                        ryo = save.character.ryo;
                    } catch {
                        sendJson(res, 404, { error: 'Your save was not found.' });
                        return;
                    }
                    const state = devShrines.get(entry[1].id) ?? { total: 0, weekTotal: 0, topWeek: [] };
                    state.total += amount;
                    state.weekTotal += amount;
                    const mine = state.topWeek.find(o => o.name === playerId);
                    if (mine) mine.amount += amount; else state.topWeek.push({ name: playerId, amount });
                    state.topWeek.sort((a, b) => b.amount - a.amount);
                    devShrines.set(entry[1].id, state);
                    sendJson(res, 200, { ok: true, ryo, shrine: shrineView(Number(entry[0])) });
                });
            },
        },
        {
            name: 'api-village-guard',
            configureServer(server) {
                server.middlewares.use('/api/village-guard/queue', async (req: IncomingMessage, res: ServerResponse, next) => {
                    if (req.method !== 'POST') { next(); return; }
                    try {
                        const parsed = parseJsonBody(await readBody(req));
                        if ('error' in parsed) { sendJson(res, 400, { error: parsed.error }); return; }
                        const { name, village, level } = parsed.body as { name?: string; village?: string; level?: number };
                        if (!name || !village) { sendJson(res, 400, { error: 'Missing name or village.' }); return; }
                        const guardId = safeName(name);
                        if (!guardId) { sendJson(res, 400, { error: 'Invalid name.' }); return; }
                        villageGuards.set(guardId, { name: name.trim(), village, level: level ?? 1, lastSeen: Date.now() });
                        sendJson(res, 200, { ok: true });
                    } catch (err: unknown) { sendJson(res, 500, { error: errorMessage(err) }); }
                });

                server.middlewares.use('/api/village-guard/dequeue', async (req: IncomingMessage, res: ServerResponse, next) => {
                    if (req.method !== 'POST') { next(); return; }
                    try {
                        const parsed = parseJsonBody(await readBody(req));
                        if ('error' in parsed) { sendJson(res, 400, { error: parsed.error }); return; }
                        const { name } = parsed.body as { name?: string };
                        if (!name) { sendJson(res, 400, { error: 'Missing name.' }); return; }
                        const guardId = safeName(name);
                        if (!guardId) { sendJson(res, 400, { error: 'Invalid name.' }); return; }
                        villageGuards.delete(guardId);
                        sendJson(res, 200, { ok: true });
                    } catch (err: unknown) { sendJson(res, 500, { error: errorMessage(err) }); }
                });

                server.middlewares.use('/api/village-guard/list', async (req: IncomingMessage, res: ServerResponse, next) => {
                    if (req.method !== 'POST') { next(); return; }
                    try {
                        const parsed = parseJsonBody(await readBody(req));
                        if ('error' in parsed) { sendJson(res, 400, { error: parsed.error }); return; }
                        const { village } = parsed.body as { village?: string };
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
                const authPath = path.join(savesDir, '_auth.json');
                const imagePath = path.join(savesDir, '_images.json');

                server.middlewares.use('/api/images', async (req: IncomingMessage, res: ServerResponse, next) => {
                    if (req.method === 'GET') {
                        const url = new URL(req.url ?? '/', 'http://vite.local');
                        const category = (url.searchParams.get('cat') ?? '').trim();
                        const images = loadDevImages(imagePath);
                        const filtered = category
                            ? Object.fromEntries(Object.entries(images).filter(([id]) => {
                                const prefix = id.split(':')[0];
                                const cat = prefix === 'vn'
                                    ? 'event'
                                    : ['petbody', 'petsheet', 'petlayers'].includes(prefix) ? 'pet' : prefix;
                                return cat === category;
                            }))
                            : images;
                        sendJson(res, 200, url.searchParams.has('ids') ? Object.keys(filtered) : filtered);
                        return;
                    }

                    if (req.method === 'POST') {
                        const playerName = devTokenPlayer(req);
                        const adminPassword = req.headers['x-admin-password'];
                        const isDevAdmin = typeof adminPassword === 'string'
                            && ((env.ADMIN_PASSWORD && devStringMatches(env.ADMIN_PASSWORD, adminPassword))
                                || (env.ADMIN_CONTENT_PASSWORD && devStringMatches(env.ADMIN_CONTENT_PASSWORD, adminPassword)));
                        if (!playerName && !isDevAdmin) {
                            sendJson(res, 401, { error: 'Authentication required.' });
                            return;
                        }
                        const parsed = parseJsonBody(await readBody(req));
                        if ('error' in parsed) { sendJson(res, 400, { error: parsed.error }); return; }
                        const { id, image } = parsed.body as { id?: string; image?: string };
                        if (!id || typeof image !== 'string' || id.length > 256 || !validDevImage(image)) {
                            sendJson(res, 400, { error: 'Invalid image id or image.' });
                            return;
                        }
                        const [prefix, ...rest] = id.split(':');
                        const imageOwner = safeName(rest.join(':'));
                        if (!isDevAdmin && prefix === 'avatar' && imageOwner !== playerName) {
                            sendJson(res, 403, { error: 'You can only set your own avatar.' });
                            return;
                        }
                        if (prefix === 'avatar' && (!image.startsWith('data:image/') || decodedDevImageBytes(image) > MAX_DEV_AVATAR_BYTES)) {
                            sendJson(res, 400, { error: 'Avatar image must be an uploaded image under 2 MB.' });
                            return;
                        }
                        const adminOnly = new Set(['jutsu', 'item', 'card', 'event', 'vn', 'ai', 'shrine', 'landmark', 'bloodline', 'leader']);
                        if (!isDevAdmin && adminOnly.has(prefix)) {
                            sendJson(res, 403, { error: `${prefix} images are admin-only.` });
                            return;
                        }
                        await updateDevImages(imagePath, images => { images[id] = image; });
                        res.writeHead(200);
                        res.end();
                        return;
                    }

                    next();
                });

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

                // The login gate reads this to decide which doors to show, and
                // hides a control on anything but "available". Without a dev
                // answer it 404s, both passwordless sign-in paths vanish
                // locally, and the gate looks broken when it is behaving
                // exactly as designed. Guest play works against the dev
                // player-auth below; Google needs a real OAuth round trip, so
                // it is reported unavailable here rather than offering a button
                // that cannot complete.
                server.middlewares.use('/api/player/capabilities', (req: IncomingMessage, res: ServerResponse, next) => {
                    if (req.method !== 'GET') { next(); return; }
                    const available = { state: 'available', reason: 'available' } as const;
                    const unavailable = { state: 'temporarily-unavailable', reason: 'configuration-unavailable' } as const;
                    sendJson(res, 200, {
                        ok: true,
                        capabilities: {
                            gameplay: available,
                            gameplayMutations: available,
                            registrations: available,
                            // Mirrors the server rule: offered only when a client
                            // id exists. Set GOOGLE_CLIENT_ID locally to render
                            // and style the button; the redirect itself still
                            // needs a real OAuth round trip.
                            googleSignIn: process.env.GOOGLE_CLIENT_ID ? available : unavailable,
                            guestPlay: available,
                            villageWar: available,
                            clanBoss: available,
                            clanBossParties: available,
                            legacy: available,
                            petBreedingStarts: available,
                            weeklyBossGuardCycle: available,
                        },
                    });
                });

                server.middlewares.use('/api/player-auth', async (req: IncomingMessage, res: ServerResponse, next) => {
                    if (req.method !== 'POST') { next(); return; }

                    try {
                        const parsed = parseJsonBody(await readBody(req));
                        if ('error' in parsed) { sendJson(res, 400, { ok: false, error: parsed.error }); return; }

                        const { action, name, password, oldPassword, newPassword } = parsed.body as {
                            action?: string;
                            name?: string;
                            password?: string;
                            oldPassword?: string;
                            newPassword?: string;
                        };
                        if (!name) { sendJson(res, 400, { ok: false, error: 'Missing name.' }); return; }

                        const playerId = safeName(name);
                        if (!playerId) {
                            sendJson(res, 400, { ok: false, error: 'Pick a name with at least one letter or number.' });
                            return;
                        }

                        const store = loadDevAuthStore(authPath);
                        const hasPlayerSave = () => fs.existsSync(path.join(savesDir, `${playerId}.json`));

                        if (action === 'register') {
                            if (!password) { sendJson(res, 400, { ok: false, error: 'Missing password.' }); return; }
                            const policyError = playerPasswordPolicyError(password);
                            if (policyError) { sendJson(res, 400, { ok: false, error: policyError }); return; }
                            if (isReservedDevAuthName(playerId)) {
                                sendJson(res, 403, { ok: false, error: 'That username is reserved. Pick a different name.' });
                                return;
                            }
                            if (store[playerId]) {
                                sendJson(res, 409, { ok: false, error: 'Account already has a password.' });
                                return;
                            }
                            if (hasPlayerSave()) {
                                sendJson(res, 409, {
                                    ok: false,
                                    error: 'This account is a legacy account without a server password. Ask an admin to set it for you.',
                                    legacyNeedsAdmin: true,
                                });
                                return;
                            }

                            store[playerId] = createDevAuthRecord(password);
                            saveDevAuthStore(authPath, store);
                            sendJson(res, 200, { ok: true, token: issueDevSessionToken(playerId) });
                            return;
                        }

                        if (action === 'verify') {
                            if (!password) { sendJson(res, 400, { ok: false, error: 'Missing password.' }); return; }
                            const record = store[playerId];
                            if (!record) {
                                if (hasPlayerSave()) {
                                    sendJson(res, 409, {
                                        ok: false,
                                        error: 'This legacy account requires authenticated admin recovery.',
                                        legacy: true,
                                        legacyNeedsAdmin: true,
                                    });
                                } else {
                                    sendJson(res, 200, { ok: false, unused: true });
                                }
                                return;
                            }
                            const ok = devPasswordMatches(record, password);
                            sendJson(res, 200, { ok, ...(ok ? { token: issueDevSessionToken(playerId) } : {}) });
                            return;
                        }

                        if (action === 'change') {
                            if (!oldPassword || !newPassword) {
                                sendJson(res, 400, { ok: false, error: 'Missing oldPassword or newPassword.' });
                                return;
                            }
                            const policyError = playerPasswordPolicyError(newPassword);
                            if (policyError) { sendJson(res, 400, { ok: false, error: policyError }); return; }
                            if (oldPassword === newPassword) {
                                sendJson(res, 400, { ok: false, error: 'New password must differ from the current password.' });
                                return;
                            }
                            const record = store[playerId];
                            if (!record) {
                                if (hasPlayerSave()) {
                                    sendJson(res, 409, {
                                        ok: false,
                                        error: 'This legacy account requires authenticated admin recovery.',
                                        legacyNeedsAdmin: true,
                                    });
                                } else {
                                    sendJson(res, 404, { ok: false, error: 'Account does not exist.' });
                                }
                                return;
                            }
                            if (!devPasswordMatches(record, oldPassword)) {
                                sendJson(res, 401, { ok: false, error: 'Incorrect current password.' });
                                return;
                            }

                            store[playerId] = createDevAuthRecord(newPassword);
                            saveDevAuthStore(authPath, store);
                            sendJson(res, 200, { ok: true });
                            return;
                        }

                        if (action === 'delete') {
                            if (!password) {
                                sendJson(res, 401, { ok: false, error: 'Authentication required.' });
                                return;
                            }
                            const record = store[playerId];
                            if (!record) {
                                sendJson(res, 404, { ok: false, error: 'Account does not exist.' });
                                return;
                            }
                            if (!devPasswordMatches(record, password)) {
                                sendJson(res, 401, { ok: false, error: 'Incorrect password.' });
                                return;
                            }

                            delete store[playerId];
                            saveDevAuthStore(authPath, store);
                            sendJson(res, 200, { ok: true });
                            return;
                        }

                        if (action === 'adminreset') {
                            const adminPassword = env.ADMIN_PASSWORD;
                            const suppliedAdminPassword = req.headers['x-admin-password'];
                            if (!adminPassword || typeof suppliedAdminPassword !== 'string' || !devStringMatches(adminPassword, suppliedAdminPassword)) {
                                sendJson(res, 401, { ok: false, error: 'Admin authentication required.' });
                                return;
                            }
                            if (!newPassword) { sendJson(res, 400, { ok: false, error: 'Missing newPassword.' }); return; }
                            const policyError = playerPasswordPolicyError(newPassword);
                            if (policyError) { sendJson(res, 400, { ok: false, error: policyError }); return; }
                            store[playerId] = createDevAuthRecord(newPassword);
                            saveDevAuthStore(authPath, store);
                            sendJson(res, 200, { ok: true });
                            return;
                        }

                        sendJson(res, 400, { ok: false, error: 'Unknown action.' });
                    } catch (err: unknown) {
                        sendJson(res, 500, { ok: false, error: errorMessage(err, 'Auth failed') });
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
                            const parsed = parseJsonBody(await readBody(req));
                            if ('error' in parsed) { sendJson(res, 400, { error: parsed.error }); return; }
                            const incoming = parsed.body;
                            if (!incoming || typeof incoming !== 'object') { sendJson(res, 400, { error: 'Invalid save payload.' }); return; }
                            let payload: unknown = incoming;

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
                        const parsed = parseJsonBody(await readBody(req));
                        if ('error' in parsed) { sendJson(res, 400, { error: parsed.error }); return; }
                        const { prompt, label } = parsed.body as { prompt?: string; label?: string };

                        if (!prompt?.trim()) {
                            sendJson(res, 400, { error: 'Missing image prompt.' });
                            return;
                        }
                        if (prompt.length > MAX_PROMPT_LENGTH || (label?.length ?? 0) > MAX_LABEL_LENGTH) {
                            sendJson(res, 413, { error: 'Image prompt is too large.' });
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

                        const finalPrompt = `Create a polished 2D anime shinobi RPG game asset.\n\nUser request:\n${prompt}\n\nAsset label:\n${label ?? ''}\n\nStyle rules:\n- original shinobi RPG fantasy style\n- clean game asset composition\n- dramatic lighting\n- no text\n- no logos\n- no UI\n- no watermarks\n- high detail\n- suitable for a browser RPG`;

                        // Dev-only image generation intentionally sends the configured API credential to OpenAI.
                        // codeql[js/file-access-to-http]
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
    build: {
        // Retained build metadata lets the size gate measure each lazy route's
        // real static closure instead of guessing from chunk filenames.
        manifest: true,
        // runtimePublicAssetsPlugin performs the filtered copy. Leaving Vite's
        // blanket copy enabled would ship multi-gigabyte pet authoring sources.
        copyPublicDir: false,
        // The only chunk above Vite's generic default is the deliberately shared,
        // lazy Three.js stack. scripts/check-build-size.mjs enforces tighter named
        // raw + gzip budgets and proves it stays off the startup graph; keep Vite's
        // advisory ceiling aligned so a clean audited build is warning-free.
        chunkSizeWarningLimit: 1100,
        rollupOptions: {
            // The app does not use discarded property reads as an effect.
            // Let Rolldown eliminate those reads inside lazy game/vendor code
            // instead of shipping them to every browser.
            treeshake: {
                propertyReadSideEffects: false,
            },
            output: {
                // Pull React + ReactDOM into their own vendor chunk so they
                // can be cached independently of app code. The app bundle
                // changes constantly; React itself rarely does, so users
                // re-download a much smaller diff between deploys.
                manualChunks(id: string) {
                    const normalizedId = id.replace(/\\/g, '/');
                    // Keep Vite/Rolldown's dynamic-import preload helper out of
                    // large lazy vendor chunks. If it gets co-located with
                    // Supabase/Socket.IO, the entry has to preload that whole
                    // network stack just to warm route chunks.
                    if (normalizedId.includes('vite/preload-helper') || normalizedId.includes('importAnalysisBuild')) {
                        return 'preload-helper';
                    }
                    if (normalizedId.includes('node_modules/react-dom/') || normalizedId.includes('node_modules/react/')) {
                        return 'react-vendor';
                    }
                    if (normalizedId.includes('node_modules/@sentry/')) {
                        return 'sentry-vendor';
                    }
                    // Live capability truth is an always-loaded control plane,
                    // but its store/admission/provider code changes on a slower
                    // cadence than App's large gameplay coordinator. Keep this
                    // small initial module family in one cacheable chunk so an
                    // unrelated App edit does not make players redownload it or
                    // push the monolithic entry past its audited ceiling.
                    if (
                        normalizedId.endsWith('/shared/public-capabilities.ts') ||
                        normalizedId.endsWith('/src/lib/live-capabilities.ts') ||
                        normalizedId.endsWith('/src/lib/live-capabilities-context.ts') ||
                        normalizedId.endsWith('/src/lib/live-capability-admission.ts') ||
                        normalizedId.endsWith('/src/lib/player-auth-policy.ts') ||
                        normalizedId.endsWith('/src/lib/session-load-authority.ts') ||
                        normalizedId.endsWith('/src/lib/release-safe-content.ts') ||
                        normalizedId.endsWith('/src/lib/use-capability-guarded-autosave.ts') ||
                        normalizedId.endsWith('/src/components/LiveCapabilitiesProvider.tsx') ||
                        normalizedId.endsWith('/src/components/PlayerSurfaceBlocker.tsx')
                    ) {
                        return 'live-capabilities';
                    }
                    // Pet sprite/card resolution is shared by the app shell and
                    // many lazy combat screens. Keep that stable presentation
                    // layer in its own cacheable chunk so adding a species or
                    // visual variant does not keep inflating the entry bundle.
                    if (normalizedId.endsWith('/src/lib/pet-battle-anim.ts')) {
                        return 'pet-presentation';
                    }
                    // Group the heavy 3D stack (three.js + three-stdlib + the
                    // @react-three/* renderer + postprocessing) into ONE cacheable
                    // vendor chunk. It's imported only by lazy 3D screens, so it
                    // stays out of the initial bundle; a single shared chunk avoids
                    // re-downloading three across screens and on every app-code deploy.
                    if (
                        normalizedId.includes('node_modules/three') ||
                        normalizedId.includes('node_modules/@react-three/') ||
                        normalizedId.includes('node_modules/postprocessing/')
                    ) {
                        return 'three-vendor';
                    }
                    return undefined;
                },
            },
        },
    },
    server: {
        port: parseInt(env.DEV_SERVER_PORT || '50891'),
        ...(httpsConfig ? { https: httpsConfig } : {}),
    }
});
