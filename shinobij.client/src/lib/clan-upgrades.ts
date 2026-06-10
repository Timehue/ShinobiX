/*
 * Clan upgrade tree — cost + effect tables and pure helpers.
 *
 * The clan upgrade buildings (ClanUpgradeKey) were scaffolded long ago
 * (types/clan.ts + clan-math.ts defaults/clean) but were inert: nothing was
 * purchasable and clanUpgradeBonus() only ever returned the roster-size boost
 * for two keys. This module makes the tree real: a per-building cost curve, a
 * per-level effect magnitude, and the Scout Network recon tiers.
 *
 * ALL numbers here are intentionally centralised + conservative so balance is
 * reviewable in one place and tunable without touching call sites. Effects are
 * ADDITIVE and CAPPED — no existing reward rate / combat formula is rewritten.
 * Purchases are server-authoritative (api/clan/upgrade/purchase.ts); this file
 * only describes costs/effects and is imported by both the client UI and the
 * pure clan-math helpers.
 */

import { CLAN_UPGRADE_MAX_LEVEL } from "../constants/clan";
import type { ClanUpgradeKey } from "../types/clan";

export type ClanUpgradeCategory = "economy" | "qol" | "war" | "recon";

export type ClanUpgradeDef = {
    key: ClanUpgradeKey;
    name: string;
    icon: string;
    /** One-line description of what the building does. */
    desc: string;
    category: ClanUpgradeCategory;
    /**
     * Percent-point effect added PER LEVEL, and the cap at max level. A purely
     * informational building (Scout Network) carries 0 here and exposes its
     * effect through scoutIntelTier() instead.
     */
    perLevelPercent: number;
    maxPercent: number;
    /** Human-readable effect summary at a given level (for the UI). */
    effectLabel: (level: number) => string;
};

// ── Cost curve ───────────────────────────────────────────────────────────
// Cost to go from `currentLevel` → `currentLevel + 1`. Linear ramp so early
// levels are cheap and a maxed building is a long-term clan goal. Funded from
// the clan treasury (ryo) + the otherwise-sinkless warSupply (the territory
// resource that previously had nowhere to go).
const COST_RYO_PER_STEP = 2_500;
const COST_WAR_SUPPLY_PER_STEP = 5;

export function clanUpgradeCost(currentLevel: number): { ryo: number; warSupply: number } {
    const step = Math.max(0, Math.floor(currentLevel)) + 1;
    return { ryo: COST_RYO_PER_STEP * step, warSupply: COST_WAR_SUPPLY_PER_STEP * step };
}

export function isClanUpgradeMaxed(level: number): boolean {
    return Math.floor(level) >= CLAN_UPGRADE_MAX_LEVEL;
}

// ── War Room (the one war-balance knob) ────────────────────────────────────
// Flat clan-war HP added to the 1000 base, +2 per level → +100 at level 50
// (= +10%). Kept flat + small + capped so it's a "modest war effect" rather
// than a runaway advantage. Applied at clan-war-declare time when the war HP
// pool is seeded.
export const WAR_ROOM_HP_PER_LEVEL = 2;
export function warRoomBonusHp(level: number): number {
    return Math.max(0, Math.floor(level)) * WAR_ROOM_HP_PER_LEVEL;
}

// ── Scout Network (recon tiers, not a percent) ─────────────────────────────
// During an ACTIVE clan war, the world map paints a red dot on each sector
// holding an enemy-clan member who is out in the world (hidden while they sit
// safe in the village). Higher tiers reveal more about each scouted enemy.
//   tier 0 — no intel (building not built)
//   tier 1 — enemy positions (red dots by sector)
//   tier 2 — + enemy level
//   tier 3 — + enemy name
export const SCOUT_TIER_LEVELS = { positions: 1, level: 15, detail: 30 } as const;
export function scoutIntelTier(level: number): 0 | 1 | 2 | 3 {
    const lvl = Math.max(0, Math.floor(level));
    if (lvl >= SCOUT_TIER_LEVELS.detail) return 3;
    if (lvl >= SCOUT_TIER_LEVELS.level) return 2;
    if (lvl >= SCOUT_TIER_LEVELS.positions) return 1;
    return 0;
}

// ── Building definitions ───────────────────────────────────────────────────
// Order here is the display order in the Clan Hall → Upgrades tab.
export const CLAN_UPGRADE_DEFS: ClanUpgradeDef[] = [
    {
        key: "trainingGrounds",
        name: "Training Grounds",
        icon: "🥋",
        desc: "Clan members earn more XP from stat training.",
        category: "economy",
        perLevelPercent: 0.2,
        maxPercent: 10,
        effectLabel: (lvl) => `+${(0.2 * lvl).toFixed(1)}% training XP`,
    },
    {
        key: "petDen",
        name: "Pet Den",
        icon: "🐾",
        desc: "Members earn more pet XP from pet training.",
        category: "economy",
        perLevelPercent: 0.3,
        maxPercent: 15,
        effectLabel: (lvl) => `+${(0.3 * lvl).toFixed(1)}% pet training XP`,
    },
    {
        key: "medicalWing",
        name: "Medical Wing",
        icon: "⛑️",
        desc: "Members pay less for hospital healing.",
        category: "qol",
        perLevelPercent: 0.3,
        maxPercent: 15,
        effectLabel: (lvl) => `-${(0.3 * lvl).toFixed(1)}% hospital cost`,
    },
    {
        key: "blacksmith",
        name: "Blacksmith",
        icon: "🔨",
        desc: "Members pay less when buying gear at the village shop.",
        category: "economy",
        perLevelPercent: 0.2,
        maxPercent: 10,
        effectLabel: (lvl) => `-${(0.2 * lvl).toFixed(1)}% shop cost`,
    },
    {
        key: "treasury",
        name: "Treasury Vault",
        icon: "🏦",
        desc: "Owned sectors generate more War Supply for the clan.",
        category: "economy",
        perLevelPercent: 0.2,
        maxPercent: 10,
        effectLabel: (lvl) => `+${(0.2 * lvl).toFixed(1)}% War Supply collection`,
    },
    {
        key: "warRoom",
        name: "War Room",
        icon: "⚔️",
        desc: "Adds to your clan's HP pool when a clan war is declared.",
        category: "war",
        // War Room's effect is a FLAT HP add (warRoomBonusHp), not a percent —
        // perLevelPercent/maxPercent are unused for this key.
        perLevelPercent: 0,
        maxPercent: 0,
        effectLabel: (lvl) => `+${warRoomBonusHp(lvl)} clan-war HP`,
    },
    {
        key: "scoutNetwork",
        name: "Scout Network",
        icon: "🔭",
        desc: "Reveals enemy-clan members out in the world during a clan war.",
        category: "recon",
        perLevelPercent: 0,
        maxPercent: 0,
        effectLabel: (lvl) => {
            const tier = scoutIntelTier(lvl);
            if (tier >= 3) return "Enemy positions, level & name";
            if (tier === 2) return "Enemy positions & level";
            if (tier === 1) return "Enemy positions (red dots)";
            return "Locked — reach level 1";
        },
    },
];

export const CLAN_UPGRADE_DEF_BY_KEY: Record<ClanUpgradeKey, ClanUpgradeDef> =
    CLAN_UPGRADE_DEFS.reduce((acc, def) => { acc[def.key] = def; return acc; }, {} as Record<ClanUpgradeKey, ClanUpgradeDef>);

/**
 * Percent-point effect of a building at a given level. Returns 0 for the
 * flat-HP / recon buildings (War Room, Scout Network), which expose their
 * effects through warRoomBonusHp() / scoutIntelTier() instead.
 */
export function clanUpgradeEffectPercent(key: ClanUpgradeKey, level: number): number {
    const def = CLAN_UPGRADE_DEF_BY_KEY[key];
    if (!def || def.perLevelPercent <= 0) return 0;
    const lvl = Math.max(0, Math.floor(level));
    return Math.min(def.maxPercent, def.perLevelPercent * lvl);
}
