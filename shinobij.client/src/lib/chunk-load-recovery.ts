const RELOAD_FLAG = "__sj_chunk_reloaded";

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

export function reloadClearingChunkFlag(): void {
    clearChunkReloadFlag();
    window.location.reload();
}

export function reloadOnceForChunkLoadError(err: unknown): boolean {
    if (!isChunkLoadError(err)) return false;
    try {
        if (!sessionStorage.getItem(RELOAD_FLAG)) {
            sessionStorage.setItem(RELOAD_FLAG, "1");
            window.location.reload();
            return true;
        }
    } catch {
        /* fall through to the manual reload card */
    }
    return false;
}
