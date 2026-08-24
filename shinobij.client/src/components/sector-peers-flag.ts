/*
 * sector-peers-flag — the live walking-peer overlay (2D).
 *
 * When ON, other players in your sector render as grounded markers that GLIDE to
 * their real transmitted tile (with enter/exit fades) instead of static dots
 * pinned to a deterministic per-name tile. Lives in its own (component-free)
 * module so <SectorPeers> and <WorldMap> can both read it without tripping
 * react-refresh's "components-only export" rule.
 *
 * ALWAYS ON. This is a gameplay layer (it is how you see who is actually in the
 * sector with you), so it is not a per-device choice: the old localStorage
 * `sectorPeers.v1 = "off"` kill switch let one browser see a different world from
 * everyone else's. The function is kept so call sites compile unchanged; it is a
 * constant, never a storage read. Do not reintroduce a localStorage opt-out here.
 */
export function isSectorLivePeersEnabled(): boolean {
    return true;
}
