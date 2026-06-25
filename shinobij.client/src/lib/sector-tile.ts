/*
 * playerNameTile — deterministic within-sector tile (0..143) derived from a name.
 *
 * Used as the FALLBACK position for a peer who hasn't transmitted a real tile yet
 * (older client, or a "sleeping"/offline target that has no live position), and by
 * the legacy in-tile dot rendering. Lives in its own (component-free) module so
 * both WorldMap and the SectorPeers overlay can import it without tripping
 * react-refresh's "components-only export" rule.
 */
export function playerNameTile(name: string): number {
    let h = 5381;
    for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0;
    // keep away from corners — map to 10–133 range
    return 10 + (h % 124);
}
