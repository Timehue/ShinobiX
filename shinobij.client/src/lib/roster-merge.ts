import type { Character, PlayerRecord } from "../types/character";

/**
 * Merge server-reported active players into the local cross-device roster.
 *
 * Name-keyed (O(n)): existing entries update in place, new ones append, and the
 * prev-priority order is preserved on the 100-cap — matching the old findIndex +
 * slice(0, 100) behavior, minus its O(n²) scan. Each incoming character is run
 * through `normalize` so downstream social screens get a fully-shaped Character.
 *
 * The incoming records come from the heartbeat, which ships only a MINIMAL
 * character ({ avatarImage: '' } — see api/_realtime/presence-input.toPlayerRecord)
 * to keep the once-per-second frame small. The rich profile fields (nindo,
 * nindoBg, pets, customTitle, ranked/PvP metrics, …) only ride the slower
 * /api/player/roster snapshot. So we LAYER the incoming character on top of the
 * one already cached rather than replacing it: a heartbeat refresh updates the
 * light/presence fields it actually carries without wiping the grafted profile
 * data. Replacing wholesale made an online player's Nindo (and the rest of their
 * profile) vanish from UserView ~12s after each 60s roster poll re-grafted it —
 * reported as "Nindos don't save".
 */
export function mergePlayerRoster(
    prev: PlayerRecord[],
    incoming: PlayerRecord[],
    normalize: (c: Character) => Character,
): PlayerRecord[] {
    const byName = new Map(prev.map((p) => [p.name, p] as const));
    for (const rec of incoming) {
        const existingChar = byName.get(rec.name)?.character as Character | undefined;
        const mergedChar = normalize({
            ...existingChar,
            ...(rec.character as Character),
        } as Character);
        byName.set(rec.name, { ...rec, character: mergedChar });
    }
    return Array.from(byName.values()).slice(0, 100);
}
