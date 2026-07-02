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
    provenAt?: number;
    mythicAt?: number;
    titles: string[];
};

export type LegacyDefView = {
    id: string; name: string; rarity: LegacyRarity; category: string;
    villageAffinity: string | null; title: string; flavor: string; badge: string | null;
};

export type SageOfferView = {
    status: "spawned" | "declined" | "accepted" | "expired";
    offers: Array<{ legacyId: string; name: string; rarity: LegacyRarity; category: string; flavor: string; title: string; villageAffinity: string | null; badge?: string | null }>;
    sector: number;
    spawnedAt: number;
    expiresAt: number;
};

export type TrialKindView = "awaken" | "bind" | "prove" | "mythic";
export type TrialObjectiveView = { stat: string; delta: number; progress: number; done: boolean };
export type TrialView = {
    legacyId: string; kind: TrialKindView; startedAt: number; attempt: number;
    variant?: number;
    objectives: TrialObjectiveView[];
};

export type LegacyStatusView = {
    level: number;
    minLevelReached: boolean;
    legacy: CharacterLegacy | null;
    /** Accepted legacy's category (server-resolved) — emissary matching. */
    legacyCategory?: string | null;
    trial: TrialView | null;
    /** The Sage's charge for the active trial (server-authored narrative). */
    trialIntro?: string | null;
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

// Whether the SERVER's ENABLE_LEGACY flag is actually on (isLegacyEnabled above
// is only the client kill-switch). Probed once per session via the public
// definitions endpoint, which 404s while the flag is off. Gates paid legacy-wave
// UI (title style/icon pickers) so a player can't spend shards on a cosmetic the
// server would strip at save time.
let legacyServerLive: boolean | null = null;
export async function isLegacyServerLive(): Promise<boolean> {
    if (!isLegacyEnabled()) return false;
    if (legacyServerLive === null) legacyServerLive = (await fetchLegacyDefinitions()) !== null;
    return legacyServerLive;
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

export function trialStart(playerName: string): Promise<{ ok: boolean; reason?: string; trial?: TrialView; intro?: string } | null> {
    return postJson(`/api/legacy/trial`, { action: "start", playerName });
}

/** Swap the active trial's proof for its alternate (fresh baselines, attempt++). */
export function trialReroll(playerName: string): Promise<{ ok: boolean; reason?: string; trial?: TrialView; intro?: string } | null> {
    return postJson(`/api/legacy/trial`, { action: "reroll", playerName });
}

export function trialComplete(playerName: string): Promise<{ ok: boolean; reason?: string; legacy?: CharacterLegacy; title?: string | null; completion?: string; objectives?: TrialObjectiveView[] } | null> {
    return postJson(`/api/legacy/trial`, { action: "complete", playerName });
}

export function fetchAnnouncements(limit = 20): Promise<{ announcements: AnnouncementView[]; latestId: number } | null> {
    return getJson(`/api/announcements?limit=${limit}`);
}

export function fetchHallOfLegends(): Promise<{ entries: HallEntryView[] } | null> {
    return getJson(`/api/hall-of-legends`);
}

export type EraMilestoneView = { metric: string; label: string; required: number; current: number; done: boolean };
export type EraView = {
    id: string; number: number; name: string; description: string; lore: string; banner: string;
    chronicle?: string[];
    status: "locked" | "admin_available" | "milestone_active" | "unlocked";
    milestones: EraMilestoneView[];
    trigger: { label: string; fired: boolean; firedBy?: string } | null;
    unlockedBy: string | null; unlockedVillage: string | null; unlockedAt: number | null;
};

export function fetchEras(): Promise<{ eras: EraView[] } | null> {
    return getJson(`/api/eras`);
}

// ── Custom-title cosmetics (handoff §Title System pricing tiers) ────────────
// Style + icon are pure cosmetics on the title chip; the SERVER allowlists
// both fields at save-sanitize (api/save/[name].ts), so nothing outside these
// sets ever persists. Costs follow the plan's recommendation: base text title
// stays 10 shards (grandfathered pricing); the new options are the premium.
export const TITLE_STYLE_COST = 40;
export const TITLE_ICON_COST = 25;
export const TITLE_STYLES: ReadonlyArray<{ id: string; label: string; color: string }> = [
    { id: "", label: "Classic Gold", color: "#fde68a" },
    { id: "ember", label: "Ember", color: "#fb923c" },
    { id: "frost", label: "Frost", color: "#7dd3fc" },
    { id: "verdant", label: "Verdant", color: "#86efac" },
    { id: "shadow", label: "Shadow", color: "#c084fc" },
    { id: "royal", label: "Royal", color: "#818cf8" },
    { id: "crimson", label: "Crimson", color: "#f87171" },
];
export const TITLE_ICONS: readonly string[] = ["", "⚔️", "🌙", "🔥", "❄️", "🍃", "👑", "🐺", "⭐"];
export function titleStyleColor(styleId: string | undefined | null): string {
    return TITLE_STYLES.find((s) => s.id === (styleId ?? ""))?.color ?? "#fde68a";
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
// Human labels for every stat a trial objective can surface. Drift-guarded:
// the server lint (api/_legacy-defs.test.ts) fails if a trial template uses a
// stat with no label here.
export const TRIAL_STAT_LABELS: Record<string, string> = {
    ninjutsuKills: "Ninjutsu victories", genjutsuKills: "Genjutsu victories",
    taijutsuKills: "Taijutsu victories", bukijutsuKills: "Bukijutsu victories",
    ninjutsuDamage: "Ninjutsu damage dealt", genjutsuDamage: "Genjutsu damage dealt",
    taijutsuDamage: "Taijutsu damage dealt", bukijutsuDamage: "Bukijutsu damage dealt",
    pvpWins: "PvP wins", pvpKills: "PvP takedowns",
    sameRankWins: "wins against your own rank", defensiveWins: "defensive wins",
    missionCompletions: "missions completed",
    pveKills: "foes defeated", eliteKills: "elite foes defeated",
    huntCompletions: "hunts completed", dungeonClears: "dungeons cleared",
    hollowGateClears: "Hollow Gate clears", raidsCompleted: "raids completed",
    bossContribution: "weekly-boss damage dealt", warMissions: "war missions",
    villageDonations: "ryo donated to your village", healingDone: "HP healed in battle",
    shieldsApplied: "shields granted", damageBlocked: "damage blocked",
    sectorDefenses: "sector defenses held",
    tilesExplored: "tiles explored", sectorDiscoveries: "sector discoveries",
    hiddenFinds: "hidden places found", wandererQuests: "wanderer quests finished",
    petDuelWins: "pet duel wins", petExpeditions: "pet expeditions completed",
    cardClashWins: "Card Clash wins",
    warContribution: "war contribution dealt", warPvpKills: "war PvP takedowns",
};
