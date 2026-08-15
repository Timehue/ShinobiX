import type { PublicCapabilities, PublicCapabilityId } from "../../../shared/public-capabilities";
import type { Screen } from "../types/core";

export type LiveServiceNotice = {
    title: string;
    body: string;
    state: "temporarily-unavailable" | "actions-paused";
};

const SCREEN_CAPABILITIES: Partial<Record<Screen, readonly PublicCapabilityId[]>> = {
    start: ["registrations"],
    villageWarMap: ["villageWar"],
    sectorCard: ["villageWar"],
    sectorPet: ["villageWar"],
};

const FEATURE_COPY: Partial<Record<PublicCapabilityId, { title: string; body: string }>> = {
    registrations: {
        title: "New registrations are temporarily unavailable",
        body: "Existing players can still sign in. New account creation will return when operations reopen it.",
    },
    villageWar: {
        title: "Sector campaign operations are temporarily unavailable",
        body: "The Sector Map and its combat entries are paused. The legacy War Hall and existing character progress remain available.",
    },
    clanBoss: {
        title: "Clan Boss Operations are temporarily unavailable",
        body: "The rest of the Clan Hall remains available while weekly boss operations are paused.",
    },
    clanBossParties: {
        title: "Clan Boss parties are temporarily unavailable",
        body: "Clan Boss solo compatibility remains available; party formation is paused by operations.",
    },
    legacy: {
        title: "Legacy is temporarily unavailable",
        body: "This service is not available in the current server configuration. Other mastery paths remain open.",
    },
    petBreedingStarts: {
        title: "New companion pairings are temporarily unavailable",
        body: "Existing timers, eggs, hatches, and companions still work normally.",
    },
    weeklyBossGuardCycle: {
        title: "A Weekly Boss mechanic is temporarily unavailable",
        body: "The core Weekly Boss fight remains available; its guard cycle is temporarily disabled.",
    },
    anbuInfiltration: {
        title: "ANBU infiltration is temporarily unavailable",
        body: "The vault operation is paused. Other World Map and village activity remains available.",
    },
};

export function liveServiceNotice(
    screen: Screen,
    capabilities: PublicCapabilities,
): LiveServiceNotice | null {
    if (capabilities.gameplay.state !== "available") {
        return {
            title: "ShinobiX is temporarily unavailable",
            body: "The game is in maintenance. Your saved progress is safe; please try again shortly.",
            state: "temporarily-unavailable",
        };
    }
    if (capabilities.gameplayMutations.state !== "available") {
        return {
            title: "Progress-changing web requests are temporarily paused",
            body: "New save, purchase, claim, and combat requests are being rejected. Existing timers, background settlement, and realtime sessions may still advance.",
            state: "actions-paused",
        };
    }
    for (const id of SCREEN_CAPABILITIES[screen] ?? []) {
        const capability = capabilities[id];
        if (!capability || capability.state === "available") continue;
        const copy = FEATURE_COPY[id];
        if (copy) return { ...copy, state: capability.state };
    }
    return null;
}
