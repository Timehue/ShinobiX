/**
 * One automatic page reload for a lazy chunk that failed to load.
 *
 * A chunk-load error almost always means a stale deploy: this tab's index.html
 * points at hashed chunk URLs the new build no longer serves (server.ts 404s
 * them), and one reload pulls the fresh build. Both error boundaries call
 * reloadOnceForChunkLoadError; when it declines, they show their "A new version
 * is available" card instead.
 *
 * The guard is the time of the last automatic reload, kept in sessionStorage so
 * it survives the reload itself. A tab reloads automatically at most once per
 * CHUNK_RELOAD_WINDOW_MS. It used to be a plain flag that the root boundary
 * cleared on every clean mount, but that mount comes a moment after boot, well
 * before any lazy screen's chunk has loaded. So a chunk that fails every time
 * (a missing asset) reloaded the page forever, once every ~4–10 s. Clearing the
 * flag when a later chunk loads would not work either: other chunks finish
 * loading at boot while the broken one is still retrying, and WebKit's error
 * text names no URL that would tell them apart.
 */
const RELOAD_FLAG = "__sj_chunk_reloaded";

/**
 * Longer than one worst-case reload cycle: a chunk that hangs instead of
 * failing takes ~52 s (four 12 s timeouts plus 3.6 s of backoff in
 * retryDynamicImport). Far shorter than the gap between two real deploys,
 * each of which waits on CI.
 */
export const CHUNK_RELOAD_WINDOW_MS = 5 * 60_000;

export function isChunkLoadError(err: unknown): boolean {
    const maybeError = err as { name?: unknown; message?: unknown } | null;
    const msg = `${String(maybeError?.name ?? "")} ${String(maybeError?.message ?? "")}`;
    return /ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
        msg,
    );
}

export function clearChunkReloadFlag(): void {
    try {
        sessionStorage.removeItem(RELOAD_FLAG);
    } catch {
        /* sessionStorage unavailable (private mode / blocked) */
    }
}

/**
 * The root boundary's manual Reload button. Clearing the guard means a tap
 * re-arms one automatic reload. Only a tap can do that, so it cannot loop.
 */
export function reloadClearingChunkFlag(): void {
    clearChunkReloadFlag();
    window.location.reload();
}

export function reloadOnceForChunkLoadError(err: unknown, now: number = Date.now()): boolean {
    if (!isChunkLoadError(err)) return false;
    try {
        if (!reloadedWithinWindow(sessionStorage.getItem(RELOAD_FLAG), now)) {
            // Stamp before reloading: a reload without a stored guard could loop.
            sessionStorage.setItem(RELOAD_FLAG, String(now));
            window.location.reload();
            return true;
        }
    } catch {
        /* fall through to the manual reload card */
    }
    return false;
}

function reloadedWithinWindow(stamp: string | null, now: number): boolean {
    // No stamp reads as 0, and the legacy "1" as 1 ms past the epoch, so both
    // count as long expired. A stamp later than `now` means the clock moved
    // back. That counts as expired too, and the reload re-stamps with the
    // current time, so the next failure is inside the window.
    const at = Number(stamp);
    return Number.isFinite(at) && at > 0 && at <= now && now - at < CHUNK_RELOAD_WINDOW_MS;
}
