/**
 * The 1-second server tick (Phase 2 / Phase 3).
 *
 * Runs inside the always-on Railway process. For now it sweeps players who
 * stopped pinging (so the in-memory roster doesn't accrue stale entries) and
 * notifies an optional sweep listener (the Socket.IO layer uses it to push a
 * `presence:gone` to clients the instant a player times out). Later steps hang
 * battle-room / sector-room / pet-room timers off the same tick.
 *
 * It is NOT a per-player DB write loop — it touches process memory only.
 */
import { onlineStore } from './online-store.js';

let _timer: ReturnType<typeof setInterval> | null = null;
let _onSweep: ((removedNames: string[]) => void) | null = null;

/**
 * Register a callback invoked with the canonical names dropped by each sweep
 * (only when at least one was dropped). Used by the socket layer to broadcast
 * departures. Pass null to clear. Set BEFORE startGameLoop so the first ticks
 * are covered, though it may be set at any time.
 */
export function setOnSweep(cb: ((removedNames: string[]) => void) | null): void {
    _onSweep = cb;
}

/** Start the 1s tick. Idempotent — safe to call once at server boot. */
export function startGameLoop(): void {
    if (_timer) return;
    _timer = setInterval(() => {
        try {
            // Drop players who haven't pinged within the offline window.
            const removed = onlineStore.sweepStale();
            if (removed.length && _onSweep) {
                try {
                    _onSweep(removed);
                } catch (err) {
                    console.error('[game-loop] onSweep listener error:', (err as Error).message);
                }
            }
            // (battle-room / sector-room / pet-room ticks land here in later steps)
        } catch (err) {
            console.error('[game-loop] tick error:', (err as Error).message);
        }
    }, 1000);
    // Don't keep the process alive solely for the loop (clean shutdown).
    _timer.unref?.();
    console.log('[game-loop] 1s server tick started');
}

/** Stop the tick (tests / graceful shutdown). */
export function stopGameLoop(): void {
    if (_timer) {
        clearInterval(_timer);
        _timer = null;
    }
}
