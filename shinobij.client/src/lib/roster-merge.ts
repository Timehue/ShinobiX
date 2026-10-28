import type { Character, PlayerRecord } from "../types/character";
import { playerSlug } from './utils';

/** Updating the viewer must never evict other players from sector discovery. */
export function mergeSelfRosterRow(current: PlayerRecord[], record: PlayerRecord): PlayerRecord[] {
    const self = playerSlug(record.name);
    return [record, ...current.filter(player => playerSlug(player.name) !== self)];
}

/** Full public snapshots replace profile fields while preserving roster order. */
export function mergeRosterSnapshot(prev: PlayerRecord[], incoming: PlayerRecord[]): PlayerRecord[] {
    const merged: PlayerRecord[] = [];
    const indices = new Map<string, number>();
    for (const record of [...prev, ...incoming]) {
        const key = playerSlug(record.name);
        const index = indices.get(key);
        if (index !== undefined) merged[index] = { ...merged[index], ...record };
        else { indices.set(key, merged.length); merged.push(record); }
    }
    return merged;
}

/**
 * Merge server-reported active players into the local cross-device roster.
 *
 * Name-keyed (O(n)): existing entries update in place, new ones append, and the
 * previous order is preserved without truncating sector targets. Each incoming character is run
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
    const byName = new Map(prev.map((p) => [playerSlug(p.name), p] as const));
    for (const rec of incoming) {
        const existingRecord = byName.get(playerSlug(rec.name));
        const existingChar = existingRecord?.character as Character | undefined;
        const mergedChar = normalize({
            ...existingChar,
            ...(rec.character as Character),
        } as Character);
        byName.set(playerSlug(rec.name), {
            ...existingRecord,
            ...rec,
            sleeping: rec.sleeping === true,
            character: mergedChar,
            eligiblePets: Array.isArray(rec.eligiblePets) ? rec.eligiblePets : existingRecord?.eligiblePets,
        });
    }
    return Array.from(byName.values());
}
