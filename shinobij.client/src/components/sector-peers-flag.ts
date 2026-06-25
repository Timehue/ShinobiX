/*
 * sector-peers-flag — per-device opt-out for the live walking-peer overlay (2D).
 *
 * When ON, other players in your sector render as grounded markers that GLIDE to
 * their real transmitted tile (with enter/exit fades) instead of static dots
 * pinned to a deterministic per-name tile. Lives in its own (component-free)
 * module so <SectorPeers> and <WorldMap> can both read it without tripping
 * react-refresh's "components-only export" rule.
 *
 * Default ON. Opt-out with localStorage `sectorPeers.v1 = "off"` to fall back to
 * the original in-tile dot rendering (full revert, no code change needed).
 */
export function isSectorLivePeersEnabled(): boolean {
    if (typeof window === "undefined") return false;
    try { return window.localStorage?.getItem("sectorPeers.v1") !== "off"; } catch { return true; }
}
