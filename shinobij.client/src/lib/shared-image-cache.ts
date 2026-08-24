/*
 * Shared-image category plumbing: the tab-local cache keys, the per-image URL
 * rollout set, and the bounded retry for a failed category load. Drained out of
 * App.tsx (which is at its line-budget ceiling) as a verbatim move — the values
 * and behaviour are unchanged.
 */

/** Images change rarely; a 10-minute tab-local cache kills most repeat KV reads. */
export const IMG_CACHE_TTL = 10 * 60 * 1000;

export function imgCacheKey(cat: string): string { return `imgcat:${cat}`; }

export function clearImgCache(): void {
    try {
        ['item', 'pet', 'card', 'jutsu', 'event', 'avatar', 'ai', 'bloodline', 'misc'].forEach(c =>
            sessionStorage.removeItem(imgCacheKey(c)));
    } catch { /* private browsing — ignore */ }
}

/*
 * Phase 2 (image-as-files): categories served via per-image `/api/img` URLs
 * instead of one giant base64 bucket. For these, loadCategory fetches only the
 * lightweight id MANIFEST (`?ids=1`) and hydrates sharedImages with `/api/img`
 * URLs — the browser then fetches each image individually (CDN/browser-cached)
 * only when a screen shows it, and the multi-MB base64 blob is NEVER pulled.
 * Roll out one category at a time, verifying each in-browser. To REVERT a
 * category, remove it from this set (it falls back to the base64 path).
 * ALL loadCategory buckets serve via per-image /api/img URLs (image-as-files
 * complete). Combat avatar/ai opponent portraits render via the widened
 * guards; everything else via plain <img>/background. avatar/pet/bloodline
 * also overwrite player-owned saved fields (character.avatarImage /
 * character.pets[].image / savedBloodlines[].image) with the URL — that's
 * fine: the URL is stable + tiny, renders directly, re-hydrates on load, and
 * publishSharedImage skips re-publishing it (see lib/shared-images.ts). We
 * deliberately do NOT strip "/api/img" from the localStorage preview, so the
 * own avatar instant-paints instead of flickering. ('leader' village
 * portraits ride the separate game-state?images=1 poll, not loadCategory.)
 * Revert any single category by removing it here.
 */
export const URL_MODE_CATEGORIES = new Set<string>(['event', 'card', 'item', 'jutsu', 'ai', 'shrine', 'landmark', 'avatar', 'pet', 'bloodline']);

/*
 * Bounded background retry for a failed shared-image category load.
 *
 * loadCategory's failure path used to re-arm itself unconditionally every ~10s.
 * A category that is merely COLD (Supabase spin-up) recovers on the first or
 * second round, but one that is genuinely broken — a 500, a bad shape, a revoked
 * bucket — re-fetched forever for the whole session, once per category.
 *
 * The retry itself is still worth keeping: leaving the category unmarked means a
 * later screen visit re-requests it on demand, which is the real recovery path.
 * This only bounds the unattended background loop, and backs it off linearly so
 * the tail rounds are cheap.
 */

/** Background rounds attempted before the loop gives up and waits for a screen visit. */
export const IMAGE_RETRY_MAX_ROUNDS = 4;
const IMAGE_RETRY_BASE_MS = 10_000;

/**
 * Schedule the next unattended retry for `category`, or do nothing once the budget
 * is spent. `rounds` is the caller's per-session tally; clear a category's entry on
 * success so a later transient failure gets a fresh budget.
 */
export function scheduleImageCategoryRetry(
    rounds: Map<string, number>,
    category: string,
    alreadyLoaded: () => boolean,
    retry: () => void,
): void {
    const round = (rounds.get(category) ?? 0) + 1;
    rounds.set(category, round);
    if (round > IMAGE_RETRY_MAX_ROUNDS) return;
    window.setTimeout(() => { if (!alreadyLoaded()) retry(); }, IMAGE_RETRY_BASE_MS * round);
}
