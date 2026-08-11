/**
 * Tiny realtime-notify shim (Phase 2 / Step 3).
 *
 * Lets request handlers (attack.ts, challenge.ts, …) push an instant "something
 * is waiting for you, poll now" KICK to a specific player WITHOUT importing the
 * socket.io server library into their bundle. socket.ts registers the actual
 * emitter at boot via setRealtimeEmitter(); until then (and on Vercel/cPanel
 * where the socket may never attach) every kick is a silent no-op.
 *
 * Design note — why a kick and not the payload itself:
 *   The HTTP heartbeat stays the SINGLE authoritative delivery+clear path for
 *   pendingAttacker / pendingChallenges (reliable, one-shot). The socket merely
 *   nudges the client to run an off-cycle heartbeat immediately, so delivery is
 *   instant without any double-delivery or lost-on-dropped-socket risk.
 */

import { safeName } from '../_utils.js';

type Emitter = (room: string, event: string, payload: unknown) => void;

export type TowerRealtimeKick =
    | { channel: 'reconcile'; reason: 'socket-connected' }
    | {
        channel: 'party';
        reason: 'created' | 'changed' | 'launched' | 'closed';
        partyId?: string;
        version?: number;
    }
    | {
        channel: 'session';
        reason: 'started' | 'action' | 'afk' | 'settled';
        runId: string;
        actionVersion?: number;
    };

let _emit: Emitter | null = null;

/** socket.ts calls this once at attach; pass null to detach (tests). */
export function setRealtimeEmitter(fn: Emitter | null): void {
    _emit = fn;
}

// Same safeName slug used for the socket's `user:<slug>` room join, so a kick
// reaches a player whose display name contains spaces / stripped chars.
function canon(name: string): string {
    return safeName(name);
}

/**
 * Nudge a player to run an immediate heartbeat (instant attack/challenge
 * delivery). No-op if no socket layer is attached or the player has no socket.
 */
export function kickPlayer(name: string | undefined | null, reason: 'attack' | 'challenge' | 'heal'): void {
    if (!_emit || !name) return;
    try {
        _emit(`user:${canon(name)}`, 'presence:kick', { reason });
    } catch {
        /* best-effort — never let a push failure break the request path */
    }
}

/**
 * Push a non-sensitive Tower revision hint to authenticated player rooms.
 *
 * The durable HTTP party/state endpoints remain authoritative. The socket event
 * deliberately contains no roster, invite code, combat snapshot, or save data;
 * clients reconcile the hinted channel with their normal authenticated fetch.
 * This also makes a dropped socket event harmless because bounded HTTP fallback
 * polling can recover the same revision later.
 */
export function kickTowerPlayers(
    names: Iterable<string | undefined | null>,
    payload: TowerRealtimeKick,
): void {
    if (!_emit) return;
    const rooms = new Set<string>();
    for (const name of names) {
        if (!name) continue;
        const slug = canon(name);
        if (slug) rooms.add(`user:${slug}`);
    }
    for (const room of rooms) {
        try {
            _emit(room, 'tower:kick', payload);
        } catch {
            /* best-effort — HTTP reconciliation remains authoritative */
        }
    }
}
