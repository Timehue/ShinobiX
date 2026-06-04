"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getIo = getIo;
exports.attachSocketServer = attachSocketServer;
const _auth_js_1 = require("../_auth.js");
const online_store_js_1 = require("./online-store.js");
const presence_input_js_1 = require("./presence-input.js");
const game_loop_js_1 = require("./game-loop.js");
const notify_js_1 = require("./notify.js");
// CORS origin predicate — single source of truth in api/_utils.ts, shared with
// cors() and the Express middleware. Even when production serves the SPA and the
// socket from the SAME origin (Railway), the browser still sends an Origin
// header on the Socket.IO polling handshake, so that origin must pass the
// predicate or the handshake fails while the page itself loads fine. The shared
// isAllowedOrigin() covers the static allowlist + EXTRA_ALLOWED_ORIGINS +
// *.up.railway.app, so the Railway URL works out of the box.
const _utils_js_1 = require("../_utils.js");
let _io = null;
function getIo() {
    return _io;
}
function sectorRoom(sector) {
    return `sector:${sector}`;
}
function sectorSnapshot(sector) {
    return online_store_js_1.onlineStore.list()
        .filter(p => (0, presence_input_js_1.normalizeSector)(p.sector) === sector)
        .map(presence_input_js_1.toPlayerRecord);
}
function broadcastSector(io, sector) {
    io.to(sectorRoom(sector)).emit('presence:sector', { sector, players: sectorSnapshot(sector) });
}
function authStr(auth, key) {
    const v = auth[key];
    return typeof v === 'string' && v.length ? v : undefined;
}
/**
 * Attach a Socket.IO server to the given HTTP server. Idempotent and
 * fire-and-forget: socket.io is loaded via dynamic import(), so this returns
 * immediately and wires everything up once the import resolves. A no-op when
 * DISABLE_REALTIME=1 or socket.io isn't installed (the server keeps running on
 * the HTTP heartbeat). Call once at server boot — the http.Server may already
 * be listening.
 */
function attachSocketServer(httpServer) {
    if (process.env.DISABLE_REALTIME === '1') {
        console.log('[socket] realtime disabled via DISABLE_REALTIME=1 — HTTP heartbeat only');
        return;
    }
    if (_io)
        return;
    void (async () => {
        let IOServerCtor;
        try {
            ({ Server: IOServerCtor } = await import('socket.io'));
        }
        catch (err) {
            console.warn('[socket] socket.io unavailable — realtime disabled, HTTP heartbeat only:', err.message);
            return;
        }
        // Guard against a double-attach racing two async imports.
        if (_io)
            return;
        const io = new IOServerCtor(httpServer, {
            cors: {
                // Function form so the same isAllowedOrigin() predicate gates the
                // handshake (static allowlist + EXTRA_ALLOWED_ORIGINS +
                // *.up.railway.app). A missing Origin (native/server clients) is
                // allowed — CORS only governs browsers, which always send one.
                // Params typed explicitly (compatible with @types/cors
                // CustomOrigin) so this compiles even when socket.io's own types
                // aren't resolvable in a given build env.
                origin: (origin, cb) => cb(null, !origin || (0, _utils_js_1.isAllowedOrigin)(origin)),
                methods: ['GET', 'POST'],
                credentials: true,
            },
            // Detect dead sockets within ~45s (matches the offline window). The
            // client ping cadence (~20s) sits well inside this.
            pingInterval: 25_000,
            pingTimeout: 20_000,
        });
        _io = io;
        wireRealtime(io);
        console.log('[socket] Socket.IO realtime layer attached');
    })();
}
/** Wire the sweep/notify hooks + connection handlers onto an io instance. */
function wireRealtime(io) {
    // Push departures the instant the game loop sweeps timed-out players. Names
    // are canonical (lowercase); the client compares case-insensitively.
    (0, game_loop_js_1.setOnSweep)((removedNames) => {
        io.emit('presence:gone', { names: removedNames });
    });
    // Let request handlers (attack.ts / challenge.ts) kick a specific player to
    // poll immediately — emit to that player's `user:<canonical>` room.
    (0, notify_js_1.setRealtimeEmitter)((room, event, payload) => {
        io.to(room).emit(event, payload);
    });
    // ── Handshake auth: reuse the EXACT HTTP auth (token → password → ban). ──
    io.use(async (socket, next) => {
        try {
            const auth = (socket.handshake.auth ?? {});
            const headers = {
                'x-player-token': authStr(auth, 'x-player-token'),
                'x-player-name': authStr(auth, 'x-player-name'),
                'x-player-password': authStr(auth, 'x-player-password'),
                'x-admin-password': authStr(auth, 'x-admin-password'),
                'x-client-fp': authStr(auth, 'x-client-fp'),
            };
            const identity = await (0, _auth_js_1.authedPlayerOrAdmin)({ headers });
            if (!identity)
                return next(new Error('unauthorized'));
            // Presence is keyed by the safeName slug. An admin-only connection has
            // no name — derive it from the claimed x-player-name (admins trusted).
            const claimed = (0, _utils_js_1.safeName)(headers['x-player-name'] ?? '');
            const canonicalName = identity.admin ? claimed : identity.name;
            if (!canonicalName)
                return next(new Error('no player name'));
            socket.data.name = canonicalName;
            socket.data.sector = -1; // not yet placed in a sector room
            next();
        }
        catch {
            next(new Error('auth error'));
        }
    });
    io.on('connection', (socket) => {
        const name = socket.data.name;
        // Per-player room so attack.ts / challenge.ts can kick THIS player to
        // poll immediately (instant attack/challenge delivery). A player with
        // multiple tabs has multiple sockets in the same room — all get kicked.
        socket.join(`user:${name}`);
        // Accept the client's display-cased name ONLY when it canonicalizes to
        // this socket's authed identity — preserves nice casing, blocks anyone
        // rendering as a different player.
        const displayNameFor = (claimed) => {
            if (typeof claimed === 'string' && claimed.trim() && (0, _utils_js_1.safeName)(claimed) === name) {
                return claimed.trim();
            }
            const stored = online_store_js_1.onlineStore.get(name)?.displayName;
            return stored && (0, _utils_js_1.safeName)(stored) === name ? stored : name;
        };
        const applyPresence = (payload) => {
            const p = (payload ?? {});
            const now = Date.now();
            const prevSector = socket.data.sector;
            const newSector = (0, presence_input_js_1.normalizeSector)(p.sector, online_store_js_1.onlineStore.get(name)?.sector ?? 40);
            const slim = (0, presence_input_js_1.slimPresenceCharacter)(p.character) ?? online_store_js_1.onlineStore.get(name)?.character ?? null;
            const displayName = displayNameFor(p.displayName ?? (slim && typeof slim.name === 'string'
                ? slim.name
                : undefined));
            // NAME is the authed socket identity — never the client body. No spoofing.
            online_store_js_1.onlineStore.upsert({
                name: displayName,
                sector: newSector,
                character: slim,
                travelingUntil: (0, presence_input_js_1.capTravelingUntil)(p.travelingUntil, now),
                inBattle: p.inBattle === true ? true : undefined,
            });
            if (newSector !== prevSector) {
                if (prevSector >= 0)
                    socket.leave(sectorRoom(prevSector));
                socket.join(sectorRoom(newSector));
                socket.data.sector = newSector;
                // The joining socket gets the fresh snapshot immediately…
                socket.emit('presence:sector', { sector: newSector, players: sectorSnapshot(newSector) });
                // …and both affected rooms see the membership change.
                broadcastSector(io, newSector);
                if (prevSector >= 0)
                    broadcastSector(io, prevSector);
            }
            else {
                // Same sector — peers may need the state change (inBattle, etc.).
                broadcastSector(io, newSector);
            }
        };
        // Per-socket throttle for the `presence` event. Each applyPresence runs
        // an O(n) onlineStore scan plus a sector room broadcast, and — unlike the
        // HTTP heartbeat (90/min cap, see api/player/heartbeat.ts) — the socket
        // path is otherwise uncapped, so an authed client could loop `presence`
        // emits to amplify broadcasts far past the heartbeat budget. Bound it to
        // one apply per PRESENCE_MIN_INTERVAL_MS with a LEADING edge (first emit
        // applies instantly, so a real sector change is never delayed) plus a
        // TRAILING edge that applies the latest coalesced payload at the window
        // boundary (so the final state in a burst still lands — just collapsed
        // into one broadcast). Legitimate clients ping ~every 20s and on sector
        // change, so normal play is never throttled.
        const PRESENCE_MIN_INTERVAL_MS = 1000;
        const onPresence = (payload) => {
            const now = Date.now();
            const elapsed = now - (socket.data.lastPresenceAt ?? 0);
            if (elapsed >= PRESENCE_MIN_INTERVAL_MS) {
                socket.data.lastPresenceAt = now;
                applyPresence(payload);
                return;
            }
            // Inside the window: keep only the latest payload and schedule a
            // single trailing apply at the boundary (coalescing a burst).
            socket.data.pendingPresence = payload;
            if (!socket.data.presenceTimer) {
                socket.data.presenceTimer = setTimeout(() => {
                    socket.data.presenceTimer = null;
                    socket.data.lastPresenceAt = Date.now();
                    const pending = socket.data.pendingPresence;
                    socket.data.pendingPresence = undefined;
                    applyPresence(pending);
                }, PRESENCE_MIN_INTERVAL_MS - elapsed);
            }
        };
        // Initial presence may ride on the handshake for an instant first paint,
        // or arrive as the first 'presence' event.
        const initialPresence = socket.handshake.auth?.presence;
        if (initialPresence) {
            socket.data.lastPresenceAt = Date.now();
            applyPresence(initialPresence);
        }
        socket.on('presence', onPresence);
        // On-demand snapshot (e.g. right after a reconnect).
        socket.on('presence:request', (payload) => {
            const sector = (0, presence_input_js_1.normalizeSector)(payload?.sector, socket.data.sector >= 0 ? socket.data.sector : 40);
            socket.emit('presence:sector', { sector, players: sectorSnapshot(sector) });
        });
        socket.on('disconnect', () => {
            // Cancel any pending trailing presence apply so the timer can't fire
            // (and broadcast) for an already-departed socket.
            if (socket.data.presenceTimer) {
                clearTimeout(socket.data.presenceTimer);
                socket.data.presenceTimer = null;
            }
            // Do NOT remove from the store here. Per the presence spec the player
            // stays "online" until the 45-60s sweep (they may reconnect, and the
            // HTTP heartbeat may still own the row). Just leave the room; the
            // sweep's presence:gone drives the offline transition for peers.
            const s = socket.data.sector;
            if (s >= 0)
                socket.leave(sectorRoom(s));
        });
    });
}
