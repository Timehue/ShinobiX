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
