/**
 * Short-lived, per-tab JSON cache for read-only screen data.
 *
 * This is intentionally sessionStorage rather than localStorage: a browser tab
 * can render its last confirmed view immediately, but the cache disappears
 * when that tab closes. Player-specific callers must include the canonical
 * player identity in their key. Callers must still refresh their API data and
 * must not use a cached value to authorize or settle an action.
 */

const PREFIX = 'shinobix:screen-cache:v1:';

type CacheEnvelope = { expiresAt: number; value: unknown };

function isEnvelope(value: unknown): value is CacheEnvelope {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<CacheEnvelope>;
    return Number.isFinite(candidate.expiresAt) && candidate.expiresAt! > Date.now() && 'value' in candidate;
}

export function readScreenCache<T>(key: string, isValid: (value: unknown) => value is T): T | null {
    try {
        const raw = sessionStorage.getItem(`${PREFIX}${key}`);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!isEnvelope(parsed) || !isValid(parsed.value)) return null;
        return parsed.value;
    } catch {
        return null;
    }
}

export function writeScreenCache<T>(key: string, value: T, ttlMs: number): void {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return;
    try {
        sessionStorage.setItem(`${PREFIX}${key}`, JSON.stringify({ value, expiresAt: Date.now() + ttlMs }));
    } catch {
        // Browser privacy mode/full storage must not block the live request.
    }
}
