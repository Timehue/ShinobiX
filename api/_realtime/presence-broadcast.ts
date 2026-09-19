/**
 * Batched sector presence broadcasts.
 *
 * A state change used to be pushed to every sector-mate the moment it landed,
 * one Socket.IO frame per change per recipient. With N players in one sector
 * (every new character enters sector 40) that is O(N²) socket writes, and the
 * 2026-09-18 capacity probe found it to be the largest server CPU cost in a
 * crowd. Changes are now collected per sector and flushed every
 * PRESENCE_BATCH_MS as ONE `presence:updates` frame per recipient.
 *
 * Only names are queued. The flush reads each player's CURRENT record, so a
 * burst of changes collapses into the latest state, and a player who left the
 * sector (or went offline) before the flush is skipped instead of being
 * re-added to the old sector's roster as a ghost.
 *
 * Clients declare `presenceBatch: 1` in the socket handshake. Tabs still
 * running an older bundle don't understand `presence:updates`, so they get the
 * old per-player `presence:update` frames instead — only while any are
 * connected. Membership rides two global rooms, so a sector broadcast can
 * exclude the other kind of client.
 *
 * Arrivals ride the same batch: clients apply a join and an update identically
 * (an upsert), and a deploy reconnects every player at once. Leaves, tile moves
 * and the joiner's own snapshot stay immediate.
 * Single-instance only, like the rest of api/_realtime.
 */
import type { Server as IOServer, Socket } from 'socket.io';
import { safeName } from '../_utils.js';
import { onlineStore } from './online-store.js';
import { toPlayerRecord } from './presence-input.js';

export const PRESENCE_BATCH_MS = 500;
export const PRESENCE_BATCHED_ROOM = 'presence:batched';
export const PRESENCE_LEGACY_ROOM = 'presence:legacy';

type BroadcastTarget = Pick<IOServer, 'to'>;

let io: BroadcastTarget | null = null;
let legacyClients = 0;
const pending = new Map<number, Set<string>>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function sectorRoom(sector: number): string {
    return `sector:${sector}`;
}

export function setPresenceBroadcastIo(next: BroadcastTarget | null): void {
    io = next;
    if (!next) {
        pending.clear();
        legacyClients = 0;
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = null;
    }
}

/** Put a connected socket in the batched or legacy delivery room. */
export function registerPresenceClient(socket: Pick<Socket, 'join' | 'on'>, batched: boolean): void {
    socket.join(batched ? PRESENCE_BATCHED_ROOM : PRESENCE_LEGACY_ROOM);
    if (batched) return;
    legacyClients += 1;
    socket.on('disconnect', () => { legacyClients = Math.max(0, legacyClients - 1); });
}

/** A sector-mate-visible field changed; peers learn about it on the next flush. */
export function queuePresenceUpdate(name: string, sector: number): void {
    const key = safeName(name);
    if (!io || !key || sector < 0) return;
    let names = pending.get(sector);
    if (!names) {
        names = new Set();
        pending.set(sector, names);
    }
    names.add(key);
    if (!flushTimer) {
        flushTimer = setTimeout(flushFromTimer, PRESENCE_BATCH_MS);
        flushTimer.unref?.();
    }
}

// A throw inside a timer callback is an uncaught exception, which would take
// the whole single-instance server down over one bad presence frame.
function flushFromTimer(): void {
    try {
        flushPresenceUpdates();
    } catch (error) {
        console.error('[presence] batch flush failed:', (error as Error)?.message ?? error);
    }
}

/**
 * A player left `sector` through a path other than their socket (the HTTP
 * heartbeat). Immediate, like the socket path's own leave; a duplicate is a
 * no-op on clients.
 */
export function announcePresenceLeave(name: string, sector: number): void {
    const key = safeName(name);
    if (!io || !key || sector < 0) return;
    io.to(sectorRoom(sector)).emit('presence:leave', { sector, names: [key] });
}

export function flushPresenceUpdates(): void {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    const target = io;
    const batch = [...pending];
    pending.clear();
    if (!target) return;
    for (const [sector, names] of batch) {
        const players = [];
        for (const name of names) {
            const current = onlineStore.get(name);
            if (current && current.sector === sector) players.push(toPlayerRecord(current));
        }
        if (!players.length) continue;
        const room = sectorRoom(sector);
        target.to(room).except(PRESENCE_LEGACY_ROOM).emit('presence:updates', { sector, players });
        if (legacyClients > 0) {
            for (const player of players) {
                target.to(room).except(PRESENCE_BATCHED_ROOM).emit('presence:update', { sector, player });
            }
        }
    }
}

/** Test-only: pending sector → names, and the live legacy-client count. */
export function __presenceBroadcastStateForTest(): { pending: Map<number, Set<string>>; legacyClients: number } {
    return { pending, legacyClients };
}
