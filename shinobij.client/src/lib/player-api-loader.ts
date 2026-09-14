import { retryDynamicImport } from "./lazyWithRetry";

/**
 * Player-API — on-demand loader.
 *
 * ./player-api is the clan/village/treasury + duel-notice HTTP surface. App
 * used to import it eagerly for a SINGLE call (postPlayerChallengeNotice on the
 * two duel-acceptance paths), which pulled the whole module — and, through its
 * `abortableDelay` import, ./pvp-session-runtime — into the startup graph. That
 * is ~13.9 KB of rendered module bytes every player downloads before the start
 * screen, to serve a request that can only happen after someone accepts a duel.
 *
 * Every other importer (screens/ClanHall, screens/TownHall, components/
 * ClanExchange) is already behind a lazy route, so App was the only thing
 * holding it eager.
 *
 * Both App call sites already sit in async paths that have just awaited a
 * server round-trip, so the import costs no extra wait in practice.
 *
 * This goes through retryDynamicImport (./lazyWithRetry) rather than a bare
 * `import()` for its per-attempt timeout: a bare import that HANGS never
 * settles, so an awaiting caller never settles either. Neither form recovers a
 * chunk whose fetch FAILED (a dropped request, or a deploy that rotated the
 * asset hashes under an open tab): the browser caches that failure for the
 * page, and nothing short of a reload can fetch it again (see ./lazyWithRetry).
 */
export function loadPlayerApi() {
    return retryDynamicImport(() => import("./player-api"));
}

/**
 * Fire-and-forget warm-up, same shape as warmHollowGateGenerator in
 * ./hollow-gate-generator-loader.
 *
 * ONE call site awaits this module on a path that then routes the player:
 * acceptPetChallengeGlobal sends the duel notice and only afterwards navigates
 * to the arena. Left cold, accepting a pet duel would wait on a chunk fetch that
 * the pre-extraction code never had to make — a new network dependency on a PvP
 * flow, which is exactly the kind of regression a refactor has no business
 * introducing. Warming at the top of that handler overlaps the fetch with the
 * server round-trips already in flight, so the awaited call finds it resolved.
 *
 * Swallowing the rejection hides nothing from the awaited call. A warm-up that
 * only timed out leaves it free to make its own attempt, which can still
 * succeed; a failed fetch is cached for the page, per URL, so the awaited call
 * rejects with that same failure.
 */
export function warmPlayerApi(): void {
    void loadPlayerApi().catch(() => { /* the awaited call site reports the real failure */ });
}
