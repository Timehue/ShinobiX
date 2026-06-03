/**
 * Socket.IO realtime layer (Phase 2 / Step 3).
 *
 * Adds a PUSH channel for live sector presence on top of — not instead of — the
 * HTTP `/api/player/heartbeat` poll. The socket:
 *   • authenticates the handshake with the EXACT same auth as every HTTP route
 *     (authedPlayerOrAdmin over a {headers} built from the handshake auth), so
 *     token → password → ban all behave identically and a socket can't spoof a
 *     different player;
 *   • upserts presence into the shared in-memory onlineStore on connect and on
 *     each `presence` ping (the client pings every ~20s = the "15-30s heartbeat",
 *     and immediately on a sector change);
 *   • keeps each socket in a `sector:<n>` room and broadcasts the sector's live
 *     roster to that room whenever someone joins / moves / changes state, so
 *     other players see a newcomer INSTANTLY instead of on their next poll;
 *   • pushes `presence:gone` when the 1s game-loop sweep drops a timed-out
 *     player (offline within the 45-60s window).
 *
 * Degrades safely: if this never attaches (cPanel/Passenger, or
 * DISABLE_REALTIME=1) the client falls back to the HTTP heartbeat with no loss
 * of correctness — only the "instant" feel. The HTTP heartbeat remains the
 * authoritative reconcile + the carrier for forceReload / pendingChallenges /
 * pendingAttacker.
 *
 * Single-instance only (same constraint as onlineStore): correct because
 * Railway runs ONE process. Multi-instance later means a Redis adapter +
 * shared store (Phase 9); consumers don't change.
 */
import type { Server as HttpServer } from 'node:http';
// TYPE-ONLY import — erased at compile time. The socket.io VALUE is loaded via a
// dynamic import() inside attachSocketServer so that merely importing this module
// (server.ts does, on every target including cPanel/Passenger) never hard-requires
// the socket.io package. If it isn't installed, realtime simply stays off and the
// rest of the server (e.g. the cPanel kv-proxy) boots normally.
import type { Server as IOServer, Socket } from 'socket.io';
import { authedPlayerOrAdmin } from '../_auth.js';
import { onlineStore } from './online-store.js';
import { normalizeSector, slimPresenceCharacter, capTravelingUntil, toPlayerRecord } from './presence-input.js';
import { setOnSweep } from './game-loop.js';
import { setRealtimeEmitter } from './notify.js';
// CORS origin allowlist — single source of truth in api/_utils.ts, shared with
// cors() and the Express middleware. Production serves the SPA and the socket
// from the SAME origin (Railway), so CORS isn't even exercised there; this list
// only matters for cross-origin clients (e.g. a dev build pointed at a remote
// backend — set VITE_REALTIME_URL).
import { ALLOWED_ORIGINS, safeName } from '../_utils.js';

let _io: IOServer | null = null;

export function getIo(): IOServer | null {
    return _io;
}

function sectorRoom(sector: number): string {
    return `sector:${sector}`;
}

function sectorSnapshot(sector: number) {
    return onlineStore.list()
        .filter(p => normalizeSector(p.sector) === sector)
        .map(toPlayerRecord);
}

function broadcastSector(io: IOServer, sector: number): void {
    io.to(sectorRoom(sector)).emit('presence:sector', { sector, players: sectorSnapshot(sector) });
}

type HandshakeAuth = Record<string, unknown>;
function authStr(auth: HandshakeAuth, key: string): string | undefined {
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
export function attachSocketServer(httpServer: HttpServer): void {
    if (process.env.DISABLE_REALTIME === '1') {
        console.log('[socket] realtime disabled via DISABLE_REALTIME=1 — HTTP heartbeat only');
        return;
    }
    if (_io) return;

    void (async () => {
        let IOServerCtor: typeof import('socket.io').Server;
        try {
            ({ Server: IOServerCtor } = await import('socket.io'));
        } catch (err) {
            console.warn('[socket] socket.io unavailable — realtime disabled, HTTP heartbeat only:', (err as Error).message);
            return;
        }
        // Guard against a double-attach racing two async imports.
        if (_io) return;

        const io = new IOServerCtor(httpServer, {
            cors: { origin: [...ALLOWED_ORIGINS], methods: ['GET', 'POST'], credentials: true },
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
function wireRealtime(io: IOServer): void {
    // Push departures the instant the game loop sweeps timed-out players. Names
    // are canonical (lowercase); the client compares case-insensitively.
    setOnSweep((removedNames) => {
        io.emit('presence:gone', { names: removedNames });
    });

    // Let request handlers (attack.ts / challenge.ts) kick a specific player to
    // poll immediately — emit to that player's `user:<canonical>` room.
    setRealtimeEmitter((room, event, payload) => {
        io.to(room).emit(event, payload);
    });

    // ── Handshake auth: reuse the EXACT HTTP auth (token → password → ban). ──
    io.use(async (socket, next) => {
        try {
            const auth = (socket.handshake.auth ?? {}) as HandshakeAuth;
            const headers: Record<string, string | undefined> = {
                'x-player-token': authStr(auth, 'x-player-token'),
                'x-player-name': authStr(auth, 'x-player-name'),
                'x-player-password': authStr(auth, 'x-player-password'),
                'x-admin-password': authStr(auth, 'x-admin-password'),
                'x-client-fp': authStr(auth, 'x-client-fp'),
            };
            const identity = await authedPlayerOrAdmin({ headers });
            if (!identity) return next(new Error('unauthorized'));

            // Presence is keyed by the safeName slug. An admin-only connection has
            // no name — derive it from the claimed x-player-name (admins trusted).
            const claimed = safeName(headers['x-player-name'] ?? '');
            const canonicalName = identity.admin ? claimed : identity.name;
            if (!canonicalName) return next(new Error('no player name'));

            socket.data.name = canonicalName;
            socket.data.sector = -1; // not yet placed in a sector room
            next();
        } catch {
            next(new Error('auth error'));
        }
    });

    io.on('connection', (socket: Socket) => {
        const name: string = socket.data.name;

        // Per-player room so attack.ts / challenge.ts can kick THIS player to
        // poll immediately (instant attack/challenge delivery). A player with
        // multiple tabs has multiple sockets in the same room — all get kicked.
        socket.join(`user:${name}`);

        // Accept the client's display-cased name ONLY when it canonicalizes to
        // this socket's authed identity — preserves nice casing, blocks anyone
        // rendering as a different player.
        const displayNameFor = (claimed: unknown): string => {
            if (typeof claimed === 'string' && claimed.trim() && safeName(claimed) === name) {
                return claimed.trim();
            }
            const stored = onlineStore.get(name)?.displayName;
            return stored && safeName(stored) === name ? stored : name;
        };

        const applyPresence = (payload: unknown): void => {
            const p = (payload ?? {}) as {
                sector?: unknown; character?: unknown; travelingUntil?: number;
                inBattle?: boolean; displayName?: unknown;
            };
            const now = Date.now();
            const prevSector: number = socket.data.sector;
            const newSector = normalizeSector(p.sector, onlineStore.get(name)?.sector ?? 40);
            const slim = slimPresenceCharacter(p.character) ?? onlineStore.get(name)?.character ?? null;
            const displayName = displayNameFor(
                p.displayName ?? (slim && typeof (slim as Record<string, unknown>).name === 'string'
                    ? (slim as Record<string, unknown>).name
                    : undefined),
            );

            // NAME is the authed socket identity — never the client body. No spoofing.
            onlineStore.upsert({
                name: displayName,
                sector: newSector,
                character: slim as Record<string, unknown> | null,
                travelingUntil: capTravelingUntil(p.travelingUntil, now),
                inBattle: p.inBattle === true ? true : undefined,
            });

            if (newSector !== prevSector) {
                if (prevSector >= 0) socket.leave(sectorRoom(prevSector));
                socket.join(sectorRoom(newSector));
                socket.data.sector = newSector;
                // The joining socket gets the fresh snapshot immediately…
                socket.emit('presence:sector', { sector: newSector, players: sectorSnapshot(newSector) });
                // …and both affected rooms see the membership change.
                broadcastSector(io, newSector);
                if (prevSector >= 0) broadcastSector(io, prevSector);
            } else {
                // Same sector — peers may need the state change (inBattle, etc.).
                broadcastSector(io, newSector);
            }
        };

        // Initial presence may ride on the handshake for an instant first paint,
        // or arrive as the first 'presence' event.
        const initialPresence = (socket.handshake.auth as HandshakeAuth)?.presence;
        if (initialPresence) applyPresence(initialPresence);

        socket.on('presence', applyPresence);

        // On-demand snapshot (e.g. right after a reconnect).
        socket.on('presence:request', (payload: unknown) => {
            const sector = normalizeSector(
                (payload as { sector?: unknown })?.sector,
                socket.data.sector >= 0 ? socket.data.sector : 40,
            );
            socket.emit('presence:sector', { sector, players: sectorSnapshot(sector) });
        });

        socket.on('disconnect', () => {
            // Do NOT remove from the store here. Per the presence spec the player
            // stays "online" until the 45-60s sweep (they may reconnect, and the
            // HTTP heartbeat may still own the row). Just leave the room; the
            // sweep's presence:gone drives the offline transition for peers.
            const s: number = socket.data.sector;
            if (s >= 0) socket.leave(sectorRoom(s));
        });
    });
}
