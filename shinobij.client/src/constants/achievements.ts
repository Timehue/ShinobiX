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
import { totalItemCount } from "../lib/inventory";

export type AchievementCategory =
    | "Progression" | "Combat" | "PvP" | "Ranked" | "Missions"
    | "Exploration" | "Wealth" | "Aura" | "Village" | "Trials"
    | "Clan" | "Bloodline" | "Story" | "Jutsu" | "Professions"
    | "Pets" | "Hollow Gate" | "Chronicle" | "Crafting" | "Legacy"
    | "Tournament" | "Meta";

export type AchievementProgress = {
    current: number;
    target: number;
    label?: string;
};

export const ACHIEVEMENT_CATEGORY_ORDER: readonly AchievementCategory[] = [
    "Progression", "Story", "Jutsu", "Professions", "Combat", "PvP", "Ranked", "Tournament",
    "Missions", "Exploration", "Hollow Gate", "Trials", "Pets", "Chronicle", "Crafting",
    "Bloodline", "Aura", "Clan", "Village", "Wealth", "Legacy", "Meta",
];

export type Achievement = {
    id: string;
    name: string;
    desc: string;
    category: AchievementCategory;
    icon: string;
    hidden?: boolean;
    check: (c: Character) => boolean;
    progress?: (c: Character) => AchievementProgress;
};

const whole = (value: unknown): number => Math.max(0, Math.floor(Number(value) || 0));
const count = (value: unknown): number => Array.isArray(value) ? value.length : 0;
const numericProgress = (current: unknown, target: number, label?: string): AchievementProgress => ({
    current: Math.min(target, whole(current)),
    target,
    label,
});
const arrayProgress = (value: unknown, target: number, label?: string): AchievementProgress =>
    numericProgress(count(value), target, label);
const objectValueTotal = (value: unknown): number => value && typeof value === "object"
    ? Object.values(value as Record<string, unknown>).reduce<number>((sum, entry) => sum + whole(entry), 0)
    : 0;
const jutsuAtLevel = (c: Character, level: number): number =>
    (c.jutsuMastery ?? []).filter((entry) => whole(entry.level) >= level).length;
const petsAtOrAboveLevel = (c: Character, level: number): number =>
    (c.pets ?? []).filter((pet) => whole(pet.level) >= level).length;
const evolvedPetsAtStage = (c: Character, stage: number): number =>
    (c.pets ?? []).filter((pet) => whole(pet.evolutionStage) >= stage).length;
const uniqueCardCount = (c: Character): number => new Set(c.tileCards ?? []).size;
const coreEquipmentCount = (c: Character): number =>
    ["hand", "gloves", "body", "waist", "legs", "feet", "head", "thrown"]
        .filter((slot) => Boolean(c.equipment?.[slot as keyof Character["equipment"]])).length;

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
    { id: "ranked-season-champ", name: "Season Champion", desc: "Finish #1 on a ranked ladder when the season ends.", category: "Ranked", icon: "👑", check: c => (c.rankedSeasonsWon ?? 0) >= 1, progress: c => numericProgress(c.rankedSeasonsWon, 1, "season victories") },

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
    { id: "tournament-3", name: "Arena Champion", desc: "Win 3 tournaments.",          category: "Tournament", icon: "🏆", check: c => (c.totalTournamentsCompleted ?? 0) >= 3, progress: c => numericProgress(c.totalTournamentsCompleted, 3, "tournament wins") },
    { id: "tower-25",     name: "Tower Survivor", desc: "Win 25 Endless Tower runs.",  category: "Trials", icon: "🗼", check: c => (c.totalEndlessTowerWins ?? 0) >= 25 },
    // Endless Spire milestones — a wearable-title chase up the ascension ladder (floors 5/10/15/20).
    { id: "spire-5",      name: "Spire Ascendant", desc: "Ascend to Endless Spire floor 5.",  category: "Trials", icon: "🗼", check: c => (c.battleTowerAscension ?? 0) >= 5 },
    { id: "spire-10",     name: "Spire Conqueror", desc: "Ascend to Endless Spire floor 10.", category: "Trials", icon: "⚔️", check: c => (c.battleTowerAscension ?? 0) >= 10 },
    { id: "spire-15",     name: "Spire Vanquisher",desc: "Ascend to Endless Spire floor 15.", category: "Trials", icon: "🔥", check: c => (c.battleTowerAscension ?? 0) >= 15 },
    { id: "spire-20",     name: "Spire Immortal",  desc: "Conquer the Endless Spire — floor 20.", category: "Trials", icon: "👑", check: c => (c.battleTowerAscension ?? 0) >= 20 },
    { id: "pet-100",      name: "Beast Tamer",    desc: "Win 100 pet battles.",        category: "Trials", icon: "🐺", check: c => (c.totalPetWins ?? 0) >= 100 },

    // Bloodline
    { id: "bloodline-equipped", name: "Bloodline Awakened", desc: "Equip a bloodline.", category: "Bloodline", icon: "🩸", check: c => !!c.equippedBloodlineId },

    // Clan
    { id: "clan-founder", name: "Clan Founder", desc: "Found your own clan.",                       category: "Clan", icon: "⛩", check: c => c.clanFounder === true },
    { id: "clan-500",     name: "Clan Patriot", desc: "Earn 500 clan battle contribution points.",  category: "Clan", icon: "🎌", check: c => (c.clanBattleContrib ?? 0) >= 500 },

    // Training & jutsu mastery
    { id: "training-first", name: "First Form", desc: "Complete your first stat training point.", category: "Jutsu", icon: "🥋", check: c => whole(c.totalStatsTrained) >= 1, progress: c => numericProgress(c.totalStatsTrained, 1, "stats trained") },
    { id: "training-100", name: "Tempered Body", desc: "Train 100 total stat points.", category: "Jutsu", icon: "💪", check: c => whole(c.totalStatsTrained) >= 100, progress: c => numericProgress(c.totalStatsTrained, 100, "stats trained") },
    { id: "training-1000", name: "Iron Discipline", desc: "Train 1,000 total stat points.", category: "Jutsu", icon: "🗿", check: c => whole(c.totalStatsTrained) >= 1000, progress: c => numericProgress(c.totalStatsTrained, 1000, "stats trained") },
    { id: "jutsu-mastery-10", name: "Practiced Hand", desc: "Raise one jutsu to mastery 10.", category: "Jutsu", icon: "📜", check: c => jutsuAtLevel(c, 10) >= 1, progress: c => numericProgress(jutsuAtLevel(c, 10), 1, "jutsu mastered") },
    { id: "jutsu-mastery-40", name: "Sealed Technique", desc: "Raise one jutsu to mastery 40.", category: "Jutsu", icon: "🔏", check: c => jutsuAtLevel(c, 40) >= 1, progress: c => numericProgress(jutsuAtLevel(c, 40), 1, "jutsu mastered") },
    { id: "jutsu-versatile-10", name: "Thousand Forms", desc: "Raise 10 jutsu to mastery 20.", category: "Jutsu", icon: "🌀", check: c => jutsuAtLevel(c, 20) >= 10, progress: c => numericProgress(jutsuAtLevel(c, 20), 10, "jutsu mastered") },

    // Story, road epics, and Legacy
    { id: "story-chapter-1", name: "Ink on the Page", desc: "Begin the main village Chronicle.", category: "Story", icon: "📖", check: c => whole(c.storyProgress) >= 1, progress: c => numericProgress(c.storyProgress, 1, "chapters") },
    { id: "story-chapter-5", name: "At the Crossroads", desc: "Reach chapter 5 of the main village Chronicle.", category: "Story", icon: "🛤", check: c => whole(c.storyProgress) >= 5, progress: c => numericProgress(c.storyProgress, 5, "chapters") },
    { id: "story-chapter-9", name: "Living Chronicle", desc: "Complete the current main village Chronicle.", category: "Story", icon: "📚", check: c => whole(c.storyProgress) >= 9, progress: c => numericProgress(c.storyProgress, 9, "chapters") },
    { id: "questbook-first", name: "Road-Lore Keeper", desc: "Complete your first Quest Book epic.", category: "Story", icon: "🗺", check: c => count(c.redeemedQuestbookRuns) >= 1, progress: c => arrayProgress(c.redeemedQuestbookRuns, 1, "epics") },
    { id: "questbook-5", name: "Tales of the Five Roads", desc: "Complete 5 Quest Book epics.", category: "Story", icon: "🧭", check: c => count(c.redeemedQuestbookRuns) >= 5, progress: c => arrayProgress(c.redeemedQuestbookRuns, 5, "epics") },
    { id: "legacy-stage-1", name: "Inheritance", desc: "Accept a shinobi Legacy.", category: "Legacy", icon: "🕯", check: c => whole(c.legacy?.stage) >= 1, progress: c => numericProgress(c.legacy?.stage, 1, "Legacy stages") },
    { id: "legacy-stage-3", name: "Proven Legacy", desc: "Advance a Legacy to stage 3.", category: "Legacy", icon: "⚔️", check: c => whole(c.legacy?.stage) >= 3, progress: c => numericProgress(c.legacy?.stage, 3, "Legacy stages") },
    { id: "legacy-stage-5", name: "Myth Made Flesh", desc: "Complete all 5 stages of a Legacy.", category: "Legacy", icon: "🌠", check: c => whole(c.legacy?.stage) >= 5, progress: c => numericProgress(c.legacy?.stage, 5, "Legacy stages") },

    // Professions
    { id: "profession-chosen", name: "Chosen Calling", desc: "Choose a shinobi profession.", category: "Professions", icon: "🪪", check: c => Boolean(c.profession) },
    { id: "profession-rank-5", name: "Journeyman", desc: "Reach profession rank 5.", category: "Professions", icon: "🛠", check: c => whole(c.professionRank) >= 5, progress: c => numericProgress(c.professionRank, 5, "profession rank") },
    { id: "profession-rank-10", name: "Master of the Calling", desc: "Reach profession rank 10.", category: "Professions", icon: "🏅", check: c => whole(c.professionRank) >= 10, progress: c => numericProgress(c.professionRank, 10, "profession rank") },
    { id: "profession-mastery-10", name: "Beyond Rank", desc: "Invest 10 profession mastery points.", category: "Professions", icon: "🌟", check: c => objectValueTotal(c.masterySpec) >= 10, progress: c => numericProgress(objectValueTotal(c.masterySpec), 10, "mastery points") },

    // Hollow Gate, dungeons, and tower endurance
    { id: "hollow-clear-1", name: "First Descent", desc: "Complete your first Hollow Gate run.", category: "Hollow Gate", icon: "🏮", check: c => count(c.redeemedHollowGateRuns) >= 1, progress: c => arrayProgress(c.redeemedHollowGateRuns, 1, "Gate clears") },
    { id: "hollow-clear-10", name: "Gatewalker", desc: "Complete 10 Hollow Gate runs.", category: "Hollow Gate", icon: "🚪", check: c => count(c.redeemedHollowGateRuns) >= 10, progress: c => arrayProgress(c.redeemedHollowGateRuns, 10, "Gate clears") },
    { id: "hollow-clear-50", name: "Gatebound", desc: "Complete 50 Hollow Gate runs.", category: "Hollow Gate", icon: "🕳", check: c => count(c.redeemedHollowGateRuns) >= 50, progress: c => arrayProgress(c.redeemedHollowGateRuns, 50, "Gate clears") },
    { id: "hollow-warden-1", name: "Warden Fallen", desc: "Defeat your first Hollow Gate Warden.", category: "Hollow Gate", icon: "👁", check: c => whole(c.hollowGateWardenKills) >= 1, progress: c => numericProgress(c.hollowGateWardenKills, 1, "Wardens") },
    { id: "hollow-warden-25", name: "Wardenbane", desc: "Defeat 25 Hollow Gate Wardens.", category: "Hollow Gate", icon: "🗡", check: c => whole(c.hollowGateWardenKills) >= 25, progress: c => numericProgress(c.hollowGateWardenKills, 25, "Wardens") },
    { id: "dungeon-clear-1", name: "Hidden Door", desc: "Complete your first hidden dungeon.", category: "Hollow Gate", icon: "🗝", check: c => count(c.redeemedDungeonRuns) >= 1, progress: c => arrayProgress(c.redeemedDungeonRuns, 1, "dungeons") },
    { id: "dungeon-clear-25", name: "Underworld Regular", desc: "Complete 25 hidden dungeons.", category: "Hollow Gate", icon: "⛏", check: c => count(c.redeemedDungeonRuns) >= 25, progress: c => arrayProgress(c.redeemedDungeonRuns, 25, "dungeons") },
    { id: "endless-wave-10", name: "Wavebreaker", desc: "Reach Endless Tower wave 10.", category: "Trials", icon: "🌊", check: c => whole(c.endlessTowerBestWave) >= 10, progress: c => numericProgress(c.endlessTowerBestWave, 10, "best wave") },
    { id: "endless-wave-25", name: "Unbroken", desc: "Reach Endless Tower wave 25.", category: "Trials", icon: "🧱", check: c => whole(c.endlessTowerBestWave) >= 25, progress: c => numericProgress(c.endlessTowerBestWave, 25, "best wave") },
    { id: "endless-wave-50", name: "Against the Endless", desc: "Reach Endless Tower wave 50.", category: "Trials", icon: "♾", check: c => whole(c.endlessTowerBestWave) >= 50, progress: c => numericProgress(c.endlessTowerBestWave, 50, "best wave") },

    // Pets, breeding, evolution, and the pet ladder
    { id: "pet-active", name: "Companion in Arms", desc: "Set an active combat companion.", category: "Pets", icon: "🐾", check: c => Boolean(c.activePetId) },
    { id: "pet-pack-tactics", name: "Pack Tactics", desc: "Assign distinct companions for PvE and 2v2 battles.", category: "Pets", icon: "🐺", check: c => Boolean(c.activePetId && c.activePetId2v2 && c.activePetId !== c.activePetId2v2) },
    { id: "pet-level-25", name: "Growing Bond", desc: "Raise a pet to level 25.", category: "Pets", icon: "🌱", check: c => petsAtOrAboveLevel(c, 25) >= 1, progress: c => numericProgress(Math.max(0, ...(c.pets ?? []).map(p => whole(p.level))), 25, "highest pet level") },
    { id: "pet-level-max", name: "Apex Companion", desc: "Raise a pet to its maximum level.", category: "Pets", icon: "🦁", check: c => (c.pets ?? []).some(p => whole(p.maxLevel) > 0 && whole(p.level) >= whole(p.maxLevel)) },
    { id: "pet-evolution-1", name: "Evolution Begins", desc: "Evolve a starter companion once.", category: "Pets", icon: "🥚", check: c => evolvedPetsAtStage(c, 1) >= 1, progress: c => numericProgress(evolvedPetsAtStage(c, 1), 1, "evolved pets") },
    { id: "pet-evolution-2", name: "Final Form", desc: "Complete a starter companion's evolution.", category: "Pets", icon: "🦅", check: c => evolvedPetsAtStage(c, 2) >= 1, progress: c => numericProgress(evolvedPetsAtStage(c, 2), 1, "fully evolved pets") },
    { id: "pet-hatch-1", name: "New Generation", desc: "Hatch your first bred pet.", category: "Pets", icon: "🐣", check: c => count(c.petBreedingHatchReceipts) >= 1, progress: c => arrayProgress(c.petBreedingHatchReceipts, 1, "pets hatched") },
    { id: "pet-hatch-10", name: "Bloodline Breeder", desc: "Hatch 10 bred pets.", category: "Pets", icon: "🧬", check: c => count(c.petBreedingHatchReceipts) >= 10, progress: c => arrayProgress(c.petBreedingHatchReceipts, 10, "pets hatched") },
    { id: "pet-win-1", name: "Arena Debut", desc: "Win your first rewarded pet battle.", category: "Pets", icon: "🥇", check: c => whole(c.totalPetWins) >= 1, progress: c => numericProgress(c.totalPetWins, 1, "pet wins") },
    { id: "pet-win-25", name: "Beast League", desc: "Win 25 rewarded pet battles.", category: "Pets", icon: "🏟", check: c => whole(c.totalPetWins) >= 25, progress: c => numericProgress(c.totalPetWins, 25, "pet wins") },
    { id: "pet-ranked-1800", name: "Apex Handler", desc: "Reach 1,800 pet ranked rating.", category: "Pets", icon: "🐲", check: c => whole(c.petRankedRating) >= 1800, progress: c => numericProgress(c.petRankedRating, 1800, "pet rating") },

    // Shinobi Chronicle Showdown
    { id: "chronicle-starter", name: "The Scribe's Gift", desc: "Claim the Chronicle starter codex.", category: "Chronicle", icon: "📕", check: c => c.starterCardsClaimed === true },
    { id: "chronicle-win-1", name: "Ink Meets Steel", desc: "Win your first Chronicle Showdown duel.", category: "Chronicle", icon: "🃏", check: c => whole(c.cardClashWins) >= 1, progress: c => numericProgress(c.cardClashWins, 1, "duel wins") },
    { id: "chronicle-win-25", name: "Tactician", desc: "Win 25 Chronicle Showdown duels.", category: "Chronicle", icon: "♟", check: c => whole(c.cardClashWins) >= 25, progress: c => numericProgress(c.cardClashWins, 25, "duel wins") },
    { id: "chronicle-win-100", name: "Duel Archivist", desc: "Win 100 Chronicle Showdown duels.", category: "Chronicle", icon: "🗄", check: c => whole(c.cardClashWins) >= 100, progress: c => numericProgress(c.cardClashWins, 100, "duel wins") },
    { id: "chronicle-deck-40", name: "Complete Formation", desc: "Save a legal 40-card Chronicle deck.", category: "Chronicle", icon: "🎴", check: c => count(c.cardClashDeck) >= 40, progress: c => arrayProgress(c.cardClashDeck, 40, "deck cards") },
    { id: "chronicle-unique-25", name: "Codex Curator", desc: "Collect 25 unique Chronicle cards.", category: "Chronicle", icon: "📚", check: c => uniqueCardCount(c) >= 25, progress: c => numericProgress(uniqueCardCount(c), 25, "unique cards") },

    // Crafting and equipment
    { id: "craft-first", name: "Sparks Fly", desc: "Forge your first recipe.", category: "Crafting", icon: "⚒", check: c => count(c.redeemedCrafts) >= 1, progress: c => arrayProgress(c.redeemedCrafts, 1, "recipes forged") },
    { id: "craft-25", name: "Workshop Regular", desc: "Forge 25 recipes.", category: "Crafting", icon: "🔨", check: c => count(c.redeemedCrafts) >= 25, progress: c => arrayProgress(c.redeemedCrafts, 25, "recipes forged") },
    { id: "named-forge-first", name: "Named in Steel", desc: "Complete your first named forge.", category: "Crafting", icon: "🗡", check: c => count(c.redeemedNamedForges) >= 1, progress: c => arrayProgress(c.redeemedNamedForges, 1, "named forges") },
    { id: "weapon-attuned", name: "Element-Bound", desc: "Attune a weapon with an Elemental Core.", category: "Crafting", icon: "💠", check: c => Object.keys(c.weaponElements ?? {}).length >= 1, progress: c => numericProgress(Object.keys(c.weaponElements ?? {}).length, 1, "attuned weapons") },
    { id: "equipment-core-8", name: "Battle Ready", desc: "Fill all 8 core armor and weapon slots.", category: "Crafting", icon: "🛡", check: c => coreEquipmentCount(c) >= 8, progress: c => numericProgress(coreEquipmentCount(c), 8, "core slots") },

    // Clan, village war, tournament, and seasonal prestige
    { id: "clan-joined", name: "Sworn Kin", desc: "Join a clan.", category: "Clan", icon: "🤝", check: c => Boolean(c.clan) },
    { id: "clan-lifetime-1000", name: "Earn Your Colors", desc: "Earn 1,000 lifetime clan points.", category: "Clan", icon: "🎏", check: c => whole(c.lifetimeClanPoints) >= 1000, progress: c => numericProgress(c.lifetimeClanPoints, 1000, "clan points") },
    { id: "clan-lifetime-10000", name: "Pillar of the Clan", desc: "Earn 10,000 lifetime clan points.", category: "Clan", icon: "🏯", check: c => whole(c.lifetimeClanPoints) >= 10000, progress: c => numericProgress(c.lifetimeClanPoints, 10000, "clan points") },
    { id: "clan-all-fronts", name: "All Fronts", desc: "Contribute to clan battles, events, and missions in one month.", category: "Clan", icon: "🎌", check: c => whole(c.clanBattleContrib) > 0 && whole(c.clanEventContrib) > 0 && whole(c.clanMissionContrib) > 0 },
    { id: "war-win-1", name: "Victor's Crate", desc: "Qualify for your first village war victory.", category: "Village", icon: "📦", check: c => whole(c.warsWon) >= 1, progress: c => numericProgress(c.warsWon, 1, "war victories") },
    { id: "war-win-10", name: "Campaigner", desc: "Qualify for 10 village war victories.", category: "Village", icon: "🏴", check: c => whole(c.warsWon) >= 10, progress: c => numericProgress(c.warsWon, 10, "war victories") },
    { id: "war-mvp-1", name: "War Hero", desc: "Earn village war MVP once.", category: "Village", icon: "🎖", check: c => whole(c.warMvpCount) >= 1, progress: c => numericProgress(c.warMvpCount, 1, "MVP awards") },
    { id: "war-mvp-10", name: "Living Banner", desc: "Earn village war MVP 10 times.", category: "Village", icon: "🚩", check: c => whole(c.warMvpCount) >= 10, progress: c => numericProgress(c.warMvpCount, 10, "MVP awards") },
    { id: "war-damage-1m", name: "Siege Engine", desc: "Deal 1,000,000 lifetime village war damage.", category: "Village", icon: "💥", check: c => whole(c.lifetimeWarDamage) >= 1000000, progress: c => numericProgress(c.lifetimeWarDamage, 1000000, "war damage") },
    { id: "tournament-first", name: "Tournament Victor", desc: "Win your first official Arena Tournament.", category: "Tournament", icon: "🏆", check: c => whole(c.totalTournamentsCompleted) >= 1, progress: c => numericProgress(c.totalTournamentsCompleted, 1, "tournament wins") },
    { id: "tournament-10", name: "Colosseum Legend", desc: "Win 10 official Arena Tournaments.", category: "Tournament", icon: "🥇", check: c => whole(c.totalTournamentsCompleted) >= 10, progress: c => numericProgress(c.totalTournamentsCompleted, 10, "tournament wins") },
    { id: "ranked-season-3", name: "Ranked Dynasty", desc: "Finish #1 in 3 ranked seasons.", category: "Ranked", icon: "🏛", check: c => whole(c.rankedSeasonsWon) >= 3, progress: c => numericProgress(c.rankedSeasonsWon, 3, "season victories") },

    // Commitment, wanderers, and achievement metas
    { id: "login-streak-7", name: "Seven Dawns", desc: "Reach a 7-day login streak.", category: "Progression", icon: "🌅", check: c => whole(c.loginStreak) >= 7, progress: c => numericProgress(c.loginStreak, 7, "login streak") },
    { id: "login-streak-30", name: "Moon's Devotion", desc: "Reach a 30-day login streak.", category: "Progression", icon: "🌙", check: c => whole(c.loginStreak) >= 30, progress: c => numericProgress(c.loginStreak, 30, "login streak") },
    { id: "wanderer-first", name: "A Chance Meeting", desc: "Complete your first sector wanderer quest.", category: "Exploration", icon: "🥾", check: c => count(c.redeemedWandererQuests) >= 1, progress: c => arrayProgress(c.redeemedWandererQuests, 1, "wanderer quests") },
    { id: "wanderer-25", name: "Crossroads Sage", desc: "Complete 25 sector wanderer quests.", category: "Exploration", icon: "🧙", check: c => count(c.redeemedWandererQuests) >= 25, progress: c => arrayProgress(c.redeemedWandererQuests, 25, "wanderer quests") },
    { id: "achievements-25", name: "First Shelf", desc: "Unlock 25 achievements.", category: "Meta", icon: "🏅", check: c => count(c.unlockedAchievements) >= 25, progress: c => arrayProgress(c.unlockedAchievements, 25, "achievements") },
    { id: "achievements-75", name: "Hall of Deeds", desc: "Unlock 75 achievements.", category: "Meta", icon: "🏛", check: c => count(c.unlockedAchievements) >= 75, progress: c => arrayProgress(c.unlockedAchievements, 75, "achievements") },
    { id: "achievements-100", name: "Shinobi Journey", desc: "Unlock 100 achievements.", category: "Meta", icon: "🌄", check: c => count(c.unlockedAchievements) >= 100, progress: c => arrayProgress(c.unlockedAchievements, 100, "achievements") },
    { id: "achievements-125", name: "Living Legend", desc: "Unlock 125 achievements.", category: "Meta", icon: "🌌", check: c => count(c.unlockedAchievements) >= 125, progress: c => arrayProgress(c.unlockedAchievements, 125, "achievements") },

    // ─── Hidden / Secret ─────────────────────────────────────────────
    { id: "secret-untouched",        name: "Untouched Vault",   desc: "Carry 1,000,000+ ryo without depositing any.",  category: "Wealth",     icon: "🪙", hidden: true, check: c => c.ryo >= 1000000 && c.bankRyo === 0 },
    { id: "secret-charms-100",       name: "Bone Hoarder",      desc: "Hold 100 Bone Charms at once.",                 category: "Wealth",     icon: "🪬", hidden: true, check: c => (c.boneCharms ?? 0) >= 100 },
    { id: "secret-stones-100",       name: "Crystal Hoarder",   desc: "Hold 100 Aura Stones at once.",                 category: "Wealth",     icon: "💠", hidden: true, check: c => (c.auraStones ?? 0) >= 100 },
    { id: "secret-mythic-10",        name: "Mythic Seeker",     desc: "Hold 10 Mythic Seals at once.",                 category: "Wealth",     icon: "🔱", hidden: true, check: c => (c.mythicSeals ?? 0) >= 10 },
    { id: "secret-packrat",          name: "Packrat",           desc: "Carry 100+ items in your inventory.",           category: "Wealth",     icon: "🎒", hidden: true, check: c => totalItemCount(c) >= 100 },
    { id: "secret-loadout-full",     name: "Full Arsenal",      desc: "Equip all 15 jutsu slots simultaneously.",      category: "Combat",     icon: "📿", hidden: true, check: c => (c.equippedJutsuIds?.length ?? 0) >= 15 },
    { id: "secret-monthly-50",       name: "Monthly Reaper",    desc: "Earn 50 PvP kills in a single month.",          category: "PvP",        icon: "🌑", hidden: true, check: c => (c.monthlyPvpKills ?? 0) >= 50 },
    { id: "secret-hunter-5",         name: "Chakra Beast Warden", desc: "Reach the highest Hunter Rank.",              category: "Trials",     icon: "🏹", hidden: true, check: c => (c.hunterRank ?? 0) >= 5 },
    { id: "secret-titled",           name: "Self-Named",        desc: "Earn the right to set a custom title.",         category: "Progression",icon: "📛", hidden: true, check: c => !!c.customTitle },
    { id: "secret-story-titled",     name: "The Storied",       desc: "Earn a title through the main story.",          category: "Progression",icon: "📖", hidden: true, check: c => !!c.storyTitle },
    { id: "secret-bestiary-50",      name: "Bestiary",          desc: "Defeat 50 unique AI opponents.",                category: "Combat",     icon: "🐉", hidden: true, check: c => (c.defeatedAiIds?.length ?? 0) >= 50 },
    { id: "secret-bestiary-200",     name: "Encyclopedia",      desc: "Defeat 200 unique AI opponents.",               category: "Combat",     icon: "📚", hidden: true, check: c => (c.defeatedAiIds?.length ?? 0) >= 200 },
    { id: "secret-elements-3",       name: "Polyelementalist",  desc: "Awaken 3 or more elements.",                    category: "Bloodline",  icon: "🜂", hidden: true, check: c => (c.elements?.length ?? 0) >= 3 },
    { id: "secret-menagerie-5",      name: "Menagerie",         desc: "Tame 5 or more pets.",                          category: "Trials",     icon: "🦊", hidden: true, check: c => (c.pets?.length ?? 0) >= 5 },
    { id: "secret-exams-3",          name: "Trial Walker",      desc: "Pass 3 or more rank exams.",                    category: "Progression",icon: "🎓", hidden: true, check: c => (c.examsPassed?.length ?? 0) >= 3 },
    { id: "secret-war-vet-50",       name: "War Veteran",       desc: "Complete 50 village war missions.",             category: "Village",    icon: "⚔️", hidden: true, check: c => (c.villageWarMissionsCompleted ?? 0) >= 50 },
    { id: "secret-weekly-bosses-5",  name: "Weekly Reaper",     desc: "Defeat 5 distinct weekly bosses.",              category: "Combat",     icon: "👺", hidden: true, check: c => Object.keys(c.weeklyBossKills ?? {}).length >= 5 },
    { id: "secret-tile-cards-1000",  name: "Tile Collector",    desc: "Collect 1,000 tile cards.",                     category: "Exploration",icon: "🀄", hidden: true, check: c => (c.tileCards?.length ?? 0) >= 1000 },
    { id: "secret-minmaxer",         name: "Min-Maxer",         desc: "Reach level 50+ with zero unspent stat points.",category: "Progression",icon: "🧮", hidden: true, check: c => c.level >= 50 && c.unspentStats === 0 },
    { id: "secret-war-crates-10",    name: "Salvager",          desc: "Claim 10 war crates.",                          category: "Village",    icon: "📦", hidden: true, check: c => (c.claimedWarCrateIds?.length ?? 0) >= 10 },
];

/** Permanent ledger truth for presentation; live predicates only discover new unlocks. */
export function isAchievementUnlocked(character: Character, achievement: Achievement): boolean {
    return Boolean(character.unlockedAchievements?.includes(achievement.id) || achievement.check(character));
}

export function unlockedAchievementCount(character: Character): number {
    return ACHIEVEMENTS.reduce((total, achievement) => total + (isAchievementUnlocked(character, achievement) ? 1 : 0), 0);
}

// One-time reward paid the FIRST time an achievement unlocks. Granted in the
// achievement-grant pass (App.tsx) only for newly-unlocked entries — never on
// the silent first-load backfill, so existing players get no retroactive
// windfall. Hidden/secret achievements pay a little more. All values tunable.
export function achievementReward(a: Achievement): { ryo: number; fateShards: number } {
    return a.hidden ? { ryo: 3000, fateShards: 1 } : { ryo: 2000, fateShards: 0 };
}

// ─── Earned titles ────────────────────────────────────────────────────────
// The subset of achievements that confer a *wearable* title (the achievement's
// own name). Earning one adds its name to character.earnedTitles, which the
// player can then select for free as their displayed title in Profile — turning
// the achievement list from a thin currency checklist into a real bragging-
// rights / status chase. Titles are permanent once earned (union-merged, never
// removed) and, unlike the one-time ryo/shard reward, ARE backfilled for
// existing players (a title isn't currency, so there's no windfall).
export const TITLE_ACHIEVEMENT_IDS: ReadonlySet<string> = new Set<string>([
    "level-100", "pve-2500", "pvp-250", "pvp-1000",
    "ranked-1800", "ranked-2200", "ranked-season-champ",
    "mission-1000", "explore-5000", "ryo-5m", "honor-500", "fate-2500",
    "aura-300", "raid-250", "tournament-3", "tower-25", "pet-100", "clan-founder",
    "spire-5", "spire-10", "spire-15", "spire-20",
    "secret-bestiary-200", "secret-elements-3", "secret-weekly-bosses-5", "secret-war-vet-50",
    "secret-hunter-5",
    "story-chapter-9", "legacy-stage-5", "profession-rank-10", "hollow-clear-50",
    "pet-ranked-1800", "chronicle-win-100", "named-forge-first", "clan-lifetime-10000",
    "war-mvp-10", "tournament-10", "ranked-season-3", "achievements-100", "achievements-125",
]);

/** The wearable title an achievement confers, or null if it grants none. */
export function achievementTitle(a: Achievement): string | null {
    return TITLE_ACHIEVEMENT_IDS.has(a.id) ? a.name : null;
}

/** Collect the wearable titles for a set of unlocked achievement ids (deduped). */
export function titlesForAchievementIds(ids: Iterable<string>): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
        if (!TITLE_ACHIEVEMENT_IDS.has(id) || seen.has(id)) continue;
        seen.add(id);
        const a = ACHIEVEMENTS.find((x) => x.id === id);
        if (a) out.push(a.name);
    }
    return out;
}
