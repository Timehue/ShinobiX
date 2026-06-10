/*
 * PvP session plumbing — the combat-only save fetch (PlayerCombatSave), the
 * image-stripping session-payload stringifier, and the sealed session
 * environment selector (biome/weather; ranked ships neutral). Extracted
 * verbatim from App.tsx. normalizeCharacter stays in App (it normalizes the
 * whole legacy save shape) and is read here as a live binding.
 */
import { normalizeCharacter } from "../App";
import { normalizeJutsu } from "./jutsu";
import { sanitizeArmorAndGloveItem } from "./items";
import type { Character } from "../types/character";
import type { GameItem, Jutsu, SavedBloodline } from "../types/combat";

// PvP session environment selector. The server reads biome + weather elements
// from the SEALED session at create time and intentionally ignores them on
// every move (it would otherwise be a trust-the-client hole). Until this
// helper landed, no session-create payload shipped biome/weather at all, so
// the server's terrainMultiplier (+10% type-matched) and weatherMultiplier
// (+5%/-2% by element) were dead in live PvP. Ranked still ships neutral
// (biome='central', no weather) so element-of-the-day can't skew ladder play.
// All other PvP modes (sector, village-guard, spar, clan-war) ride the live
// biome/weather. Falls through normalizeBiome/normalizeElement on the server,
// so unknown values become 'central' / '' rather than failing the request.
export function pvpSessionEnvironment(
    isRanked: boolean,
    biome: string,
    positiveElement: string | undefined,
    negativeElement: string | undefined,
): { biome: string; weatherPositiveElement: string; weatherNegativeElement: string } {
    if (isRanked) return { biome: "central", weatherPositiveElement: "", weatherNegativeElement: "" };
    return {
        biome,
        weatherPositiveElement: positiveElement ?? "",
        weatherNegativeElement: negativeElement ?? "",
    };
}

export function stringifyPvpSessionPayload(payload: unknown) {
    return JSON.stringify(payload, (_key, value) => typeof value === "string" && value.startsWith("data:image") ? "" : value);
}

export type PlayerCombatSave = {
    character?: Character;
    savedBloodlines?: SavedBloodline[];
    creatorJutsus?: Jutsu[];
    creatorItems?: GameItem[];
};

export async function fetchPlayerCombatSave(name: string): Promise<PlayerCombatSave | null> {
    try {
        // ?combatOnly=1 asks the server to strip mission progress, lifetime
        // counters, hollow gate state, etc. — none of which combat reads.
        // Shaves ~50–150KB per fetch (×2 fetches per challenge accept / raid).
        const res = await fetch(`/api/save/${encodeURIComponent(name.toLowerCase())}?combatOnly=1`);
        if (!res.ok) return null;
        const data = await res.json() as PlayerCombatSave;
        const saved = Array.isArray(data.savedBloodlines) ? data.savedBloodlines : [];
        const created = Array.isArray(data.creatorJutsus) ? data.creatorJutsus : [];
        const createdItems = Array.isArray(data.creatorItems) ? data.creatorItems : [];
        return {
            character: data.character ? normalizeCharacter(data.character) : undefined,
            savedBloodlines: saved.map((bloodline) => ({
                ...bloodline,
                jutsus: (bloodline.jutsus ?? []).map(normalizeJutsu),
            })),
            // Do NOT rebalance here — admin-saved values must survive combat loading.
            // rebalanceNonBloodlineJutsu must only run on initial creation, never on reads.
            creatorJutsus: created.map(normalizeJutsu),
            creatorItems: createdItems.map(sanitizeArmorAndGloveItem),
        };
    } catch {
        return null;
    }
}
