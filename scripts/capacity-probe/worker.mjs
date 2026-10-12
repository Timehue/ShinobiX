/*
 * Capacity-probe worker: a forked child that drives a slice of virtual players
 * (scripts/capacity-probe/README.md). One worker = one simulated Cloudflare POP:
 * its players share one EdgeCache, so origin load from edge-cached polls scales
 * with POPs, as it does in production.
 *
 * Each virtual player first logs in the way the real client does (password
 * verify, save load, admin content, village tax, fight-resume probes: see
 * VirtualPlayer.login; CAPACITY_LOGIN_PHASE=0 skips it), then mirrors the real
 * signed-in client idling or playing on the world map, as mapped from
 * shinobij.client/src on 2026-10-12:
 *   - Socket.IO presence: auth { x-player-token, x-player-name, x-client-fp,
 *     presenceBatch: 1, presence }, a `presence` frame every 20 s, and
 *     `presence:request` on connect;
 *   - POST /api/player/heartbeat every 20 s with the socket up (socketLive once
 *     the client holds a roster, dropped once a minute to refresh it);
 *   - the gameplay polls at the client's own cadence, the edge-cached ones
 *     through the POP's EdgeCache;
 *   - ACTIVE players also autosave (about once a minute, server-paced by
 *     nextSaveInMs, 409 → refetch) and take a map trip every few minutes.
 * Players never post chat: test lines would be visible to real testers.
 *
 * IPC from the orchestrator:
 *   { type: 'provision', indices }   register + first save (setup, not measured)
 *   { type: 'activate', indices }    start the session loops
 *   { type: 'deactivate', indices }
 *   { type: 'flush' }                → { type: 'stats', stats, edge }
 *   { type: 'shutdown' }
 */
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { EdgeCache, StatsBook, jittered, probeAccountName, sMaxAgeMs, sleep, syntheticIp } from './lib.mjs';

const TARGET = String(process.env.CAPACITY_TARGET ?? '').replace(/\/$/, '');
const RUN_ID = String(process.env.CAPACITY_RUN_ID ?? '');
const POP = Number(process.env.CAPACITY_POP ?? 0);
const ACTIVE_FRACTION = Number(process.env.CAPACITY_ACTIVE_FRACTION ?? 0.5);
const SECTOR = Number(process.env.CAPACITY_SECTOR ?? 40);
const TRAVEL = process.env.CAPACITY_TRAVEL !== '0';
// Chance an active player's 15 s autosave tick has a change to save. Production
// (2026-10-11) showed about one save a minute per active player, so 0.25.
const SAVE_CHANCE = Number(process.env.CAPACITY_SAVE_CHANCE ?? 0.25);
const REQUEST_TIMEOUT_MS = 15_000;
// Each activation logs in the way a real player does (VirtualPlayer.login).
// CAPACITY_LOGIN_PHASE=0 restores the idle-only model for comparison.
const LOGIN_PHASE = process.env.CAPACITY_LOGIN_PHASE !== '0';

// Verified edge-cached at Cloudflare on 2026-10-11 (cf-cache-status HIT).
// Anything else reaches the origin even when it sends s-maxage (e.g.
// /api/clan/war/list is DYNAMIC at Cloudflare despite s-maxage=10).
const EDGE_ROUTES = new Set([
    '/api/game-state', '/api/world-state', '/api/world-crisis', '/api/world-crisis-80',
    '/api/weekly-boss', '/api/player/roster', '/api/images',
]);
const IMAGE_CATEGORIES = ['avatar', 'jutsu', 'pet', 'bloodline', 'card', 'shrine', 'item', 'misc'];
const VILLAGES = ['Stormveil Village', 'Ashen Leaf Village', 'Frostfang Village', 'Moonshadow Village'];
const SPECIALTIES = ['Ninjutsu', 'Genjutsu', 'Taijutsu', 'Bukijutsu'];

const stats = new StatsBook();
const edge = new EdgeCache({ pops: 1 }); // this worker IS one POP
let edgeHits = 0;
let edgeMisses = 0;
let socketEvents = 0;
let io = null;

async function loadSocketIo() {
    if (io) return io;
    try {
        io = (await import('socket.io-client')).io;
    } catch {
        // Local runs: the client package carries socket.io-client.
        const require = createRequire(new URL('../../shinobij.client/package.json', import.meta.url));
        io = require('socket.io-client').io;
    }
    return io;
}

function label(method, path) {
    return `${method} ${path.replace(/\?.*$/, '').replace(/^\/api\/save\/[^/]+$/, '/api/save/:name')}`;
}

async function request(player, method, path, { body, auth = true, statLabel } = {}) {
    const headers = { 'content-type': 'application/json', 'x-real-ip': player.ip, 'x-forwarded-for': player.ip, 'x-client-fp': player.fp };
    if (auth && player.token) {
        headers['x-player-token'] = player.token;
        headers['x-player-name'] = player.name;
    }
    const started = performance.now();
    let status = 0;
    let json = null;
    let cacheControl = null;
    try {
        const res = await fetch(`${TARGET}${path}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        status = res.status;
        cacheControl = res.headers.get('cache-control');
        const text = await res.text();
        try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    } catch {
        status = 0;
    }
    stats.record(statLabel ?? label(method, path), performance.now() - started, status);
    return { status, json, cacheControl };
}

/** A GET a real client makes; edge-cached routes go through this POP's cache. */
async function poll(player, path) {
    const route = path.replace(/\?.*$/, '');
    if (!EDGE_ROUTES.has(route)) return request(player, 'GET', path);
    const { hit } = await edge.get(0, path, async () => {
        const res = await request(player, 'GET', path, { statLabel: `${label('GET', path)} (edge miss)` });
        // Only a successful response is cached, as Cloudflare does by default.
        return { value: res.status, ttlMs: res.status === 200 ? sMaxAgeMs(res.cacheControl) : null };
    });
    if (hit) edgeHits += 1; else edgeMisses += 1;
}

class VirtualPlayer {
    constructor(index) {
        this.index = index;
        this.name = probeAccountName(RUN_ID, index);
        this.ip = syntheticIp(index);
        this.fp = randomBytes(16).toString('hex');
        this.password = `Lt-${randomBytes(9).toString('hex')}9`;
        this.village = VILLAGES[index % VILLAGES.length];
        this.specialty = SPECIALTIES[index % SPECIALTIES.length];
        this.active = ACTIVE_FRACTION > 0 && ((index * 7919) % 1000) / 1000 < ACTIVE_FRACTION;
        this.token = null;
        this.version = 0;
        this.sector = SECTOR;
        this.tile = 60 + (index % 24);
        this.hasRoster = false;
        this.rosterAt = 0;
        this.running = false;
        this.socket = null;
        this.timers = [];
        this.hp = 100;
    }

    presenceCharacter() {
        return {
            name: this.name, level: 1, village: this.village, specialty: this.specialty,
            rank: 'Academy Student', profession: null, rankedRating: 1000, petRankedRating: 1000,
            clan: null, hp: this.hp, maxHp: 100, pets: [],
        };
    }

    presenceFrame() {
        return {
            sector: this.sector, enterTown: false, character: this.presenceCharacter(), travelingUntil: 0,
            inBattle: false, displayName: this.name, tile: this.tile, continuousWorld: true,
        };
    }

    async provision() {
        for (let attempt = 0; attempt < 4 && !this.token; attempt += 1) {
            const reg = await request(this, 'POST', '/api/player-auth', {
                auth: false, statLabel: 'SETUP register',
                body: { action: 'register', name: this.name, password: this.password },
            });
            if (reg.status === 200 && reg.json?.token) this.token = reg.json.token;
            else if (reg.status === 409) return false; // name taken: a previous run's account
            else await sleep(500 * (attempt + 1));
        }
        if (!this.token) return false;
        const first = await request(this, 'POST', `/api/save/${this.name}`, {
            statLabel: 'SETUP first save',
            body: {
                character: { name: this.name, village: this.village, specialty: this.specialty },
                currentSector: SECTOR,
                _baseSaveVersion: 0,
            },
        });
        this.adopt(first.json);
        return first.status === 200;
    }

    adopt(body) {
        const v = Number(body?._saveVersion);
        if (Number.isFinite(v) && v > this.version) this.version = v;
    }

    every(baseMs, fn, { immediate = false } = {}) {
        const loop = async () => {
            if (immediate) await fn().catch(() => undefined);
            while (this.running) {
                await sleep(jittered(baseMs));
                if (!this.running) break;
                await fn().catch(() => undefined);
            }
        };
        void loop();
    }

    /**
     * The real interactive login burst, in the client's order (mapped from
     * shinobij.client/src on 2026-10-12). The edge-cached polls that follow it
     * were already modelled; these are the origin-heavy requests that were not:
     *   - POST /api/player-auth verify   (scrypt: ~100 ms of server CPU)
     *   - GET  /api/save/:name           (the owner save load)
     *   - GET  /api/save/Admin 1, Admin 2 (shared admin content; no-store)
     *   - POST /api/village/tax          (level-1 probe players are exempt:
     *                                     nothing is debited or written)
     *   - POST /api/missions/ai-fight-start resumeWorldFight, then resumeAiFight
     *     (both 204 for a player with no fight, as for most real logins)
     * plus the second heartbeat the client fires within a second or two.
     */
    async login() {
        const verify = await request(this, 'POST', '/api/player-auth', {
            auth: false, statLabel: 'LOGIN verify',
            body: { action: 'verify', name: this.name, password: this.password },
        });
        if (verify.status === 200 && verify.json?.token) this.token = verify.json.token;
        const own = await request(this, 'GET', `/api/save/${this.name}`, { statLabel: 'LOGIN own save' });
        this.adopt(own.json);
        await Promise.all([
            request(this, 'GET', '/api/save/Admin%201', { statLabel: 'LOGIN admin content' }),
            request(this, 'GET', '/api/save/Admin%202', { statLabel: 'LOGIN admin content' }),
            request(this, 'POST', '/api/village/tax', { statLabel: 'LOGIN village tax', body: { playerName: this.name } }),
            (async () => {
                const world = await request(this, 'POST', '/api/missions/ai-fight-start', {
                    statLabel: 'LOGIN resume world fight',
                    body: { playerName: this.name, resumeWorldFight: true, recoveryProbeVersion: 2 },
                });
                const noWorldFight = world.status === 204 || world.status === 404
                    || (world.status === 409 && world.json?.mode === 'generic');
                if (noWorldFight) {
                    await request(this, 'POST', '/api/missions/ai-fight-start', {
                        statLabel: 'LOGIN resume ai fight',
                        body: { playerName: this.name, resumeAiFight: true, recoveryProbeVersion: 2 },
                    });
                }
            })(),
        ]);
    }

    async start() {
        if (this.running || !this.token) return;
        this.running = true;
        if (LOGIN_PHASE) await this.login();
        await this.connectSocket();
        // The client's second boot heartbeat (village reset / socket connect).
        if (LOGIN_PHASE) void sleep(jittered(1_500)).then(() => (this.running ? this.heartbeat() : undefined)).catch(() => undefined);
        // Session start: image manifests (edge-cached, once per category).
        for (const cat of IMAGE_CATEGORIES) void poll(this, `/api/images?cat=${cat}&ids=1&ver=1`);
        this.every(20_000, () => this.heartbeat(), { immediate: true });
        this.every(10_000, () => poll(this, '/api/game-state'), { immediate: true });
        this.every(15_000, () => poll(this, '/api/world-state'), { immediate: true });
        this.every(15_000, () => Promise.all([poll(this, '/api/world-crisis'), poll(this, '/api/world-crisis-80')]), { immediate: true });
        this.every(60_000, () => poll(this, '/api/weekly-boss'), { immediate: true });
        this.every(60_000, () => poll(this, '/api/player/roster'), { immediate: true });
        this.every(30_000, () => poll(this, '/api/player/capabilities'), { immediate: true });
        this.every(30_000, () => poll(this, '/api/messages'), { immediate: true });
        this.every(50_000, () => poll(this, '/api/village/intel'), { immediate: true });
        this.every(30_000, () => poll(this, `/api/sector/chat?sector=${this.sector}&since=0`));
        if (this.active) {
            this.every(15_000, () => this.autosave());
            if (TRAVEL) this.every(180_000, () => this.travel());
        }
    }

    async connectSocket() {
        const ioClient = await loadSocketIo();
        await new Promise((resolve) => {
            const started = performance.now();
            const socket = ioClient(TARGET, {
                auth: {
                    'x-player-token': this.token, 'x-player-name': this.name, 'x-client-fp': this.fp,
                    presenceBatch: 1, presence: this.presenceFrame(),
                },
                extraHeaders: { 'x-real-ip': this.ip, 'x-forwarded-for': this.ip },
                reconnection: true, reconnectionDelay: 1_000, reconnectionDelayMax: 8_000,
                timeout: REQUEST_TIMEOUT_MS,
            });
            this.socket = socket;
            let settled = false;
            const done = (status) => {
                if (settled) return;
                settled = true;
                stats.record('SOCKET connect', performance.now() - started, status);
                resolve();
            };
            socket.on('connect', () => {
                socket.emit('presence:request', { sector: this.sector });
                done(200);
            });
            socket.on('connect_error', () => done(0));
            socket.onAny((event) => {
                socketEvents += 1;
                if (event === 'presence:sector') { this.hasRoster = true; this.rosterAt = Date.now(); }
            });
            socket.on('disconnect', (reason) => {
                if (this.running && reason !== 'io client disconnect') stats.record('SOCKET unexpected disconnect', 0, 0);
            });
            setTimeout(() => done(0), REQUEST_TIMEOUT_MS).unref();
        });
        this.every(20_000, async () => {
            if (this.socket?.connected) this.socket.emit('presence', this.presenceFrame());
        });
    }

    async heartbeat() {
        // A visible tab drops socketLive once its roster is a minute old, to refresh it.
        const socketLive = !!this.socket?.connected && this.hasRoster && Date.now() - this.rosterAt < 60_000;
        const res = await request(this, 'POST', '/api/player/heartbeat', {
            body: {
                name: this.name, sector: this.sector, enterTown: false, character: this.presenceCharacter(),
                travelingUntil: 0, inBattle: false, tile: this.tile, continuousWorld: true,
                noticeAck: true, exchangeSaleNotices: true, ackNotices: [],
                ...(socketLive ? { socketLive: true } : {}),
            },
        });
        if (Array.isArray(res.json?.sectorMates)) { this.hasRoster = true; this.rosterAt = Date.now(); }
        if (typeof res.json?.sector === 'number') this.sector = res.json.sector;
    }

    async autosave() {
        // Only a dirty client saves: about once a minute for an active player.
        if (Math.random() >= SAVE_CHANCE) return;
        this.hp = 90 + Math.floor(Math.random() * 10);
        const res = await request(this, 'POST', `/api/save/${this.name}`, {
            body: {
                character: { name: this.name, village: this.village, specialty: this.specialty, hp: this.hp },
                currentSector: this.sector,
                _baseSaveVersion: this.version,
            },
        });
        this.adopt(res.json);
        if (res.status === 409) this.adopt((await request(this, 'GET', `/api/save/${this.name}`)).json);
    }

    async travel() {
        const destination = this.sector === SECTOR ? SECTOR + 1 : SECTOR;
        const res = await request(this, 'POST', '/api/player/travel', { body: { destinationSector: destination } });
        if (res.status === 200 && typeof res.json?.destinationSector === 'number') {
            await sleep(Number(res.json.travelMs ?? 3_000) + 250);
            this.sector = res.json.destinationSector;
            this.hasRoster = false;
            await this.heartbeat();
            if (this.socket?.connected) this.socket.emit('presence', this.presenceFrame());
        }
    }

    stop() {
        this.running = false;
        this.socket?.disconnect();
        this.socket = null;
    }
}

const players = new Map();
const playerFor = (index) => {
    let p = players.get(index);
    if (!p) { p = new VirtualPlayer(index); players.set(index, p); }
    return p;
};

process.on('message', async (msg) => {
    try {
        if (msg.type === 'provision') {
            let ok = 0;
            for (const index of msg.indices) {
                if (await playerFor(index).provision()) ok += 1;
                await sleep(msg.gapMs ?? 0);
            }
            process.send({ type: 'provisioned', ok, requested: msg.indices.length });
        } else if (msg.type === 'activate') {
            for (const index of msg.indices) {
                void playerFor(index).start();
                await sleep(msg.gapMs ?? 40);
            }
            process.send({ type: 'activated', count: msg.indices.length });
        } else if (msg.type === 'deactivate') {
            for (const index of msg.indices) players.get(index)?.stop();
            process.send({ type: 'deactivated' });
        } else if (msg.type === 'flush') {
            process.send({ type: 'stats', stats: stats.toJSON(), edge: { hits: edgeHits, misses: edgeMisses }, socketEvents });
            stats.rows.clear();
            edgeHits = 0;
            edgeMisses = 0;
            socketEvents = 0;
        } else if (msg.type === 'shutdown') {
            for (const p of players.values()) p.stop();
            process.send({ type: 'bye' });
            setTimeout(() => process.exit(0), 200).unref();
        }
    } catch (err) {
        process.send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
});

process.send?.({ type: 'ready', pop: POP });
