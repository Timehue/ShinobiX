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

// Generate a unique id — crypto.randomUUID when available, else a
// timestamp+random fallback. Used for jutsu/item/bloodline/AI/event ids, etc.
export function makeId() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

// Canonical account slug for a display name. MUST stay byte-identical to the
// server's `safeName` (api/_utils.ts): lowercase, strip anything outside
// [a-z0-9_-], cap at 32 chars. The server keys every `save:` / `auth:` record
// and Realtime channel (e.g. `challenges:<slug>`) by this, so any client key
// that has to match a server row must run the name through here first. Returns
// '' for a name made entirely of stripped characters (caller must reject).
export function playerSlug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9\-_]/g, "").slice(0, 32);
}

export function sameSector(a?: number, b?: number) {
    return Math.floor(Number(a ?? 40)) === Math.floor(Number(b ?? 40));
}
