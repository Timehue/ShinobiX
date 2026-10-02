/*
 * Road beast identity — the ONE rule that decides what a natural beast
 * wanderer (verb "petDuel") is for a given player. Shared by the World Map,
 * which names and paints the beast, and api/pet/_wanderer-showdown.ts, which
 * fields it.
 *
 * The beast's map name and portrait used to be flavour: a name from a fixed
 * list and one fox picture for every beast, while the server drew the real
 * opposition at random when the fight began. So a "Stray Oni-Hound" fielded a
 * Desert Lizard. Now the beast locks onto one of the player's ready carried
 * pets (its RIVAL, who always leads the player's side), and its species is a
 * wild pet of that rival's rarity. Both picks are pure functions of ids, so the
 * map can show the exact species the server will field without a round trip.
 *
 * Balance is untouched. The server's sparring draw already matches slot 0 to
 * the player's slot-0 rarity; this only decides WHICH species of that rarity
 * stands there, and the server only accepts it from inside that same pool.
 *
 * Both picks are rendezvous hashes (highest score wins), so the answer does not
 * depend on list order and only moves when the winning pet or species itself
 * leaves the candidate set — a second pet going on an expedition does not
 * reshuffle the beast you were looking at.
 *
 * Keep this module dependency-free apart from the shared roster's hash, so the
 * server (Node16 resolution) and the client (Vite) can both import it.
 */
import { wandererHash32 } from "./wanderer-roster.js";

/** Natural beast names are "<Epithet> Beast" ("Stray Beast"). The suffix is
 *  replaced by the species once the player has a rival to send. */
export const WANDERER_BEAST_SUFFIX = " Beast";

/** A catalog template, as both sides hold it (server PET_CATALOG, client pool). */
export type WildSpeciesTemplate = {
    id?: unknown;
    name?: unknown;
    rarity?: unknown;
    wildSpawnable?: unknown;
    jutsus?: unknown;
};

function rendezvous<T>(key: string, items: readonly T[], idOf: (item: T) => string): T | null {
    let best: T | null = null;
    let bestScore = -1;
    let bestId = "";
    for (const item of items) {
        const id = idOf(item);
        if (!id) continue;
        const score = wandererHash32(`${key}|${id}`);
        if (score > bestScore || (score === bestScore && id < bestId)) {
            best = item;
            bestScore = score;
            bestId = id;
        }
    }
    return best;
}

/** The ready carried pet this beast challenges. It always leads the player's
 *  side of the fight. Null when the player has no ready pet. */
export function wandererBeastRival<T extends { id?: unknown }>(wandererId: string, readyPets: readonly T[]): T | null {
    return rendezvous(`beast-rival:${wandererId}`, readyPets, (pet) => String(pet?.id ?? ""));
}

/** The server's sparring candidate filter (api/_pet-showdown/ai.ts
 *  mirrorRarities), so the species is always one that slot could draw anyway. */
export function isWildSpeciesOfRarity(tpl: WildSpeciesTemplate, rarity: unknown): boolean {
    return tpl.rarity === (rarity ?? "standard") && tpl.wildSpawnable !== false && Array.isArray(tpl.jutsus);
}

/** The wild species this beast is when it faces a rival of `rarity`. Null when
 *  the catalog holds no wild pet of that rarity. */
export function wandererBeastSpecies<T extends WildSpeciesTemplate>(
    wandererId: string,
    rarity: unknown,
    catalog: Iterable<T>,
): T | null {
    const pool = [...catalog].filter((tpl) => tpl && isWildSpeciesOfRarity(tpl, rarity));
    return rendezvous(`beast-species:${wandererId}`, pool, (tpl) => String(tpl.id ?? ""));
}

/** "Stray Beast" + "Desert Lizard" → "Stray Desert Lizard". */
export function wandererBeastName(rosterName: string, speciesName: string): string {
    const epithet = rosterName.endsWith(WANDERER_BEAST_SUFFIX)
        ? rosterName.slice(0, -WANDERER_BEAST_SUFFIX.length)
        : rosterName.split(" ")[0] ?? "";
    return `${epithet} ${speciesName}`.trim();
}
