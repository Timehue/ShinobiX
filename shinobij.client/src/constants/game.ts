/*
 * Game-wide constants — caps, IDs, API URLs, magic numbers that drive
 * the core systems.
 *
 * Grouped here (not scattered across App.tsx) so screens and helpers
 * can import canonical values without dragging the whole App import
 * surface. Pure values, no React, no closures.
 */

// ── API endpoints ────────────────────────────────────────────────────────
export const WORLD_STATE_API = "/api/world-state";
export const GAME_STATE_API = "/api/game-state";

// ── Territory / sector war ───────────────────────────────────────────────
export const TERRITORY_CONTROL_SCROLL_ID = "territory-control-scroll";
export const TERRITORY_CONTROL_MAX = 20000;
export const TERRITORY_HP_MAX = 20000;
export const TERRITORY_DAILY_WAR_SUPPLY = 100;
export const TERRITORY_SUPPLY_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Time-to-recapture after a sector's territory is destroyed.
export const TERRITORY_REBUILD_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours

// ── Character progression caps ───────────────────────────────────────────
export const MAX_LEVEL = 100;
export const MAX_STAT = 2500;
export const STARTING_STAT_POINTS = 20;
export const CHARACTER_XP_GAIN_MULTIPLIER: number = 3;
export const HP_CAP = 10000;
export const CHAKRA_CAP = 5000;
export const STAMINA_CAP = 5000;
// Used by the awakening / aura-sphere combat mechanic.
export const STUN_AP_PENALTY = 40;

// ── Jutsu training caps ──────────────────────────────────────────────────
export const JUTSU_MAX_LEVEL = 50;
export const JUTSU_TRAINING_CAP = 30;
// Mastery → jutsu DAMAGE ramp: an untrained jutsu deals this fraction of its
// fully-mastered damage, scaling linearly to 100% at JUTSU_MAX_LEVEL. The maxed
// value is unchanged, so endgame / max-mastery PvP balance is preserved — only
// under-leveled jutsu hit softer. Mirrored in api/pvp/move.ts (parity-pinned).
export const MASTERY_MIN_DAMAGE_FRAC = 0.3;

// ── Storage keys for localStorage ────────────────────────────────────────
export const STORAGE = "ninjav-admin-build-v1";
export const PLAYER_ACCOUNTS_STORAGE = "ninjav-player-accounts-v1";

// ── Special event / VN IDs ───────────────────────────────────────────────
export const AWAKENING_VN_ID = "builtin-awakening-lv2";
export const AURA_SPHERE_VN_ID = "builtin-aura-sphere-lv9";
export const AURA_SPHERE_ITEM_ID = "aura-sphere";
export const AWAKENING_FREE_LV2_ID = "awakening-free-lv2";
export const AWAKENING_FREE_LV20_ID = "awakening-free-lv20";
export const DUNGEON_VN_ID = "builtin-hidden-dungeon";
export const AWAKENING_ELEMENTS = ["Water", "Wind", "Earth", "Lightning", "Fire"] as const;

// ── Image upload cap ─────────────────────────────────────────────────────
// Animated avatars (GIF / APNG / animated WebP) are size-capped harder
// than static images so a player can't drop a 50 MB GIF into their save.
export const ANIMATED_MAX_MB = 2;

// ── Misc gameplay tuning ─────────────────────────────────────────────────
export const DAILY_MISSION_LIMIT = 20;
// Hunter Guild contracts have their own daily pool, separate from the
// mission limit above — a player gets 20 missions AND 20 hunts per day.
export const DAILY_HUNT_LIMIT = 20;

// ── Item IDs (special / shared) ──────────────────────────────────────────
export const WEEKLY_BOSS_CORE_ID = "weekly-boss-core";
export const DUNGEON_KEY_ID = "dungeon-key";
export const DUNGEON_LEGENDARY_RELIC_ID = "dungeon-legendary-relic";
export const DUNGEON_LEGENDARY_FRAGMENT_ID = "dungeon-legendary-fragment";
export const VEIL_OF_THE_HOLLOW_ID = "veil-of-the-hollow";
export const HOLLOW_GATE_KEY_ID = "hollow-gate-key";
export const WARFORGED_RELIC_ID = "warforged-relic";
export const LEGENDARY_WAR_CRATE_ID = "legendary-war-crate";
export const WAR_CRATE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const ADMIN_DELETED_ITEM_MARKER = "__ADMIN_DELETED_ITEM__";

// ── Protected admin identity ─────────────────────────────────────────────
// The Admin button is only visible to this username, the name is reserved
// server-side (no one else can register it), and the save survives server
// reset. Keep in sync with the same constant in api/_auth.ts.
export const PROTECTED_ADMIN_USERNAME = "Rill";

export function isProtectedAdminName(name: string | undefined | null): boolean {
    return !!name && name.trim().toLowerCase() === PROTECTED_ADMIN_USERNAME.toLowerCase();
}

// ── Hollow gate shrine grid dimensions ───────────────────────────────────
// Changing these mid-run would break saved layouts.
// 15×11 = 165 cells gives enough room for the BSP generator to carve 5-7
// distinct rooms of 3×3 to 4×5 connected by 1-tile corridors.
export const HOLLOW_GATE_SHRINE_W = 15;
export const HOLLOW_GATE_SHRINE_H = 11;

// How deep a shrine run goes before the Warden (boss) floor. Admin-tunable at
// runtime via setHollowGateMaxFloor (the AdminPanel). Lives here — not in App.tsx
// — so ./lib/hollow-gate-dungeon can read it without importing App (which would
// drag the whole module graph + index.css and make the generator untestable). An
// imported binding can't be reassigned cross-module, so the setter lives here
// beside the let; importers (App, AdminPanel, the dungeon generator) see the live
// value.
export let HOLLOW_GATE_MAX_FLOOR = 5;
export function setHollowGateMaxFloor(v: number) { HOLLOW_GATE_MAX_FLOOR = v; }

// Exam gates: players cannot level past these thresholds without passing the corresponding exam.
export const EXAM_LEVEL_GATES: { exam: string; level: number; label: string }[] = [
    { exam: "genin", level: 20, label: "Genin Exam" },
    { exam: "chunin", level: 39, label: "Chunin Exam" },
    // Jonin and Special Jonin exams do not block XP — players can reach level 100 freely.
];
