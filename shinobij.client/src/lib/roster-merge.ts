import type { Character, PlayerRecord } from "../types/character";

/**
 * Merge server-reported active players into the local cross-device roster.
 *
 * Name-keyed (O(n)): existing entries update in place, new ones append, and the
 * prev-priority order is preserved on the 100-cap — matching the old findIndex +
 * slice(0, 100) behavior, minus its O(n²) scan. Each incoming character is run
 * through `normalize` so downstream social screens get a fully-shaped Character.
 */
export function mergePlayerRoster(
    prev: PlayerRecord[],
    incoming: PlayerRecord[],
    normalize: (c: Character) => Character,
): PlayerRecord[] {
    const byName = new Map(prev.map((p) => [p.name, p] as const));
    for (const rec of incoming) {
        byName.set(rec.name, { ...rec, character: normalize(rec.character as Character) });
    }
    return Array.from(byName.values()).slice(0, 100);
}
