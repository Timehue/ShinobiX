/**
 * The 1-second server tick (Phase 2 / Phase 3).
 *
 * Runs inside the always-on Railway process. For now it just sweeps players who
 * stopped pinging (so the in-memory roster doesn't accrue stale entries). Later
 * steps hang battle-room / sector-room / pet-room timers off the same tick.
 *
 * It is NOT a per-player DB write loop — it touches process memory only.
 */
import { onlineStore } from './online-store.js';

let _timer: ReturnType<typeof setInterval> | null = null;

/** Start the 1s tick. Idempotent — safe to call once at server boot. */
export function startGameLoop(): void {
    if (_timer) return;
    _timer = setInterval(() => {
        try {
            // Drop players who haven't pinged within the offline window.
            onlineStore.sweepStale();
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
