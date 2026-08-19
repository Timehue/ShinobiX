import type { Screen } from "../types/core";
import type { CapabilityAvailability } from "./live-capabilities";

const VILLAGE_WAR_DEDICATED_SCREENS: ReadonlySet<Screen> = new Set([
    "villageWarMap",
    "sectorCard",
    "sectorPet",
    "sectorGarrison",
]);
export type PlayerSurfaceBlockerMode = "maintenance";

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

/**
 * Cold capability truth is NOT a maintenance notice.
 *
 * This used to return "checking" for "unknown", which put a full-screen modal
 * over the whole app for the length of the boot `/api/player/capabilities`
 * round-trip — on every single refresh — and again mid-session any time two
 * polls in a row missed and the snapshot aged past CAPABILITY_MAX_AGE_MS. What
 * players saw was a black "Checking live service availability" dialog
 * interrupting a game that was working fine.
 *
 * Nothing was being protected by it. MAINTENANCE_MODE is enforced server-side
 * at the single Express route boundary (`api/_launch-controls.ts`), which 503s
 * every player request and exempts only operator recovery and this very
 * capability endpoint — so a real pause cannot be clicked past regardless of
 * what the client renders, and a real pause always arrives as "unavailable"
 * rather than "unknown". Progress-changing actions keep failing closed on cold
 * truth separately, via capabilityAdmissionAllowed at each mutation site.
 *
 * So only an explicit server "unavailable" blocks the surface. While the check
 * is merely in flight the app renders its ordinary boot — the branded
 * "Restoring your session…" screen, or the landing gate.
 */
export function playerSurfaceBlockerMode(
    _hasCharacter: boolean,
    _screen: Screen,
    availability: CapabilityAvailability,
): PlayerSurfaceBlockerMode | null {
    return availability === "unavailable" ? "maintenance" : null;
}

/**
 * Admission for a door that is VISIBLE before capability truth arrives, such as
 * a landing-page call to action. Cold truth leaves it open: the click-time
 * recheck and the server both still refuse a genuinely paused action, so
 * failing closed here only greys out the button for one round-trip on every
 * cold load. Use capabilityAdmissionAllowed instead for anything that commits
 * progress — those must keep failing closed.
 */
export function capabilityAdmissionOpenUntilRefused(availability: CapabilityAvailability): boolean {
    return availability !== "unavailable";
}

/**
 * Settle a capability read before letting it decide a player-visible door.
 *
 * Cold truth means the boot check is still in flight, which is not a refusal —
 * treating it as one is what used to greet players with "Checking live service
 * availability" instead of the game. Awaiting the already-coalesced request
 * costs one round-trip on the rare click that beats it, and returns a real
 * answer.
 *
 * A refresh that cannot reach the server leaves the door OPEN on purpose.
 * api/_launch-controls.ts is the authority — it 503s both sign-in and
 * registration under MAINTENANCE_MODE, and registration under
 * DISABLE_NEW_REGISTRATIONS — so an unreachable client read must not invent a
 * refusal the server never made. Callers therefore refuse only on an explicit
 * "unavailable", never on what this returns still being "unknown".
 */
export async function settleAdmission(
    read: () => CapabilityAvailability,
    refresh: () => Promise<unknown>,
): Promise<CapabilityAvailability> {
    if (read() !== "unknown") return read();
    await refresh();
    return read();
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
