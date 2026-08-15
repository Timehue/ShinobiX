import type { Screen } from "../types/core";
import type { CapabilityAvailability } from "./live-capabilities";

const VILLAGE_WAR_DEDICATED_SCREENS: ReadonlySet<Screen> = new Set([
    "villageWarMap",
    "sectorCard",
    "sectorPet",
]);
export type PlayerSurfaceBlockerMode = "checking" | "maintenance";

export function capabilityAdmissionAllowed(availability: CapabilityAvailability): boolean {
    return availability === "available";
}

export function isVillageWarDedicatedScreen(screen: Screen): boolean {
    return VILLAGE_WAR_DEDICATED_SCREENS.has(screen);
}

export function villageWarScreenMountAllowed(
    screen: Screen,
    availability: CapabilityAvailability,
): boolean {
    return !isVillageWarDedicatedScreen(screen) || capabilityAdmissionAllowed(availability);
}

export function capabilityPreferenceAllowsAdmission(
    preferenceEnabled: boolean,
    availability: CapabilityAvailability,
): boolean {
    return preferenceEnabled && capabilityAdmissionAllowed(availability);
}

export function playerSurfaceBlockerMode(
    _hasCharacter: boolean,
    _screen: Screen,
    availability: CapabilityAvailability,
): PlayerSurfaceBlockerMode | null {
    if (availability === "available") return null;
    return availability === "unavailable" ? "maintenance" : "checking";
}

export function registrationAdmissionMessage(availability: CapabilityAvailability): string {
    return availability === "unknown"
        ? "Checking whether new character registration is available. Existing players can still log in."
        : "New character registration is temporarily unavailable. Existing players can still log in.";
}

export function playerLoginAdmissionMessage(availability: CapabilityAvailability): string {
    return availability === "unknown"
        ? "Checking live service availability. Player login will open when the check completes; admin and legal access remain available."
        : "ShinobiX is temporarily unavailable for maintenance. Player login and registration are paused; admin and legal access remain available.";
}

export function mutationAdmissionMessage(availability: CapabilityAvailability): string {
    return availability === "unknown"
        ? "Checking whether progress-changing actions are available…"
        : "Progress-changing web actions are temporarily paused. Read-only status and active recovery remain available.";
}

export function sectorMapAdmissionMessage(availability: CapabilityAvailability): string {
    return availability === "unknown"
        ? "Checking Sector Map availability. The legacy War Hall remains open."
        : "Sector campaign operations are temporarily unavailable. The legacy War Hall remains open.";
}
