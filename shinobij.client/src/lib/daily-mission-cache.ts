/**
 * A tiny per-tab cache for the Daily Profession Missions panel.
 *
 * Mission state remains server-authoritative: this cache only renders the last
 * successful response while a fresh, authenticated request is in flight.  It
 * is deliberately scoped to one canonical player, one profession track, and
 * one UTC date, so it cannot leak between accounts or survive the daily reset.
 */

export type CachedDailyMissionResponse = {
    profession: string | null;
    track?: 'newbie';
    date?: string;
    missions: unknown[];
};

const CACHE_PREFIX = 'shinobix:daily-missions:v1';

export function utcDayKey(now = new Date()): string {
    return now.toISOString().slice(0, 10);
}

function cacheKey(playerName: string, profession: string | null, date: string): string {
    return `${CACHE_PREFIX}:${encodeURIComponent(playerName)}:${profession ?? 'newbie'}:${date}`;
}

function validResponse(value: unknown): value is CachedDailyMissionResponse {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<CachedDailyMissionResponse>;
    return Array.isArray(candidate.missions)
        && (typeof candidate.profession === 'string' || candidate.profession === null)
        && (candidate.track === undefined || candidate.track === 'newbie')
        && (candidate.date === undefined || typeof candidate.date === 'string');
}

export function readDailyMissionCache(
    playerName: string,
    profession: string | null,
    now = new Date(),
): CachedDailyMissionResponse | null {
    try {
        const raw = sessionStorage.getItem(cacheKey(playerName, profession, utcDayKey(now)));
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        return validResponse(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

export function writeDailyMissionCache(
    playerName: string,
    profession: string | null,
    response: CachedDailyMissionResponse,
    now = new Date(),
): void {
    // A malformed/old-date response must never be displayed after UTC reset.
    if (!validResponse(response) || response.date !== utcDayKey(now)) return;
    try {
        sessionStorage.setItem(cacheKey(playerName, profession, response.date), JSON.stringify(response));
    } catch {
        // Private browsing / full storage must not block the actual API path.
    }
}
