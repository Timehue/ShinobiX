import type { PublicCapabilities, PublicCapabilitiesResponse, PublicCapabilityId } from "../../../shared/public-capabilities";
import type { Screen } from "../types/core";

export type LiveServiceNotice = { title: string; body: string; state: "temporarily-unavailable" | "actions-paused" };

let capabilityRequest: Promise<PublicCapabilities | null> | null = null;

export function loadPublicCapabilities(): Promise<PublicCapabilities | null> {
    if (!capabilityRequest) {
        capabilityRequest = fetch("/api/player/capabilities", { headers: { Accept: "application/json" } })
            .then(async (response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const body = await response.json() as Partial<PublicCapabilitiesResponse>;
                return body.ok === true && body.capabilities ? body.capabilities : null;
            })
            .catch(() => {
                // Only a SUCCESSFUL answer is worth memoizing. Caching the null
                // meant one blip at boot disabled every capability-gated control
                // for the life of the page — and the login screen hides the
                // Google and guest buttons on anything but "available", so a
                // single dropped request silently removed two of the three ways
                // into the game until the player thought to reload.
                capabilityRequest = null;
                return null;
            });
    }
    return capabilityRequest;
}

const SCREEN_CAPABILITIES: Partial<Record<Screen, readonly PublicCapabilityId[]>> = {
    start: ["registrations"],
    townHall: ["villageWar"],
    villageWar: ["villageWar"],
    villageWarMap: ["villageWar"],
    sectorCard: ["villageWar"],
    sectorPet: ["villageWar"],
    clan: ["clanBoss", "clanBossParties"],
    hallOfLegends: ["legacy"],
    pets: ["petBreedingStarts"],
    weeklyBoss: ["weeklyBossGuardCycle"],
};

const FEATURE_COPY: Partial<Record<PublicCapabilityId, { title: string; body: string }>> = {
    registrations: { title: "New registrations are temporarily unavailable", body: "Existing players can still sign in. New account creation will return when operations reopen it." },
    villageWar: { title: "Village War is temporarily unavailable", body: "War and sector actions are paused by operations. Your existing character progress is unaffected." },
    clanBoss: { title: "Clan Boss Operations are temporarily unavailable", body: "The rest of the Clan Hall remains available while weekly boss operations are paused." },
    clanBossParties: { title: "Clan Boss parties are temporarily unavailable", body: "Clan Boss solo compatibility remains available; party formation is paused by operations." },
    legacy: { title: "Legacy is temporarily unavailable", body: "This service is not available in the current server configuration. Other mastery paths remain open." },
    petBreedingStarts: { title: "New companion pairings are temporarily unavailable", body: "Existing timers, eggs, hatches, and companions still work normally." },
    weeklyBossGuardCycle: { title: "A Weekly Boss mechanic is temporarily unavailable", body: "The core Weekly Boss fight remains available; its guard cycle is temporarily disabled." },
};

export function liveServiceNotice(screen: Screen, capabilities: PublicCapabilities): LiveServiceNotice | null {
    if (capabilities.gameplay && capabilities.gameplay.state !== "available") {
        return { title: "ShinobiX is temporarily unavailable", body: "The game is in maintenance. Your saved progress is safe; please try again shortly.", state: "temporarily-unavailable" };
    }
    if (capabilities.gameplayMutations && capabilities.gameplayMutations.state !== "available") {
        return { title: "Gameplay actions are temporarily paused", body: "You can review your character, but progress and economy actions are paused by operations.", state: "actions-paused" };
    }
    for (const id of SCREEN_CAPABILITIES[screen] ?? []) {
        const capability = capabilities[id];
        if (!capability || capability.state === "available") continue;
        const copy = FEATURE_COPY[id];
        if (copy) return { ...copy, state: capability.state };
    }
    return null;
}
