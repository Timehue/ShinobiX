/**
 * Jutsu loadout resolution — drained verbatim out of App.tsx.
 *
 * getAllJutsus merges everything a character can field (starter kit, the active
 * bloodline kit, admin/creator jutsu, minus tombstoned deletes) into
 * one id-keyed set; getPvpJutsuLoadout then orders that set by the character's
 * equipped ids. Both are pure.
 *
 * This was the LAST App-local value that lib/ reached back for:
 * lib/duel-challenge.ts did `import { getPvpJutsuLoadout } from "../App"`, which
 * dragged App's .webp and component CSS into every consumer and made them
 * unloadable under node:test. With this moved, lib/ no longer imports App at all.
 *
 * App re-exports getAllJutsus/getPvpJutsuLoadout for screens that still take
 * them from "../App".
 */
import type { Character } from "../types/character";
import type { Jutsu, SavedBloodline } from "../types/combat";
import type { Rank } from "../types/core";
import { isDeletedJutsuEntry } from "../../../shared/admin-content-tombstone";
import { builtInJutsuIds, starterJutsus, starterSavedBloodlines } from "../data/jutsu";
import { mergeDisplayJutsu, normalizeJutsu, orderEquippedJutsus } from "./jutsu";
import { getCharacterBloodlines, isUncarriedBloodlineJutsu } from "./bloodline";

export function allStarterBloodlineJutsus() {
    return starterSavedBloodlines.flatMap((bloodline) => bloodline.jutsus.map((jutsu) => ({ jutsu, rank: bloodline.rank })));
}

export function starterBloodlineJutsuRank(jutsuId: string): Rank | undefined {
    return allStarterBloodlineJutsus().find(({ jutsu }) => jutsu.id === jutsuId)?.rank;
}

export function getAllJutsus(savedBloodlines: SavedBloodline[], creatorJutsus: Jutsu[], character?: Character | null) {
    // Tombstones ride in creatorJutsus so a delete survives publish; not jutsu.
    creatorJutsus = creatorJutsus.filter((j) => !isDeletedJutsuEntry(j));
    const activeBloodline = character ? getCharacterBloodlines(character, savedBloodlines)[0] : undefined;
    const merged = new Map<string, Jutsu>();
    const markRank = (jutsus: Jutsu[], rank: Rank) => jutsus.map(j => ({
        ...j,
        // Older creator saves already persisted the shortened three-ring field.
        // Project its restored reach in the loadout before the next save seals it.
        range: j.method === "INSTANT_EFFECT" && j.groundRangeVersion === 2 ? Math.max(4, j.range) : j.range,
        bloodlineRank: rank,
    }));
    const includeAllStarterBloodlines = !character;
    [
        ...starterJutsus,
        ...(includeAllStarterBloodlines ? allStarterBloodlineJutsus().map(({ jutsu, rank }) => ({ ...jutsu, bloodlineRank: rank })) : []),
        ...markRank(activeBloodline?.jutsus ?? [], activeBloodline?.rank ?? "B Rank"),
        ...creatorJutsus.filter((jutsu) => !character || !isUncarriedBloodlineJutsu(character, jutsu, savedBloodlines)).map((jutsu) => {
            const starterBloodlineRank = starterBloodlineJutsuRank(jutsu.id);
            // Do NOT rebalance here — admin-saved values must be preserved as-is.
            return starterBloodlineRank ? { ...normalizeJutsu(jutsu), bloodlineRank: starterBloodlineRank } : normalizeJutsu(jutsu);
        }),
    ].map(normalizeJutsu).forEach((jutsu) => mergeDisplayJutsu(merged, jutsu, builtInJutsuIds));
    return [...merged.values()];
}

export function getPvpJutsuLoadout(savedBloodlines: SavedBloodline[], creatorJutsus: Jutsu[], character: Character) {
    return orderEquippedJutsus(getAllJutsus(savedBloodlines, creatorJutsus, character), character.equippedJutsuIds);
}

// An equipped ID is only a *preference*: it survives in the save as long as a
// mastery row backs it (see the learned-ID filter in api/save/[name].ts), even
// after the jutsu itself is gone. Admin-deleted custom jutsu therefore leave a
// dead ID sitting in equippedJutsuIds forever. Combat already resolves through
// orderEquippedJutsus and silently drops such an ID, so the dead slot costs the
// player a real battle action — and while the loadout UI still COUNTED it, the
// cap was reached at 14 usable jutsu and the 15th could never be equipped.
// Resolve loadout slots through here so the UI counts exactly what combat will
// hand the player.
export function liveEquippedJutsuIds(catalog: readonly Jutsu[], equippedIds: readonly string[]): string[] {
    return orderEquippedJutsus(catalog, equippedIds).map((jutsu) => jutsu.id);
}
