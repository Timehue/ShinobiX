/** An interior encounter area that changes with the sector, not just the NPC.
 *
 * The stride is coprime to the 64 interior tiles, so a recurring character
 * occupies a different tile in every consecutive sector for a full 64-sector
 * cycle. The position is stable within a sector for every render and reload.
 */
export function sectorWandererHomeTile(id: string, sector: number): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < id.length; i++) {
        hash ^= id.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    const index = (((hash + sector * 13) % 64) + 64) % 64;
    const col = 2 + index % 8;
    const row = 2 + Math.floor(index / 8);
    return row * 12 + col;
}
