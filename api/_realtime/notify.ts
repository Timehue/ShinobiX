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
