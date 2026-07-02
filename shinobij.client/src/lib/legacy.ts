/*
 * Legacy system client API (docs/legacy-system-plan.md) — typed wrappers over
 * the /api/legacy/* endpoints plus the Wandering Sage sector NPC synth.
 *
 * Client flag: `legacy.v1` (localStorage, default ON — the real gate is the
 * server's ENABLE_LEGACY; endpoints 404 while it's off and every wrapper here
 * resolves to null/empty rather than throwing).
 */
import type { Wanderer } from "./wanderers";

export function isLegacyEnabled(): boolean {
    if (typeof window === "undefined") return false;
    try { return window.localStorage?.getItem("legacy.v1") !== "off"; } catch { return true; }
}

export type LegacyRarity = "basic" | "rare" | "legendary" | "mythic";

export type CharacterLegacy = {
    legacyId: string;
    stage: 1 | 2 | 3 | 4 | 5;
    acceptedAt: number;
    awakenedAt?: number;
    boundAt?: number;
    titles: string[];
};

export type LegacyDefView = {
    id: string; name: string; rarity: LegacyRarity; category: string;
    villageAffinity: string | null; title: string; flavor: string; badge: string | null;
};

export type SageOfferView = {
    status: "spawned" | "declined" | "accepted" | "expired";
    offers: Array<{ legacyId: string; name: string; rarity: LegacyRarity; category: string; flavor: string; title: string; villageAffinity: string | null }>;
    sector: number;
    spawnedAt: number;
    expiresAt: number;
};

export type TrialObjectiveView = { stat: string; delta: number; progress: number; done: boolean };
export type TrialView = {
    legacyId: string; kind: "awaken" | "bind"; startedAt: number; attempt: number;
    objectives: TrialObjectiveView[];
};

export type LegacyStatusView = {
    level: number;
    minLevelReached: boolean;
    legacy: CharacterLegacy | null;
    trial: TrialView | null;
    offer: SageOfferView | null;
    strongest: Array<{ category: string; tier: string }>;
    eligibleCounts: Record<LegacyRarity, number>;
};

export type AnnouncementView = {
    id: number; ts: number; type: string; importance: "low" | "medium" | "high" | "mythic";
    title: string; message: string; player?: string; village?: string; legacyId?: string;
};

export type HallEntryView = {
    id: number; ts: number; entryType: string; title: string; description: string;
    player?: string; village?: string; legacyId?: string; rarity?: string;
    status: "active" | "corrected" | "revoked" | "hidden"; correctionNote?: string;
};

export const RARITY_COLORS: Record<LegacyRarity, string> = {
    basic: "#9aa3b2", rare: "#60a5fa", legendary: "#f59e0b", mythic: "#c084fc",
};
export const RARITY_LABELS: Record<LegacyRarity, string> = {
    basic: "Basic", rare: "Rare", legendary: "Legendary", mythic: "Mythic",
};

async function getJson<T>(url: string): Promise<T | null> {
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return (await res.json()) as T;
    } catch { return null; }
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T | null> {
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!res.ok && res.status !== 409) return null;
        return (await res.json()) as T;
    } catch { return null; }
}

export function fetchLegacyStatus(playerName: string): Promise<LegacyStatusView | null> {
    return getJson(`/api/legacy/stats?playerName=${encodeURIComponent(playerName)}`);
}

export function fetchLegacyDefinitions(): Promise<{ minLevel: number; legacies: LegacyDefView[] } | null> {
    return getJson(`/api/legacy/definitions`);
}

export function sageRoll(playerName: string, sector?: number | null): Promise<{ spawn: boolean; offer?: SageOfferView; reason?: string } | null> {
    return postJson(`/api/legacy/sage`, { action: "roll", playerName, ...(sector != null ? { sector } : {}) });
}

export function sageDecline(playerName: string): Promise<{ ok: boolean } | null> {
    return postJson(`/api/legacy/sage`, { action: "decline", playerName });
}

export function sageAccept(playerName: string, legacyId: string): Promise<{ ok: boolean; reason?: string; legacy?: CharacterLegacy; trial?: TrialView } | null> {
    return postJson(`/api/legacy/sage`, { action: "accept", playerName, legacyId });
}

export function trialStart(playerName: string): Promise<{ ok: boolean; reason?: string; trial?: TrialView } | null> {
    return postJson(`/api/legacy/trial`, { action: "start", playerName });
}

export function trialComplete(playerName: string): Promise<{ ok: boolean; reason?: string; legacy?: CharacterLegacy; title?: string | null; objectives?: TrialObjectiveView[] } | null> {
    return postJson(`/api/legacy/trial`, { action: "complete", playerName });
}

export function fetchAnnouncements(limit = 20): Promise<{ announcements: AnnouncementView[]; latestId: number } | null> {
    return getJson(`/api/announcements?limit=${limit}`);
}

export function fetchHallOfLegends(): Promise<{ entries: HallEntryView[] } | null> {
    return getJson(`/api/hall-of-legends`);
}

/** Stable id the WorldMap engage handler keys off. */
export const LEGACY_SAGE_WANDERER_ID = "legacy-sage";

/** The Wandering Sage as a sector NPC — rendered by the existing
 *  <SectorWanderer> billboard (violet tell, never hostile, never cooled).
 *  Placement is fixed per sector so he doesn't jump between polls. */
export function synthSageWanderer(sector: number): Wanderer {
    const home = 5 * 12 + ((sector * 7) % 8) + 2;   // mid-row, deterministic column
    return {
        id: LEGACY_SAGE_WANDERER_ID,
        name: "Wandering Sage",
        archetype: "wanderingSage",
        verb: "quest",
        level: 99,
        homeTile: home,
        waypoints: [home, home + 1, home - 1],
        greeting: "I have watched your path, shinobi. Every battle, every choice, has carved something into your spirit.",
        tellTint: "#c084fc",
        avatarKey: "wanderingSage",
    };
}

/** Human labels for trial objective stats (server stat keys → player words). */
export const TRIAL_STAT_LABELS: Record<string, string> = {
    ninjutsuKills: "Ninjutsu victories", genjutsuKills: "Genjutsu victories",
    taijutsuKills: "Taijutsu victories", bukijutsuKills: "Bukijutsu victories",
    pvpWins: "PvP wins", missionCompletions: "missions completed",
    pveKills: "foes defeated", warMissions: "war missions",
    villageDonations: "ryo donated to your village", healingDone: "HP healed in battle",
    tilesExplored: "tiles explored", sectorDiscoveries: "sector discoveries",
    petDuelWins: "pet duel wins", cardClashWins: "Card Clash wins",
    warContribution: "war contribution dealt",
};
