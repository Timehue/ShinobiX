/**
 * Watchdog for the capability-gated boot restore.
 *
 * The boot restore effect in App.tsx cannot even START until
 * /api/player/capabilities answers "available", and its own 12s backstop only
 * arms once it starts. If that endpoint is unreachable (dead origin behind a
 * cached SPA, captive portal, hard outage), availability sits at "unknown"
 * forever and a returning player stares at "Restoring…" with no timer
 * running at all.
 *
 * An interval (not a one-shot) also covers the rarer mid-restore orphan: a
 * capability lease expiring DURING a restore re-runs the boot effect, retires
 * the in-flight generation, and resets the started ref — restranding the gate
 * after a one-shot would already have fired.
 *
 * Every tick: if no restore is running, the caller's fallThrough drops the
 * gate to the pre-filled login form. If capabilities recover later, the boot
 * effect still runs and a successful late restore simply enters the game
 * (generation-safe).
 */
export const BOOT_GATE_WATCHDOG_INTERVAL_MS = 20_000;

export function startBootGateWatchdog(options: {
    /** The boot effect's bootRestoreStartedRef — true while a restore owns the gate. */
    restoreStarted: { current: boolean };
    /** Drop the restoring gate and surface the pre-filled login form. */
    fallThrough: () => void;
    intervalMs?: number;
}): () => void {
    const id = setInterval(() => {
        if (options.restoreStarted.current) return;
        options.fallThrough();
    }, options.intervalMs ?? BOOT_GATE_WATCHDOG_INTERVAL_MS);
    return () => clearInterval(id);
}
