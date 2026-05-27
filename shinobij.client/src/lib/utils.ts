/*
 * Generic utility helpers — small, pure, dependency-free functions used
 * throughout the codebase. Number clamping, time formatting, UTC date
 * keys for daily/monthly reset tracking.
 *
 * Extracted from App.tsx so consumers can import them without dragging
 * the whole App import surface.
 */

// Clamp a number into the closed interval [min, max].
export function clampNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

// Format a positive millisecond duration as a short human label
// ("1h 23m", "5m 12s", "47s"). Returns "Done" for non-positive values.
// Used by all the in-flight timer UIs (pet training / expedition,
// stat training, jutsu training).
export function formatPetTimer(ms: number): string {
    if (ms <= 0) return "Done";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

// ── UTC date keys ────────────────────────────────────────────────────────
// Used for daily / monthly counter resets. ISO-string slicing gives us a
// stable lexicographic key without any timezone-dependent surprises.

export function currentMonthKey(): string {
    return new Date().toISOString().slice(0, 7);
}

export function currentDateKey(): string {
    return new Date().toISOString().slice(0, 10);
}
