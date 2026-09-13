import { retryDynamicImport } from "./lazyWithRetry";

/**
 * Hollow Gate — on-demand loader for the procedural generator.
 *
 * ./hollow-gate-dungeon drags the hand-authored ASCII layouts, the BSP
 * generator and the maze generator with it (~16 KB minified). None of that is
 * needed until a run actually starts, and every call site that generates a
 * floor is already async (each one is preceded by a server round-trip), so the
 * import costs no extra wait in practice.
 *
 * Visibility (./hollow-gate-visibility) and pathing (./hollow-gate-path) are
 * deliberately NOT behind this loader: the walker calls them synchronously on
 * every committed step.
 *
 * BOTH loaders go through retryDynamicImport (./lazyWithRetry) rather than a
 * bare `import()`. A bare import inside an awaited run-critical path is the
 * worst possible place for a HUNG fetch: it never settles, so the awaiting
 * caller (the move-fx drain, the descend) never settles either and the run
 * silently stops responding for the life of the page. The wrapper's
 * per-attempt timeout turns that stall into a rejection the caller can handle.
 *
 * The wrapper does NOT re-download a chunk whose fetch FAILED (a dropped
 * request, or a 404 after a deploy rotated the asset hashes under an open tab).
 * The browser keeps that failure in the page's module map, and every later
 * import() of the URL rejects from it without a network request — measured in
 * Chromium, Firefox and WebKit (see ./lazyWithRetry). These loaders are awaited
 * outside React, so no error boundary sees the rejection and nothing reloads on
 * its own: every call site catches it and asks the player to try again. That
 * can work after a timeout, but after a failed fetch nothing short of
 * reloading the page can load the chunk.
 */
export function loadHollowGateGenerator() {
    return retryDynamicImport(() => import("./hollow-gate-dungeon"));
}

/**
 * The tile resolver (./hollow-gate-tile — rewards, hazards, staircases, death)
 * rides along on the same on-demand boundary. Its single call site in App runs
 * inside drainHollowGateMoveFx, which has already awaited the server's step
 * seal, so the module is fetched behind a network round-trip that already
 * happened rather than in front of the player.
 */
export function loadHollowGateTileRuntime() {
    return retryDynamicImport(() => import("./hollow-gate-tile"));
}

/**
 * Fire-and-forget warm-up. Called whenever the shrine screen is on-screen — a
 * fresh dive, an admin playtest, or any of the boot-restore paths back into a
 * live run — so both chunks are already in memory by the time a floor has to be
 * generated or a tile has to resolve.
 *
 * Swallowing the rejection here hides nothing from the awaited call. If the
 * warm-up only timed out, the awaited call makes its own attempt, which can
 * still succeed. If the fetch FAILED, the browser has cached that failure for
 * the page — per URL, not per promise, so no wrapper can keep it from the later
 * call — and the awaited call rejects with it and reports it.
 */
export function warmHollowGateGenerator(): void {
    const swallow = () => { /* the awaited call site reports the real failure */ };
    void loadHollowGateGenerator().catch(swallow);
    void loadHollowGateTileRuntime().catch(swallow);
}
