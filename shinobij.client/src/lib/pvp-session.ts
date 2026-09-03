/*
 * PvP session plumbing — the combat-only save fetch (PlayerCombatSave), the
 * image-stripping session-payload stringifier, and the sealed session
 * environment selector (biome/weather; ranked ships neutral). Extracted
 * verbatim from App.tsx. normalizeCharacter stays in App (it normalizes the
 * whole legacy save shape) and is read here as a live binding.
 */
// Imported from the module, NOT from "../App". Reaching back into App pulled its
// .webp and component CSS into every consumer of this file, which is why nothing
// downstream of it could be loaded under node:test.
import { normalizeCharacter } from "./normalize-character";
import { normalizeJutsu } from "./jutsu";
import { sanitizeArmorAndGloveItem } from "./items";
import type { Character } from "../types/character";
import type { GameItem, Jutsu, SavedBloodline } from "../types/combat";
import type { Screen } from "../types/core";
import type { PvpRecoveryContext } from "./pvp-pending-session";
import { bindPvpSessionCreateIntent } from "./pvp-session-intent";
import { isWildSector } from "./screen-guards";
import { setSectorReopen } from "./sector-return";

/*
 * Where a finished PvP fight sends this player, and what the button promises.
 *
 * `hospitalized` is the settled server verdict (api/pvp/_vitals-settlement.ts),
 * not a guess from the outcome — a fighter who FLED lost the battle and still
 * walks back to their spot in the sector, while a knocked-out or forfeiting
 * loser is admitted. shouldRedirectToHospital() would bounce an admitted player
 * off any other screen anyway; routing here is what stops the button promising
 * a sector return that the guard immediately overrides.
 *
 * Defaults to false so the pre-settlement render (and every non-continuous
 * mode) keeps the original destination.
 */
export function pvpResultReturn(context: PvpRecoveryContext | null, currentSector: number, hospitalized = false): { returnTarget: Screen; returnLabel: string } {
    if (hospitalized) return { returnTarget: "hospital", returnLabel: "Go to Hospital" };
    const returnTarget: Screen = context?.sectorAttack ? "worldMap" : context?.mode?.startsWith("clanWar") ? "clan" : "battleArena";
    return {
        returnTarget,
        returnLabel: returnTarget === "worldMap" ? `Return to Sector ${context?.sector ?? currentSector}`
            : returnTarget === "clan" ? "Return to Clan War" : "Return to Arena",
    };
}

/*
 * The other half of "go back where I came from": reopen the sector BOARD, not
 * the world overview.
 *
 * `worldMap` is one screen hosting two views — the overworld, and a sector's
 * 12x12 board — selected by WorldMap's own `selectedSector`, which is ephemeral
 * React state wiped by the trip through the battle screen. So "Return to Sector
 * 44" landed on the overview and the winner had to walk back in, which is not
 * "the spot you attacked from".
 *
 * This is the same one-shot marker the explore ambush sets before its fight
 * (WorldMap consumes it on mount). The Hospital clears it on ITS mount, so an
 * admitted loser never reopens the sector they fell in — which is exactly why
 * this may be set for both fighters without special-casing the outcome.
 *
 * Village-outskirts raids run on a virtual sector shown by a different branch,
 * so `isWildSector` correctly leaves those on today's behaviour.
 */
export function markPvpSectorReturn(target: Screen, context: PvpRecoveryContext | null, currentSector: number): void {
    if (target !== "worldMap" || !context?.sectorAttack) return;
    const sector = Number(context.sector ?? currentSector);
    if (isWildSector(sector)) setSectorReopen(sector);
}

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
    return JSON.stringify(bindPvpSessionCreateIntent(payload), (_key, value) => typeof value === "string" && value.startsWith("data:image") ? "" : value);
}

export type PlayerCombatSave = {
    character?: Character;
    savedBloodlines?: SavedBloodline[];
    creatorJutsus?: Jutsu[];
    creatorItems?: GameItem[];
    /**
     * Present only when reading your OWN save (a foreign read is projected down
     * to the public DTO). Reading your own save settles elapsed state — a
     * completed journey, an expired Hollow Gate run — and persisting that bumps
     * `_saveVersion`. Callers that read their own save MUST adopt it, or their
     * next autosave echoes a stale base version, takes a 409, and raises a
     * save-recovery banner for a divergence that never happened.
     */
    _saveVersion?: number;
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
            _saveVersion: typeof data._saveVersion === "number" ? data._saveVersion : undefined,
        };
    } catch {
        return null;
    }
}
