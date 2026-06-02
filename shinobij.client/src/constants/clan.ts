/*
 * Clan + clan-war (CW) lookup tables.
 *
 * Pure data. The clan-membership math + war-state mutation logic stays
 * in App.tsx (those reference closures); these are just the colour /
 * icon / label / damage-per-mode tables.
 */

// Clan rank derived from membership index — see clanRankFromMemberIndex
// in App.tsx for the index → label mapping.
export const CLAN_RANK_COLOR: Record<string, string> = {
    "Clan Head": "#fde047",
    "Clan Elder": "#c084fc",
    "Clan Enforcer": "#60a5fa",
    "Clan Shinobi": "#4ade80",
    "Clan Initiate": "#64748b",
};

export const CLAN_RANK_ICON: Record<string, string> = {
    "Clan Head": "🌟",
    "Clan Elder": "🏯",
    "Clan Enforcer": "⚔",
    "Clan Shinobi": "🥷",
    "Clan Initiate": "🌱",
};

// Clan role icons keyed by ClanRole. Duplicated as Record<string, string>
// so this file doesn't need to import ClanRole (which is buried in
// App.tsx still). The runtime keys must match the ClanRole union.
export const CLAN_ROLE_ICON: Record<string, string> = {
    Founder: "⛩",
    Leader: "👑",
    Officer: "🎖",
    "Elite Member": "💎",
    Member: "🛡",
    Recruit: "📜",
};

export const CLAN_UPGRADE_MAX_LEVEL = 50;

// Clan mission objectives shown on the Clan Hall → Missions tab. Pure content;
// progress is computed by clanMissionProgress in App.tsx (keyed by `key`).
export const clanMissionDefinitions = [
    { key: "battle", icon: "⚔", name: "Win 20 Battles", description: "Clan members combine for 20 battle wins.", target: 20, reward: "+450 Clan XP / +2,500 Treasury Ryo" },
    { key: "mission", icon: "📜", name: "Complete 50 Missions", description: "Clan members combine for 50 mission completions.", target: 50, reward: "+650 Clan XP / +3,500 Treasury Ryo" },
    { key: "guard", icon: "🛡", name: "Defend Village 10 Times", description: "Keep village guard pressure active and defend the village.", target: 10, reward: "+500 Clan XP / +2,000 Treasury Ryo" },
    { key: "territory", icon: "🏴", name: "Claim Territory", description: "Collect Territory Control Scrolls and donate them to a sector your clan wants to own.", target: 20, reward: "+1 Sector claim push" },
    { key: "anbu", icon: "🥷", name: "ANBU Recon Support", description: "Coordinate with ANBU scouts, sector guards, and raid defense missions.", target: 10, reward: "+300 Clan XP / intel advantage" },
    { key: "donation", icon: "💰", name: "Donate 25,000 Ryo", description: "Grow the clan treasury through member donations.", target: 25000, reward: "+700 Clan XP / +1 Aura Stone" },
    { key: "training", icon: "💪", name: "Train 100 Hours", description: "Long-term clan discipline objective.", target: 100, reward: "+600 Clan XP" },
    { key: "raid", icon: "🗡", name: "Defeat 5 Raid Bosses", description: "Raid contribution objective for future PvE events.", target: 5, reward: "+900 Clan XP / +1 Mythic Seal" },
] as const;

// ── Clan war (CW) tables ─────────────────────────────────────────────────
// CwChallengeMode union duplicated locally; keep in sync with the same
// type in App.tsx. Moves to types/clan-war.ts in a future pass.
type CwChallengeMode = "pvp1v1" | "pvp2v2" | "pet1v1" | "pet2v2" | "tilecards";

export const CW_HP_MAX = 1000;

// Damage dealt to the opposing clan's war HP for each completed
// challenge by mode.
export const CW_DAMAGE: Record<CwChallengeMode, number> = {
    pvp1v1: 30,
    pvp2v2: 60,
    pet1v1: 20,
    pet2v2: 40,
    tilecards: 10,
};

export const CW_MODE_LABEL: Record<CwChallengeMode, string> = {
    pvp1v1: "1v1 PvP",
    pvp2v2: "2v2 PvP",
    pet1v1: "Pet 1v1",
    pet2v2: "Pet 2v2",
    tilecards: "Tile Cards",
};

export const CW_MODE_ICON: Record<CwChallengeMode, string> = {
    pvp1v1: "⚔",
    pvp2v2: "⚔⚔",
    pet1v1: "🐾",
    pet2v2: "🐾🐾",
    tilecards: "🃏",
};
