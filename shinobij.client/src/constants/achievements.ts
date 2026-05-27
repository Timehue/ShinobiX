/*
 * Achievement table. Each row is a (predicate → unlocked) entry the
 * achievement-grant pass runs on the player's character. Categories
 * group them in the UI; `hidden` flags secrets that only appear after
 * unlock.
 *
 * Pure data + pure predicates — no closures, no React. Predicates
 * receive a Character and return boolean.
 *
 * Extracted from App.tsx.
 */

import type { Character } from "../types/character";
import { MAX_LEVEL } from "./game";

export type AchievementCategory =
    | "Progression" | "Combat" | "PvP" | "Ranked" | "Missions"
    | "Exploration" | "Wealth" | "Aura" | "Village" | "Trials"
    | "Clan" | "Bloodline";

export type Achievement = {
    id: string;
    name: string;
    desc: string;
    category: AchievementCategory;
    icon: string;
    hidden?: boolean;
    check: (c: Character) => boolean;
};

export const ACHIEVEMENTS: ReadonlyArray<Achievement> = [
    // Progression
    { id: "level-10",  name: "Genin Initiate",   desc: "Reach level 10.",      category: "Progression", icon: "🥋", check: c => c.level >= 10 },
    { id: "level-40",  name: "Chunin Ascendant", desc: "Reach level 40.",      category: "Progression", icon: "🎖", check: c => c.level >= 40 },
    { id: "level-70",  name: "Jonin's Path",     desc: "Reach level 70.",      category: "Progression", icon: "🗡", check: c => c.level >= 70 },
    { id: "level-100", name: "Centenarian",      desc: "Reach max level 100.", category: "Progression", icon: "👑", check: c => c.level >= MAX_LEVEL },

    // PvE Combat
    { id: "pve-first", name: "First Blood",        desc: "Defeat your first AI opponent.", category: "Combat", icon: "🩸", check: c => (c.totalAiKills ?? 0) >= 1 },
    { id: "pve-100",   name: "Skirmisher",         desc: "Defeat 100 AI opponents.",       category: "Combat", icon: "⚔️", check: c => (c.totalAiKills ?? 0) >= 100 },
    { id: "pve-500",   name: "Bladebreaker",       desc: "Defeat 500 AI opponents.",       category: "Combat", icon: "🗡", check: c => (c.totalAiKills ?? 0) >= 500 },
    { id: "pve-2500",  name: "Slayer of Thousands",desc: "Defeat 2,500 AI opponents.",     category: "Combat", icon: "💀", check: c => (c.totalAiKills ?? 0) >= 2500 },

    // PvP
    { id: "pvp-first", name: "Duelist",           desc: "Win your first PvP duel.", category: "PvP", icon: "🤺", check: c => (c.totalPvpKills ?? 0) >= 1 },
    { id: "pvp-50",    name: "Bloodsport",        desc: "Defeat 50 players.",       category: "PvP", icon: "🔥", check: c => (c.totalPvpKills ?? 0) >= 50 },
    { id: "pvp-250",   name: "Warlord",           desc: "Defeat 250 players.",      category: "PvP", icon: "⚔️", check: c => (c.totalPvpKills ?? 0) >= 250 },
    { id: "pvp-1000",  name: "Crimson Sovereign", desc: "Defeat 1,000 players.",    category: "PvP", icon: "👹", check: c => (c.totalPvpKills ?? 0) >= 1000 },

    // Ranked
    { id: "ranked-first", name: "Ranked Initiate", desc: "Win your first ranked match.", category: "Ranked", icon: "🏅", check: c => (c.rankedWins ?? 0) >= 1 },
    { id: "ranked-50",    name: "Iron Climber",    desc: "Win 50 ranked matches.",       category: "Ranked", icon: "🛡", check: c => (c.rankedWins ?? 0) >= 50 },
    { id: "ranked-1800",  name: "Tempered Steel",  desc: "Reach 1,800 ranked rating.",   category: "Ranked", icon: "⚜️", check: c => (c.rankedRating ?? 0) >= 1800 },
    { id: "ranked-2200",  name: "Apex Predator",   desc: "Reach 2,200 ranked rating.",   category: "Ranked", icon: "🦅", check: c => (c.rankedRating ?? 0) >= 2200 },

    // Missions
    { id: "mission-25",   name: "Errand Runner",     desc: "Complete 25 missions.",    category: "Missions", icon: "📜", check: c => (c.totalMissionsCompleted ?? 0) >= 25 },
    { id: "mission-250",  name: "Dedicated Shinobi", desc: "Complete 250 missions.",   category: "Missions", icon: "🗺", check: c => (c.totalMissionsCompleted ?? 0) >= 250 },
    { id: "mission-1000", name: "Mission Master",    desc: "Complete 1,000 missions.", category: "Missions", icon: "🏯", check: c => (c.totalMissionsCompleted ?? 0) >= 1000 },

    // Exploration
    { id: "explore-100",  name: "Wanderer",     desc: "Explore 100 sectors.",   category: "Exploration", icon: "🌲", check: c => (c.totalTilesExplored ?? 0) >= 100 },
    { id: "explore-1000", name: "Cartographer", desc: "Explore 1,000 sectors.", category: "Exploration", icon: "🧭", check: c => (c.totalTilesExplored ?? 0) >= 1000 },
    { id: "explore-5000", name: "World Walker", desc: "Explore 5,000 sectors.", category: "Exploration", icon: "🌍", check: c => (c.totalTilesExplored ?? 0) >= 5000 },

    // Wealth
    { id: "ryo-25k",   name: "Pocket Coin",   desc: "Carry 25,000 ryo.",                          category: "Wealth", icon: "💰", check: c => c.ryo >= 25000 },
    { id: "ryo-500k",  name: "Vault Keeper",  desc: "Bank 500,000 ryo.",                          category: "Wealth", icon: "🏦", check: c => c.bankRyo >= 500000 },
    { id: "ryo-5m",    name: "Ryo Tycoon",    desc: "Accumulate 5,000,000 ryo (wallet + bank).",  category: "Wealth", icon: "💎", check: c => (c.ryo + c.bankRyo) >= 5000000 },
    { id: "honor-100", name: "Honor Bound",   desc: "Earn 100 Honor Seals.",                      category: "Wealth", icon: "🛡", check: c => (c.honorSeals ?? 0) >= 100 },
    { id: "honor-500", name: "Sealed Legend", desc: "Earn 500 Honor Seals.",                      category: "Wealth", icon: "🏆", check: c => (c.honorSeals ?? 0) >= 500 },
    { id: "fate-250",  name: "Fated One",     desc: "Hold 250 Fate Shards.",                      category: "Wealth", icon: "🔮", check: c => (c.fateShards ?? 0) >= 250 },
    { id: "fate-2500", name: "Fate Weaver",   desc: "Hold 2,500 Fate Shards.",                    category: "Wealth", icon: "🌌", check: c => (c.fateShards ?? 0) >= 2500 },

    // Aura
    { id: "aura-1",   name: "Spark",        desc: "Awaken your Aura Sphere.",        category: "Aura", icon: "✨", check: c => (c.auraSphereLevel ?? 0) >= 1 },
    { id: "aura-150", name: "Inner Light",  desc: "Raise your Aura Sphere to 150.",  category: "Aura", icon: "🌟", check: c => (c.auraSphereLevel ?? 0) >= 150 },
    { id: "aura-300", name: "Eternal Aura", desc: "Achieve an Eternal Aura Sphere.", category: "Aura", icon: "☀️", check: c => (c.auraSphereLevel ?? 0) >= 300 },

    // Village raids
    { id: "raid-25",  name: "Raider",          desc: "Complete 25 village raids.",  category: "Village", icon: "🏴", check: c => (c.totalVillageRaids ?? 0) >= 25 },
    { id: "raid-250", name: "Village Scourge", desc: "Complete 250 village raids.", category: "Village", icon: "🔥", check: c => (c.totalVillageRaids ?? 0) >= 250 },

    // Trials
    { id: "tournament-3", name: "Arena Champion", desc: "Win 3 tournaments.",          category: "Trials", icon: "🏆", check: c => (c.totalTournamentsCompleted ?? 0) >= 3 },
    { id: "tower-25",     name: "Tower Survivor", desc: "Win 25 Endless Tower runs.",  category: "Trials", icon: "🗼", check: c => (c.totalEndlessTowerWins ?? 0) >= 25 },
    { id: "pet-100",      name: "Beast Tamer",    desc: "Win 100 pet battles.",        category: "Trials", icon: "🐺", check: c => (c.totalPetWins ?? 0) >= 100 },

    // Bloodline
    { id: "bloodline-equipped", name: "Bloodline Awakened", desc: "Equip a bloodline.", category: "Bloodline", icon: "🩸", check: c => !!c.equippedBloodlineId },

    // Clan
    { id: "clan-founder", name: "Clan Founder", desc: "Found your own clan.",                       category: "Clan", icon: "⛩", check: c => c.clanFounder === true },
    { id: "clan-500",     name: "Clan Patriot", desc: "Earn 500 clan battle contribution points.",  category: "Clan", icon: "🎌", check: c => (c.clanBattleContrib ?? 0) >= 500 },

    // ─── Hidden / Secret ─────────────────────────────────────────────
    { id: "secret-untouched",        name: "Untouched Vault",   desc: "Carry 1,000,000+ ryo without depositing any.",  category: "Wealth",     icon: "🪙", hidden: true, check: c => c.ryo >= 1000000 && c.bankRyo === 0 },
    { id: "secret-charms-100",       name: "Bone Hoarder",      desc: "Hold 100 Bone Charms at once.",                 category: "Wealth",     icon: "🪬", hidden: true, check: c => (c.boneCharms ?? 0) >= 100 },
    { id: "secret-stones-100",       name: "Crystal Hoarder",   desc: "Hold 100 Aura Stones at once.",                 category: "Wealth",     icon: "💠", hidden: true, check: c => (c.auraStones ?? 0) >= 100 },
    { id: "secret-mythic-10",        name: "Mythic Seeker",     desc: "Hold 10 Mythic Seals at once.",                 category: "Wealth",     icon: "🔱", hidden: true, check: c => (c.mythicSeals ?? 0) >= 10 },
    { id: "secret-packrat",          name: "Packrat",           desc: "Carry 100+ items in your inventory.",           category: "Wealth",     icon: "🎒", hidden: true, check: c => c.inventory.length >= 100 },
    { id: "secret-loadout-full",     name: "Full Arsenal",      desc: "Equip all 15 jutsu slots simultaneously.",      category: "Combat",     icon: "📿", hidden: true, check: c => c.equippedJutsuIds.length >= 15 },
    { id: "secret-monthly-50",       name: "Monthly Reaper",    desc: "Earn 50 PvP kills in a single month.",          category: "PvP",        icon: "🌑", hidden: true, check: c => (c.monthlyPvpKills ?? 0) >= 50 },
    { id: "secret-hunter-5",         name: "Bounty Hunter",     desc: "Reach hunter rank 5.",                          category: "Trials",     icon: "🏹", hidden: true, check: c => (c.hunterRank ?? 0) >= 5 },
    { id: "secret-titled",           name: "Self-Named",        desc: "Earn the right to set a custom title.",         category: "Progression",icon: "📛", hidden: true, check: c => !!c.customTitle },
    { id: "secret-story-titled",     name: "The Storied",       desc: "Earn a title through the main story.",          category: "Progression",icon: "📖", hidden: true, check: c => !!c.storyTitle },
    { id: "secret-bestiary-50",      name: "Bestiary",          desc: "Defeat 50 unique AI opponents.",                category: "Combat",     icon: "🐉", hidden: true, check: c => (c.defeatedAiIds?.length ?? 0) >= 50 },
    { id: "secret-bestiary-200",     name: "Encyclopedia",      desc: "Defeat 200 unique AI opponents.",               category: "Combat",     icon: "📚", hidden: true, check: c => (c.defeatedAiIds?.length ?? 0) >= 200 },
    { id: "secret-elements-3",       name: "Polyelementalist",  desc: "Awaken 3 or more elements.",                    category: "Bloodline",  icon: "🜂", hidden: true, check: c => (c.elements?.length ?? 0) >= 3 },
    { id: "secret-menagerie-5",      name: "Menagerie",         desc: "Tame 5 or more pets.",                          category: "Trials",     icon: "🦊", hidden: true, check: c => (c.pets?.length ?? 0) >= 5 },
    { id: "secret-exams-3",          name: "Trial Walker",      desc: "Pass 3 or more rank exams.",                    category: "Progression",icon: "🎓", hidden: true, check: c => (c.examsPassed?.length ?? 0) >= 3 },
    { id: "secret-war-vet-50",       name: "War Veteran",       desc: "Complete 50 village war missions.",             category: "Village",    icon: "⚔️", hidden: true, check: c => (c.villageWarMissionsCompleted ?? 0) >= 50 },
    { id: "secret-weekly-bosses-5",  name: "Weekly Reaper",     desc: "Defeat 5 distinct weekly bosses.",              category: "Combat",     icon: "👺", hidden: true, check: c => Object.keys(c.weeklyBossKills ?? {}).length >= 5 },
    { id: "secret-tile-cards-1000",  name: "Tile Collector",    desc: "Collect 1,000 tile cards.",                     category: "Exploration",icon: "🀄", hidden: true, check: c => c.tileCards.length >= 1000 },
    { id: "secret-minmaxer",         name: "Min-Maxer",         desc: "Reach level 50+ with zero unspent stat points.",category: "Progression",icon: "🧮", hidden: true, check: c => c.level >= 50 && c.unspentStats === 0 },
    { id: "secret-war-crates-10",    name: "Salvager",          desc: "Claim 10 war crates.",                          category: "Village",    icon: "📦", hidden: true, check: c => (c.claimedWarCrateIds?.length ?? 0) >= 10 },
];
