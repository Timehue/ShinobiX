/*
 * Hunter rank progression tables + UI lookups.
 *
 * Hunter rank is a separate progression axis from Profession Rank — it
 * tracks how many bounty-board missions the player has completed and
 * gates access to harder S/A/B-rank hunts.
 *
 * Pure data. Extracted from App.tsx. MissionRank type re-exported here
 * because HUNT_MIN_RANK keys it; App.tsx still owns the canonical
 * declaration for now and imports from here on the type side.
 */

// Local mission-rank union — kept in sync with the same type in App.tsx
// (it ultimately moves into types/mission.ts in a future pass).
export type MissionRank = "Daily" | "D Rank" | "C Rank" | "B Rank" | "A Rank" | "S Rank";

export const HUNTER_RANK_LABELS: ReadonlyArray<string> = [
    "Novice Hunter",
    "Tracker",
    "Beast Slayer",
    "Monster Hunter",
    "Elite Huntsman",
    "Chakra Beast Warden",
];

export const HUNTER_RANK_COLORS: ReadonlyArray<string> = [
    "#22c55e",
    "#3b82f6",
    "#a855f7",
    "#f97316",
    "#ef4444",
    "#facc15",
];

// Minimum hunter rank required to ACCEPT a hunt of a given mission rank.
// Daily and D-Rank are open to everyone; higher ranks require climbing.
export const HUNT_MIN_RANK: Record<MissionRank, number> = {
    "Daily": 0,
    "D Rank": 0,
    "C Rank": 1,
    "B Rank": 2,
    "A Rank": 3,
    "S Rank": 4,
};

// Materials + counts needed to rank up. Index = current rank (0..4),
// turns into rank N+1 on craft.
export const HUNTER_RANKUP: ReadonlyArray<{ itemId: string; qty: number }> = [
    { itemId: "hunt-beast-meat", qty: 5 },
    { itemId: "hunt-wolf-fang", qty: 5 },
    { itemId: "hunt-ash-scale", qty: 5 },
    { itemId: "hunt-shadow-pelt", qty: 5 },
    { itemId: "hunt-legendary-material", qty: 3 },
];

export const HUNT_MATERIAL_NAMES: Record<string, string> = {
    "hunt-beast-meat": "Beast Meat",
    "hunt-wolf-fang": "Wolf Fang",
    "hunt-ash-scale": "Ash Scale",
    "hunt-shadow-pelt": "Shadow Pelt",
    "hunt-legendary-material": "Legendary Material",
};
