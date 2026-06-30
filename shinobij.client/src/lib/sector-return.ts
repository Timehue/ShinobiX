/*
 * One-shot "return to sector" latch, shared between the World Map and the rest
 * of the app.
 *
 * WorldMap's exploreSector() sets this to the explored sector right before it
 * drops the player into an ambush fight, so that WINNING returns the player to
 * the sector they were exploring (the World Map consumes it on its next mount).
 *
 * It must NOT survive a knockout. A KO routes the player to the hospital instead
 * of straight back to the map, so the latch would otherwise still be set the
 * next time they hit "Travel" — dumping them right back into the sector they
 * were just knocked out in. The Hospital screen clears it on entry to prevent
 * that. Module scope so it survives WorldMap's unmount/remount during a battle.
 */
let pendingSectorReopen: number | null = null;

export function setSectorReopen(sector: number | null) {
    pendingSectorReopen = sector;
}

// Read-and-clear: WorldMap calls this on mount to reopen the sector exactly once.
export function takeSectorReopen(): number | null {
    const sector = pendingSectorReopen;
    pendingSectorReopen = null;
    return sector;
}

export function clearSectorReopen() {
    pendingSectorReopen = null;
}

/*
 * One-shot "did the page reload straight into a sector" signal.
 *
 * The World Map's open-sector state (selectedSector) is ephemeral React state, so
 * a browser refresh otherwise drops the player back on the world overview even
 * though they were standing inside a sector. WorldMap calls this on mount: it
 * returns true exactly once per page load, and ONLY when that load was a real
 * browser reload (or a non-cached back/forward) rather than a fresh in-app
 * navigation. Consumed on the first call so a later in-session trip to the map
 * still opens on the overview. The caller additionally gates on currentSector
 * being a real explorable sector, so a hub refresh (currentSector reset to 0)
 * never reopens anything.
 */
let reloadReopenConsumed = false;
export function consumeReloadIntoSector(): boolean {
    if (reloadReopenConsumed) return false;
    reloadReopenConsumed = true;
    try {
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
        return !!nav && (nav.type === "reload" || nav.type === "back_forward");
    } catch {
        return false;
    }
}
