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
 * Non-consuming read, for deciding WHERE in the sector to put the player.
 *
 * WorldMap's `sectorPlayerPos` is a useState initializer, which runs during the
 * first render — before the mount effect that calls takeSectorReopen(). So the
 * tile decision cannot use the read-and-clear without stealing the latch from
 * the effect that reopens the sector. Peek there, take here.
 */
export function peekSectorReopen(): number | null {
    return pendingSectorReopen;
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
function navigationWasReload(): boolean {
    try {
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
        return !!nav && (nav.type === "reload" || nav.type === "back_forward");
    } catch {
        return false;
    }
}
export function consumeReloadIntoSector(): boolean {
    if (reloadReopenConsumed) return false;
    reloadReopenConsumed = true;
    return navigationWasReload();
}

/*
 * Non-consuming read of the same signal, for deciding WHERE in the sector to
 * put the player on that first mount — WorldMap's `sectorPlayerPos` initializer
 * runs before the mount effect that consumes the reload. The board position is
 * then the tile the server persisted for the last settled arrival
 * (`currentTile`, hydrated into presence-store at boot) rather than the grid
 * centre. True only until the reload has been consumed.
 */
export function peekReloadIntoSector(): boolean {
    return !reloadReopenConsumed && navigationWasReload();
}
