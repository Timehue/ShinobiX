/*
 * sector-map-flag — per-device opt-out for the painted <SectorMap> board.
 *
 * Lives in its own (component-free) module so <SectorMap> and <WorldMap> can both
 * read the flag without tripping react-refresh's "components-only export" rule.
 * Default ON for everyone; opt-out with localStorage `sectorMap.v1 = "off"` (the
 * map falls back to the old SectorScene vista). Behaviour is identical to the
 * previous in-component definition — this is a verbatim move.
 */
export function isSectorMapEnabled(): boolean {
    if (typeof window === "undefined") return false;
    try { return window.localStorage?.getItem("sectorMap.v1") !== "off"; } catch { return true; }
}
