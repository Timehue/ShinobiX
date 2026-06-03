"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.setRealtimeEmitter = setRealtimeEmitter;
exports.kickPlayer = kickPlayer;
let _emit = null;
/** socket.ts calls this once at attach; pass null to detach (tests). */
function setRealtimeEmitter(fn) {
    _emit = fn;
}
function canon(name) {
    return name.trim().toLowerCase();
}
/**
 * Nudge a player to run an immediate heartbeat (instant attack/challenge
 * delivery). No-op if no socket layer is attached or the player has no socket.
 */
function kickPlayer(name, reason) {
    if (!_emit || !name)
        return;
    try {
        _emit(`user:${canon(name)}`, 'presence:kick', { reason });
    }
    catch {
        /* best-effort — never let a push failure break the request path */
    }
}
