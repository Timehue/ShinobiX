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
 * worst possible place for the two classic chunk failures: a HUNG fetch never
 * settles, so the awaiting caller (the move-fx drain, the descend) never
 * settles either and the run silently stops responding for the life of the
 * page; and a deploy that rotated the asset hashes under an open tab fails
 * every attempt with no recovery short of a reload. The wrapper retries with
 * backoff, treats a hung request as a failure via a per-attempt timeout, and —
 * because it re-issues import() itself instead of handing the SAME promise back
 * — never memoizes a rejection the way a caller-cached promise would.
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
 * Swallowing the rejection here is safe ONLY because of the retry wrapper
 * above: each loadX() call issues its own import(), so a warm-up that gave up
 * cannot hand its failure to the later awaited call. With a bare import() it
 * could: a rejected module record may persist in the ESM module map, and the
 * real call site would then re-throw the warm-up's error rather than make a
 * fresh attempt of its own.
 */
export function warmHollowGateGenerator(): void {
    const swallow = () => { /* the awaited call site reports the real failure */ };
    void loadHollowGateGenerator().catch(swallow);
    void loadHollowGateTileRuntime().catch(swallow);
}
