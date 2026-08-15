import type { Screen } from "../types/core";

export type PetArenaStartCheck = {
    selectedPetName?: string;
    selectedPetOnExpedition?: boolean;
    opponentPetName?: string;
    opponentOnExpedition?: boolean;
    reserveRequired?: boolean;
    reserveAvailable?: boolean;
};

/** Pure preflight used before Pet Arena starts any audio or battle state.
 *
 *  `opponentMode` is gone: the screen no longer offers a built-in AI opponent,
 *  so every duel it starts has a real player on the other side. AI exhibitions
 *  live in the Coliseum entry (screens/PetShowdown), which does its own
 *  matching and never comes through here. */
export function petArenaStartIssue(check: PetArenaStartCheck): string | null {
    if (!check.selectedPetName) return "Choose one of your pets first.";
    if (check.selectedPetOnExpedition) return `${check.selectedPetName} is exploring and cannot battle right now.`;
    if (!check.opponentPetName) return "This duel has no opponent. Challenge a player from the roster.";
    if (check.opponentOnExpedition) return `${check.opponentPetName} is exploring and cannot battle right now.`;
    if (check.reserveRequired && !check.reserveAvailable) return "Need a reserve pet (a second pet not on expedition).";
    return null;
}

/** Normal Coliseum visits return to companion care; forced encounters preserve their caller. */
export function petArenaReturnScreen(override?: Screen): Screen {
    return override ?? "pets";
}

export function petArenaBackLabel(screen: Screen): string {
    const destination: Partial<Record<Screen, string>> = {
        pets: "Pet Yard",
        home: "Companion Home",
        hollowGateShrine: "Shrine",
        worldMap: "World Map",
        centralHub: "Central",
        clan: "Clan Hall",
    };
    return destination[screen] ? `Back to ${destination[screen]}` : "Back";
}
