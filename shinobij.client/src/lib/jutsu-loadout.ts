/**
 * Jutsu loadout resolution — drained verbatim out of App.tsx.
 *
 * getAllJutsus merges everything a character can field (starter kit, starter and
 * equipped bloodline kits, admin/creator jutsu, minus tombstoned deletes) into
 * one id-keyed set; getPvpJutsuLoadout then orders that set by the character's
 * equipped ids. Both are pure.
 *
 * This was the LAST App-local value that lib/ reached back for:
 * lib/duel-challenge.ts did `import { getPvpJutsuLoadout } from "../App"`, which
 * dragged App's .webp and component CSS into every consumer and made them
 * unloadable under node:test. With this moved, lib/ no longer imports App at all.
 *
 * Behaviour is unchanged — the bodies are byte-identical to the block that lived
 * in App.tsx, apart from the `export` keyword added to the two helpers that App
 * kept private. App re-exports getAllJutsus/getPvpJutsuLoadout for the screens
 * that still take them from "../App".
 */
import type { Character } from "../types/character";
import type { Jutsu, SavedBloodline } from "../types/combat";
import type { Rank } from "../types/core";
import { isDeletedJutsuEntry } from "../../../shared/admin-content-tombstone";
import { builtInJutsuIds, starterJutsus, starterSavedBloodlines } from "../data/jutsu";
import { mergeDisplayJutsu, normalizeJutsu, orderEquippedJutsus } from "./jutsu";
import { isAdminAccountName } from "./admin-identity";

export function allStarterBloodlineJutsus() {
    return starterSavedBloodlines.flatMap((bloodline) => bloodline.jutsus.map((jutsu) => ({ jutsu, rank: bloodline.rank })));
}

export function starterBloodlineJutsuRank(jutsuId: string): Rank | undefined {
    return allStarterBloodlineJutsus().find(({ jutsu }) => jutsu.id === jutsuId)?.rank;
}

export function getAllJutsus(savedBloodlines: SavedBloodline[], creatorJutsus: Jutsu[], character?: Character | null) {
    // Tombstones ride in creatorJutsus so a delete survives publish; not jutsu.
    creatorJutsus = creatorJutsus.filter((j) => !isDeletedJutsuEntry(j));
    const starterBloodlineName = character?.bloodline === "Blue Blade Eyes" ? "Ashen Eyes" : character?.bloodline;
    const starterBloodline = starterSavedBloodlines.find((b) => b.name === starterBloodlineName);
    const equippedBloodline = savedBloodlines.find((b) => b.id === character?.equippedBloodlineId);
    const merged = new Map<string, Jutsu>();
    const markRank = (jutsus: Jutsu[], rank: Rank) => jutsus.map(j => ({ ...j, bloodlineRank: rank }));
    const includeAllStarterBloodlines = !character || isAdminAccountName(character.name);
    [
        ...starterJutsus,
        ...(includeAllStarterBloodlines ? allStarterBloodlineJutsus().map(({ jutsu, rank }) => ({ ...jutsu, bloodlineRank: rank })) : []),
        ...markRank(starterBloodline?.jutsus ?? [], starterBloodline?.rank ?? "B Rank"),
        ...markRank(equippedBloodline?.jutsus ?? [], equippedBloodline?.rank ?? "B Rank"),
        ...creatorJutsus.map((jutsu) => {
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
