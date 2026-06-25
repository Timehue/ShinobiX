/**
 * Client Socket.IO presence layer (Phase 2 / Step 3).
 *
 * A thin, framework-agnostic wrapper around one socket connection. It is
 * ADDITIVE over the HTTP `/api/player/heartbeat` poll — if the socket never
 * connects (server has DISABLE_REALTIME=1, cPanel/Passenger, network), the app
 * keeps working on the HTTP heartbeat alone. The socket buys two things:
 *
 *   1. INSTANT sector presence — `presence:sector` snapshots arrive the moment
 *      someone joins / moves / changes state in your sector (no poll wait), and
 *      `presence:gone` removes players the instant the server sweeps them.
 *   2. INSTANT attack/challenge delivery — `presence:kick` nudges the client to
 *      run an off-cycle heartbeat immediately. The HTTP heartbeat remains the
 *      authoritative carrier of pendingAttacker / pendingChallenges, so there is
 *      no double-delivery and nothing is lost if a push is missed.
 *
 * NOTE: this is the SHINOBIX game socket — distinct from src/lib/realtime.ts,
 * which is the Supabase Realtime client for pvp:* / challenges:* row subs.
 *
 * Auth mirrors the HTTP interceptor (token preferred, password fallback) and is
 * re-read on every (re)connect so a token the HTTP path just re-minted is used.
 *
 * Connection target: same-origin in production (Railway serves SPA + socket).
 * Set VITE_REALTIME_URL to point a dev build (localhost:5173) at a remote
 * backend — the server allowlists localhost origins for the socket CORS.
 */
import { io, type Socket } from 'socket.io-client';
import { getSocketAuth } from '../authFetch';
import { getFingerprintSync } from '../fingerprint';
import type { PlayerRecord } from '../types/character';

export type PresenceFrame = {
    sector: number;
    /** Already slimmed by presenceCharacter() before it reaches here. */
    character: unknown;
    travelingUntil?: number;
    inBattle?: boolean;
    /** Original-cased name for display; server validates it matches the identity. */
    displayName?: string;
    /** Within-sector tile (0..143) for live peer rendering; display-only. */
    tile?: number;
};

type SectorHandler = (sector: number, players: PlayerRecord[]) => void;
type GoneHandler = (names: string[]) => void;
type KickHandler = (reason: string) => void;
type StatusHandler = (connected: boolean) => void;

let socket: Socket | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let latestFrame: PresenceFrame | null = null;

const sectorHandlers = new Set<SectorHandler>();
const goneHandlers = new Set<GoneHandler>();
const kickHandlers = new Set<KickHandler>();
const statusHandlers = new Set<StatusHandler>();

// Keepalive cadence — the "15-30s client heartbeat" that keeps server presence
// fresh inside the 45-60s offline window.
const PING_MS = 20_000;

const REALTIME_URL = (import.meta.env.VITE_REALTIME_URL as string | undefined) || undefined;

function buildAuth(): Record<string, unknown> {
    const { token, name, password } = getSocketAuth();
    const fp = getFingerprintSync();
    const auth: Record<string, unknown> = {};
    if (token) auth['x-player-token'] = token;
    if (name) auth['x-player-name'] = name;
    if (!token && password) auth['x-player-password'] = password;
    if (fp) auth['x-client-fp'] = fp;
    // Ride initial presence on the handshake for an instant first paint.
    if (latestFrame) auth.presence = latestFrame;
    return auth;
}

export function isRealtimeConnected(): boolean {
    return !!socket?.connected;
}

/** Connect (idempotent). Pass current presence so the server places you immediately. */
export function connectRealtime(initialFrame: PresenceFrame): void {
    latestFrame = initialFrame;
    if (socket) {
        // Already have a socket — just refresh presence.
        updatePresence(initialFrame);
        return;
    }
    const opts = {
        auth: buildAuth(),
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 8000,
        // Let socket.io negotiate the best transport (polling → upgrade) for
        // maximum compatibility behind proxies.
    };
    socket = REALTIME_URL ? io(REALTIME_URL, opts) : io(opts);

    socket.on('connect', () => {
        // Re-assert authoritative presence on every (re)connect, then immediately
        // pull the current sector roster so a reconnecting client repopulates its
        // sector-mates at once instead of waiting up to 20s for the next HTTP
        // reconcile. Without this, peers briefly vanish after any socket blip.
        if (latestFrame) {
            socket?.emit('presence', latestFrame);
            socket?.emit('presence:request', { sector: latestFrame.sector });
        }
        statusHandlers.forEach((h) => h(true));
    });
    socket.on('disconnect', () => {
        statusHandlers.forEach((h) => h(false));
    });
    socket.on('connect_error', () => {
        // The HTTP path may have re-minted the token since the last attempt —
        // refresh the handshake creds so socket.io's auto-retry uses them.
        if (socket) socket.auth = buildAuth();
    });

    socket.on('presence:sector', (data: { sector: number; players: PlayerRecord[] } | null) => {
        if (!data) return;
        const players = Array.isArray(data.players) ? data.players : [];
        sectorHandlers.forEach((h) => h(data.sector, players));
    });
    socket.on('presence:gone', (data: { names?: string[] } | null) => {
        if (!data?.names?.length) return;
        goneHandlers.forEach((h) => h(data.names!));
    });
    socket.on('presence:kick', (data: { reason?: string } | null) => {
        kickHandlers.forEach((h) => h(data?.reason ?? ''));
    });

    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => {
        if (socket?.connected && latestFrame) socket.emit('presence', latestFrame);
    }, PING_MS);
}

/** Push a fresh presence frame (call on sector change / state change). */
export function updatePresence(frame: PresenceFrame): void {
    latestFrame = frame;
    if (socket?.connected) socket.emit('presence', frame);
}

/** Ask the server for a sector's current roster (e.g. right after reconnect). */
export function requestSector(sector: number): void {
    if (socket?.connected) socket.emit('presence:request', { sector });
}

/** Tear down the connection (call on logout). */
export function disconnectRealtime(): void {
    if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
    }
    if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
        socket = null;
    }
    latestFrame = null;
    statusHandlers.forEach((h) => h(false));
}

export function onSector(fn: SectorHandler): () => void {
    sectorHandlers.add(fn);
    return () => { sectorHandlers.delete(fn); };
}
export function onGone(fn: GoneHandler): () => void {
    goneHandlers.add(fn);
    return () => { goneHandlers.delete(fn); };
}
export function onKick(fn: KickHandler): () => void {
    kickHandlers.add(fn);
    return () => { kickHandlers.delete(fn); };
}
export function onStatus(fn: StatusHandler): () => void {
    statusHandlers.add(fn);
    return () => { statusHandlers.delete(fn); };
}
