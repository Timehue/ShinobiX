/** Stable interior spawn used by field characters and contract markers. */
export function interiorTileFromKey(key: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < key.length; i += 1) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    const col = 2 + ((h >>> 0) % 8);
    const row = 2 + (((h >>> 5) >>> 0) % 8);
    return row * 12 + col;
}
