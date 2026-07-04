// ─── Endless Spire — client display catalog (mirror of api/towers/_spire-catalog.ts) ──
// A DISPLAY-ONLY mirror of the server's boss-per-floor mapping + boss identities, plus the
// tier bands, milestone titles, per-tier keystone unlocks, and reward rate. The server is the
// authority for combat (getSpireFloor / resolveAscensionModifiers); this lets the lobby render
// the full 20-floor climb — boss portraits, mechanics, rewards, what's-new-this-floor — WITHOUT
// a round-trip. Keep BOSS_BY_FLOOR + the keystone tiers in sync with the server catalog/modifiers.
import { SPIRE_MAX_TIER, SPIRE_MILESTONE_FLOORS } from "./towers-api";

export type SpireBossKey = "warden" | "revenant" | "ravager" | "sovereign";
export type SpireMechanic = "bulwark" | "regen" | "summon" | "enrage";

export interface SpireBossMeta {
    key: SpireBossKey;
    name: string;
    mechanic: SpireMechanic;
    /** short mechanic name shown as a tag */
    mechanicLabel: string;
    /** one-line tactical read of the fight */
    blurb: string;
    /** signature accent colour (drives portrait ring, name, glow) */
    accent: string;
    /** rgba glow used behind the portrait */
    glow: string;
    /** emoji fallback if the portrait art is missing */
    emoji: string;
}

// The four endgame bosses. Names + mechanics mirror SPIRE_BOSSES in the server catalog;
// accents are derived from each boss's theme (warden = molten steel, revenant = spectral,
// ravager = ember, sovereign = royal apex).
export const SPIRE_BOSS_META: Record<SpireBossKey, SpireBossMeta> = {
    warden: {
        key: "warden", name: "Spire Warden", mechanic: "bulwark", mechanicLabel: "Bulwark",
        blurb: "Halves damage while its guards stand — shatter the pod, then the wall.",
        accent: "#e8a54b", glow: "rgba(232,165,75,0.45)", emoji: "🐲",
    },
    revenant: {
        key: "revenant", name: "Hollow Revenant", mechanic: "regen", mechanicLabel: "Regeneration",
        blurb: "Knits itself whole each round — out-bleed the drain or stall forever.",
        accent: "#a78bfa", glow: "rgba(167,139,250,0.45)", emoji: "💀",
    },
    ravager: {
        key: "ravager", name: "Pit Ravager", mechanic: "summon", mechanicLabel: "Summoner",
        blurb: "Calls the pit at every phase — control the adds or drown in them.",
        accent: "#fb7185", glow: "rgba(251,113,133,0.45)", emoji: "😈",
    },
    sovereign: {
        key: "sovereign", name: "Spire Sovereign", mechanic: "enrage", mechanicLabel: "Enrage",
        blurb: "Grows deadlier as it falls — race the clock before it peaks.",
        accent: "#fbbf24", glow: "rgba(251,191,36,0.5)", emoji: "👑",
    },
};

// Boss per floor (index 0 = floor 1) — MUST match BOSS_BY_FLOOR in api/towers/_spire-catalog.ts.
// Sovereign anchors every milestone (5/10/15/20); the trio cycles the rest.
export const SPIRE_BOSS_BY_FLOOR: readonly SpireBossKey[] = [
    "warden", "revenant", "ravager", "warden", "sovereign",   // 1-5
    "revenant", "ravager", "warden", "revenant", "sovereign", // 6-10
    "warden", "revenant", "ravager", "warden", "sovereign",   // 11-15
    "warden", "revenant", "ravager", "revenant", "sovereign", // 16-20
];

export function spireBossForFloor(tier: number): SpireBossMeta {
    const key = SPIRE_BOSS_BY_FLOOR[Math.max(1, Math.min(SPIRE_MAX_TIER, Math.floor(tier))) - 1] ?? "sovereign";
    return SPIRE_BOSS_META[key];
}

// ── Difficulty bands — four ascending tiers of five, each capped by a Sovereign milestone. ──
export interface SpireBand { label: string; min: number; max: number; color: string; }
export const SPIRE_BANDS: readonly SpireBand[] = [
    { label: "Proving Grounds", min: 1, max: 5, color: "#4ade80" },   // green
    { label: "Challenger", min: 6, max: 10, color: "#38bdf8" },       // cyan
    { label: "Ascendant", min: 11, max: 15, color: "#a78bfa" },       // violet
    { label: "Infinite", min: 16, max: 20, color: "#fbbf24" },        // gold
];
export function spireBand(tier: number): SpireBand {
    return SPIRE_BANDS.find(b => tier >= b.min && tier <= b.max) ?? SPIRE_BANDS[SPIRE_BANDS.length - 1]!;
}

// ── Per-tier keystone unlocks — what's NEW on this floor (mirror of api/towers/_modifiers.ts
//    tier gates + the Wave-3 capstone emission). Purely for the pre-climb preview. ──
export interface SpireKeystoneUnlock {
    tier: number;
    name: string;
    /** the modifier family — drives the chip colour (matches the fight manifest palette) */
    kind: "hazard" | "debuff" | "healcut" | "extraPhase" | "objective" | "dualAugment";
    blurb: string;
}
export const SPIRE_KEYSTONE_UNLOCKS: readonly SpireKeystoneUnlock[] = [
    { tier: 9, name: "Rolling Cinders", kind: "hazard", blurb: "A column of fire sweeps the arena each round." },
    { tier: 10, name: "Sundered Guard", kind: "debuff", blurb: "Every enemy blow lands 10% harder." },
    { tier: 11, name: "Withering Aura", kind: "healcut", blurb: "Your healing is throttled by 30%." },
    { tier: 13, name: "Chain Lightning", kind: "hazard", blurb: "Arcs to any tile where your allies cluster." },
    { tier: 14, name: "Exposed", kind: "debuff", blurb: "+12% damage taken unless you hold a ward." },
    { tier: 15, name: "Second Wind", kind: "extraPhase", blurb: "The boss steels itself with an extra phase." },
    { tier: 17, name: "Sudden Death", kind: "objective", blurb: "Stall past the deadline and the floor collapses." },
    { tier: 18, name: "Cataclysm", kind: "dualAugment", blurb: "Hazard and vulnerability feed off each other." },
    { tier: 19, name: "Rising Inferno", kind: "hazard", blurb: "A central blaze whose bite grows every round." },
];
export function keystoneUnlockAt(tier: number): SpireKeystoneUnlock | undefined {
    return SPIRE_KEYSTONE_UNLOCKS.find(k => k.tier === tier);
}
/** Every keystone active AT OR BELOW this tier (cumulative) — the full gauntlet a floor carries. */
export function keystonesUpTo(tier: number): SpireKeystoneUnlock[] {
    return SPIRE_KEYSTONE_UNLOCKS.filter(k => k.tier <= tier);
}

// Manifest-chip palette by keystone kind — mirrors MODIFIER_CHIP_COLOR in BattleTowerFight.tsx
// so the pre-fight preview and the in-fight manifest read identically.
export const SPIRE_KEYSTONE_COLOR: Record<SpireKeystoneUnlock["kind"], string> = {
    hazard: "#fca5a5", debuff: "#d8b4fe", healcut: "#5eead4",
    extraPhase: "#fdba74", objective: "#7dd3fc", dualAugment: "#f0abfc",
};

// ── Milestone titles (mirror ACHIEVEMENT_TITLES / TITLE_ACHIEVEMENT_IDS spire-5/10/15/20). ──
export const SPIRE_MILESTONE_TITLES: Record<number, string> = {
    5: "Spire Ascendant", 10: "Spire Conqueror", 15: "Spire Vanquisher", 20: "Spire Immortal",
};

/** Fate Shards paid per new best tier this week (mirror SPIRE_SHARDS_PER_TIER server-side). */
export const SPIRE_SHARDS_PER_TIER = 2;

export interface SpireFloorMeta {
    tier: number;
    boss: SpireBossMeta;
    isMilestone: boolean;
    band: SpireBand;
    milestoneTitle?: string;
    keystone?: SpireKeystoneUnlock;
}
export function spireFloorMeta(tier: number): SpireFloorMeta {
    const t = Math.max(1, Math.min(SPIRE_MAX_TIER, Math.floor(tier)));
    const isMilestone = SPIRE_MILESTONE_FLOORS.includes(t);
    return {
        tier: t,
        boss: spireBossForFloor(t),
        isMilestone,
        band: spireBand(t),
        milestoneTitle: isMilestone ? SPIRE_MILESTONE_TITLES[t] : undefined,
        keystone: keystoneUnlockAt(t),
    };
}

/** All 20 floors, ready to render as a ladder. */
export function allSpireFloors(): SpireFloorMeta[] {
    return Array.from({ length: SPIRE_MAX_TIER }, (_, i) => spireFloorMeta(i + 1));
}

export { SPIRE_MAX_TIER, SPIRE_MILESTONE_FLOORS };
