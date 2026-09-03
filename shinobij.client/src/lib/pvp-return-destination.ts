import type { Screen } from "../types/core";

/** The context a PvP bout was launched from, narrowed to what the return
 *  destination actually depends on. Structural so callers can pass their own
 *  richer battle context without a cast. */
export type PvpReturnContext = {
    sectorAttack?: boolean | null;
    mode?: string | null;
    sector?: number | null;
} | null | undefined;

export type PvpReturnDestination = {
    target: Screen;
    label: string;
};

/**
 * Where the victory/defeat screen sends a player back to, and what the button
 * calls that place.
 *
 * A sector attack has to return to the world map rather than the arena, because
 * the fight was started from a tile the player still occupies; a clan-war bout
 * returns to the clan screen for the same reason. Everything else came from the
 * arena and goes back to it.
 */
export function pvpReturnDestination(context: PvpReturnContext, currentSector: number): PvpReturnDestination {
    if (context?.sectorAttack) {
        return { target: "worldMap", label: `Return to Sector ${context.sector ?? currentSector}` };
    }
    if (context?.mode?.startsWith("clanWar")) {
        return { target: "clan", label: "Return to Clan War" };
    }
    return { target: "battleArena", label: "Return to Arena" };
}
