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

// Colour for the appointed-role badge shown on the roster (Founder appoints
// Leaders/Officers; everyone else is a Member). Keyed by ClanRole.
export const CLAN_ROLE_COLOR: Record<string, string> = {
    Founder: "#fde047",
    Leader: "#f59e0b",
    Officer: "#60a5fa",
    "Elite Member": "#c084fc",
    Member: "#94a3b8",
    Recruit: "#64748b",
};

export const CLAN_UPGRADE_MAX_LEVEL = 50;

// Clan mission objectives shown on the Clan Hall → Missions tab. Their key also
// selects the authored objective art in ClanMissionIcon; progress is computed by
// clanMissionProgress in lib/clan-math.ts. KEEP IN SYNC with
// api/clan/_mission-catalog.ts (targets, rewards); _mission-catalog.test.ts pins it.
export const clanMissionDefinitions = [
    { key: "battle", name: "Win 20 Battles", description: "Clan members combine for 20 battle wins.", target: 20, reward: "+450 Clan XP / +2,500 Treasury Ryo" },
    { key: "mission", name: "Complete 50 Missions", description: "Clan members combine for 50 mission completions.", target: 50, reward: "+650 Clan XP / +3,500 Treasury Ryo" },
    { key: "guard", name: "Build a Guard Roster of 10", description: "Reach a combined total of 10: guards in reward-active clan sectors plus clan members at level 5 or higher who won a clan battle or finished a mission this month.", target: 10, reward: "+500 Clan XP / +2,000 Treasury Ryo" },
    { key: "territory", name: "Claim Territory", description: "Capture and keep one reward-active clan sector.", target: 1, reward: "Prestige milestone (no item payout)" },
    { key: "anbu", name: "ANBU Recon Support", description: "Reach 10 recon points. Each guard in a reward-active clan sector adds 1 point; every 5 clan battle wins recorded this month add 1 point.", target: 10, reward: "+300 Clan XP" },
    { key: "donation", name: "Donate 25,000 Ryo", description: "Members donate 25,000 ryo to the clan treasury this month. Each donated Fate Shard, Bone Charm, Aura Stone or Mythic Seal counts as 1,000 ryo. Items do not count.", target: 25000, reward: "+700 Clan XP / +1 Aura Stone" },
    { key: "training", name: "Build 100 Activity Points", description: "Battle, mission, and event contributions recorded this month count toward this score. Each contribution adds 1.5 points, rounded down after totaling. No training timer is required.", target: 100, reward: "+600 Clan XP" },
    { key: "raid", name: "Earn 15 Event Contributions", description: "Every 3 clan event contributions recorded this month fill 1 of the 5 progress steps. Reach 15 contributions to complete the objective.", target: 5, reward: "+1,350 Clan XP" },
] as const;

// ── Clan war (CW) tables ─────────────────────────────────────────────────
// CwChallengeMode union duplicated locally; keep in sync with the same
// type in App.tsx. Moves to types/clan-war.ts in a future pass.
type CwChallengeMode = "pvp1v1" | "pvp2v2" | "pet1v1" | "pet2v2" | "tilecards";

/** Player-admitted modes; shinobi 2v2 stays typed for retained record cleanup. */
export const CW_ADMITTED_CHALLENGE_MODES = ["pvp1v1", "pvp2v2", "pet1v1", "pet2v2", "tilecards"] as const satisfies readonly CwChallengeMode[];

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
    tilecards: "Chronicle Showdown",
};

export const CW_MODE_ICON: Record<CwChallengeMode, string> = {
    pvp1v1: "⚔",
    pvp2v2: "⚔⚔",
    pet1v1: "🐾",
    pet2v2: "🐾🐾",
    tilecards: "🃏",
};
