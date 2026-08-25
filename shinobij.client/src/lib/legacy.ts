/*
 * Legacy system client API (docs/legacy-system-plan.md) — typed wrappers over
 * the /api/legacy/* endpoints plus the Wandering Sage sector NPC synth.
 *
 * The public live-capability projection is the authoritative availability gate.
 * A local `legacy.v1=off` preference may additionally hide the feature, but can
 * never expose a server-disabled surface.
 */
import type { Wanderer } from "./wanderers";
import type { Character } from "../types/character";
import {
    capabilityMutationAvailability,
    capabilityViewAvailability,
    liveCapabilitiesStore,
} from "./live-capabilities";
import {
    useCapabilityMutationAvailability,
    useCapabilityViewAvailability,
} from "./live-capabilities-context";

export function legacyAvailabilityAllowed(preferenceEnabled: boolean, serverEnabled: boolean | null): boolean {
    return preferenceEnabled && serverEnabled === true;
}

export function isLegacyEnabled(): boolean {
    return legacyAvailabilityAllowed(
        legacyPreferenceEnabled(),
        capabilityViewAvailability(liveCapabilitiesStore.getSnapshot(), "legacy") === "available",
    );
}

export function isLegacyMutationEnabled(): boolean {
    return legacyAvailabilityAllowed(
        legacyPreferenceEnabled(),
        capabilityMutationAvailability(liveCapabilitiesStore.getSnapshot(), "legacy") === "available",
    );
}

// The Legacy system is a gameplay layer, not a per-device preference: the old
// localStorage `legacy.v1 = "off"` switch let one browser hide sages, emissaries
// and legacy rewards that the account still had. It is now a constant (ON); the
// only gate that remains is the SERVER's ENABLE_LEGACY capability, read above via
// the live-capabilities store. Kept as a function so the two availability
// helpers read unchanged.
function legacyPreferenceEnabled(): boolean {
    return true;
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
    /** World Era this legacy was taken up in (1-5) — server-stamped at accept,
     *  permanent. Absent on legacies accepted before this shipped. */
    eraBorn?: number;
    titles: string[];
};

/** Era number → the evocative "Age" name, for pinning a legacy to the world
 *  timeline ("taken up in the Age of Village Dominion"). Mirrors the era roster
 *  in api/_era-defs.ts; kept as a tiny static map so surfacing it needs no fetch. */
export const ERA_AGE_NAMES: Record<number, string> = {
    1: "the Age of Awakening",
    2: "the Age of the Hollow Gate",
    3: "the Age of Village Dominion",
    4: "the Age of the World Boss",
    5: "the Age of Mythic Legacies",
};
export function eraAgeName(n: number | undefined | null): string | null {
    return n != null && ERA_AGE_NAMES[n] ? ERA_AGE_NAMES[n] : null;
}

export type LegacyDefView = {
    id: string; name: string; rarity: LegacyRarity; category: string;
    villageAffinity: string | null; title: string; flavor: string; badge: string | null;
};

export type SageOfferView = {
    status: "spawned" | "declined" | "accepted" | "expired";
    offers: Array<{ legacyId: string; name: string; rarity: LegacyRarity; category: string; flavor: string; title: string; villageAffinity: string | null; badge?: string | null;
        /** Rank-free preview of the signature technique this legacy grants (name,
         *  shape, effect names; NO percents/EP/rank). Unlocks at Stage 3. */
        signature?: { name: string; shape: string; effects: string[]; unlockStage: number } | null }>;
    sector: number;
    spawnedAt: number;
    expiresAt: number;
};

export type TrialKindView = "awaken" | "bind" | "prove" | "mythic";
export type TrialObjectiveView = { stat: string; delta: number; progress: number; done: boolean };
export type TrialView = {
    id: string;
    legacyId: string; kind: TrialKindView; startedAt: number; attempt: number;
    variant?: number;
    objectives: TrialObjectiveView[];
};

export type SageAcceptResult = {
    ok: boolean;
    reason?: string;
    legacy?: CharacterLegacy;
    trial?: TrialView;
    intro?: string;
    character?: Character;
    _saveVersion?: number;
    /** Newly granted server-owned Chronicle records. Presentation receipt only;
     * callers must never mutate the local tile-card collection from this list. */
    chronicleCards?: string[];
};

export type TrialCompleteResult = {
    ok: boolean;
    reason?: string;
    legacy?: CharacterLegacy;
    title?: string | null;
    completion?: string;
    objectives?: TrialObjectiveView[];
    character?: Character;
    _saveVersion?: number;
    receiptId?: string;
    /** Newly granted server-owned Chronicle records. Presentation receipt only;
     * callers must never mutate the local tile-card collection from this list. */
    chronicleCards?: string[];
};

export type ChronicleRecordReceipt = {
    heading: string;
    message: string;
    count: number;
};

/** Turn a server grant receipt into diegetic ceremony copy. This intentionally
 * carries no card ids and performs no collection write: the save transaction
 * already owns the grant, while the client only announces what was recorded. */
export function buildChronicleRecordReceipt(
    chronicleCards: readonly string[] | null | undefined,
    kind: "sage-acceptance" | "legacy-awakening",
    legacyName?: string | null,
): ChronicleRecordReceipt | null {
    const count = new Set((chronicleCards ?? []).map((id) => id.trim()).filter(Boolean)).size;
    if (count === 0) return null;

    const cardPhrase = count === 1 ? "a new card" : `${count} new cards`;
    const collectionPhrase = count === 1
        ? "The record is already in your Chronicle collection."
        : "The records are already in your Chronicle collection.";
    const witnessedMoment = kind === "sage-acceptance"
        ? "your witnessed covenant with the Wandering Sage"
        : legacyName?.trim()
            ? `the moment ${legacyName.trim()} awakened through your freely chosen, witnessed deeds`
            : "this freely chosen, witnessed Legacy awakening";

    return {
        heading: "Chronicle Record Preserved",
        message: `Chronicle scribes preserve ${witnessedMoment} as ${cardPhrase}. ${collectionPhrase}`,
        count,
    };
}

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
    /** Present on authenticated reads so a marker-only acceptance repair is
     * adopted atomically instead of waiting for the next full save load. */
    character?: Character;
    _saveVersion?: number;
    repaired?: boolean;
    effectsPending?: boolean;
};

export type AnnouncementView = {
    id: number; ts: number; type: string; importance: "low" | "medium" | "high" | "mythic";
    title: string; message: string; player?: string; village?: string; legacyId?: string;
    meta?: Record<string, unknown>;
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

/** Compatibility entry point for non-React callers. It reads the same live
 * projection as the hook and never probes a feature endpoint for availability. */
export async function isLegacyServerLive(): Promise<boolean> {
    return isLegacyEnabled();
}

/**
 * Server availability is the only enable gate. A local preference may hide
 * the feature, but it cannot expose a server-disabled Legacy surface. The
 * hook subscribes to the shared provider and re-renders every entry point when
 * authoritative availability changes.
 */
export function useLegacyAvailability(): boolean {
    const availability = useCapabilityViewAvailability("legacy");
    return legacyAvailabilityAllowed(legacyPreferenceEnabled(), availability === "available");
}


export function useLegacyMutationAvailability(): boolean {
    const availability = useCapabilityMutationAvailability("legacy");
    return legacyAvailabilityAllowed(legacyPreferenceEnabled(), availability === "available");
}

export function sageRoll(playerName: string, sector?: number | null): Promise<{ spawn: boolean; offer?: SageOfferView; reason?: string } | null> {
    return postJson(`/api/legacy/sage`, { action: "roll", playerName, ...(sector != null ? { sector } : {}) });
}

export function sageDecline(playerName: string): Promise<{ ok: boolean } | null> {
    return postJson(`/api/legacy/sage`, { action: "decline", playerName });
}

export function sageAccept(playerName: string, legacyId: string): Promise<SageAcceptResult | null> {
    return postJson(`/api/legacy/sage`, { action: "accept", playerName, legacyId });
}

export function trialStart(playerName: string): Promise<{ ok: boolean; reason?: string; trial?: TrialView; intro?: string } | null> {
    return postJson(`/api/legacy/trial`, { action: "start", playerName });
}

/** Swap the active trial's proof for its alternate (fresh baselines, attempt++). */
export function trialReroll(playerName: string): Promise<{ ok: boolean; reason?: string; trial?: TrialView; intro?: string } | null> {
    return postJson(`/api/legacy/trial`, { action: "reroll", playerName });
}

export function trialComplete(playerName: string, trialId?: string): Promise<TrialCompleteResult | null> {
    return postJson(`/api/legacy/trial`, { action: "complete", playerName, ...(trialId ? { trialId } : {}) });
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
    trigger: { label: string; fired: boolean; firedBy?: string; firedByVillage?: string } | null;
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
        // Deliberately NOT the VN's opening line — the player reads the
        // billboard first and the VN seconds later (polish-audit finding).
        greeting: "An old man checks your name against three field notes, circles it, and rubs at a blister from the road.",
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
    cardClashWins: "Chronicle Showdown wins",
    warContribution: "war contribution dealt", warPvpKills: "war PvP takedowns",
};
