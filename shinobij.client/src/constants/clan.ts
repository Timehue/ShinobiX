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
