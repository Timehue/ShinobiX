import type { Screen } from "../types/core";

export type PetArenaStartCheck = {
    selectedPetName?: string;
    selectedPetOnExpedition?: boolean;
    opponentMode: "player" | "ai";
    opponentPetName?: string;
    opponentOnExpedition?: boolean;
    reserveRequired?: boolean;
    reserveAvailable?: boolean;
};

/** Pure preflight used before Pet Arena starts any audio or battle state. */
export function petArenaStartIssue(check: PetArenaStartCheck): string | null {
    if (!check.selectedPetName) return "Choose one of your pets first.";
    if (check.selectedPetOnExpedition) return `${check.selectedPetName} is exploring and cannot battle right now.`;
    if (!check.opponentPetName) {
        return check.opponentMode === "player"
            ? "No player pets found. Choose Fight AI or have another player with pets in the roster."
            : "No AI pets found.";
    }
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
