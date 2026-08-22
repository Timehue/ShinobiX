import type { Screen } from "../types/core";

const PET_HOME_SCREENS: ReadonlySet<Screen> = new Set([
    "home",
    "pets",
    "petArena",
    "petShowdown",
    "petColiseum",
    "petLadder",
]);

/** Companion screens behave as one destination, even while their internal tab changes. */
export function isPetHomeScreen(screen: Screen): boolean {
    return PET_HOME_SCREENS.has(screen);
}

export function petHomeReturnLabel(screen: Screen): string {
    const labels: Partial<Record<Screen, string>> = {
        arena: "Battle Arena",
        arenaDistrict: "Arena District",
        centralHub: "Central · The Gates",
        clan: "Clan Hall",
        hollowGateShrine: "Hollow Gate Shrine",
        village: "Village",
        worldMap: "World Map",
    };
    return labels[screen] ?? "Previous Location";
}
