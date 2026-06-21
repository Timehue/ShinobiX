/*
 * Foundational game types — string-union enums that the rest of the game
 * uses to constrain identifiers (profession kinds, screen names, biome
 * names, jutsu attributes, weather, village-upgrade slots).
 *
 * Every entry here is a pure type with zero runtime emit and zero
 * cross-dependencies on other modules. Extracted from App.tsx so that
 * screens / components can import the canonical shape without paying
 * the 36 KLOC import cost of App.tsx itself.
 *
 * Internal App.tsx code keeps the existing names — App.tsx imports +
 * re-exports from this module, so external imports of "../App" keep
 * resolving identically.
 */

export type Profession = "healer" | "vanguard" | "petTamer";

export type Screen =
    | "start"
    | "adminLogin"
    | "adminPanel"
    | "professionPicker"
    | "village"
    | "villageLore"
    | "profile"
    | "inventory"
    | "logbook"
    | "training"
    | "jutsuTraining"
    | "missions"
    | "arena"
    | "battleArena"
    | "arenaDistrict"
    | "bloodlineMaker"
    | "clan"
    | "worldMap"
    | "townHall"
    | "bank"
    | "shop"
    | "grandMarketplace"
    | "hospital"
    | "cafeteria"
    | "storyHall"
    | "storyBoss"
    | "sunscarFestival"
    | "centralHub"
    | "petArena"
    | "petLadder"
    | "pets"
    | "shinobiTiles"
    | "eventPetBattle"
    | "eventTiles"
    | "dungeon"
    | "hunting"
    | "tavern"
    | "hallOfLegends"
    | "shinobiCouncil"
    | "userHub"
    | "userView"
    | "pvpBattle"
    | "hollowGateShrine"
    | "hollowGateTiles"
    | "endlessTower"
    | "battleTowers"
    | "weeklyBoss"
    | "villageWar"
    | "tilecardsDuel"
    | "guides"
    | "messages";

export type Rank = "B Rank" | "A Rank" | "S Rank";
export type Biome = "forest" | "snow" | "volcano" | "shadow" | "central";
export type JutsuType = "Ninjutsu" | "Taijutsu" | "Genjutsu" | "Bukijutsu" | "Any";
export type JutsuElement = "Earth" | "Wind" | "Lightning" | "Fire" | "Water" | "None";
export type JutsuTarget = "SELF" | "OPPONENT" | "OTHER_USER" | "CHARACTER" | "EMPTY_GROUND";
export type JutsuMethod = "SINGLE" | "ALL" | "AOE_CIRCLE" | "INSTANT_EFFECT" | "AOE_SPIRAL";
export type JutsuSort = "name" | "type" | "element" | "effect" | "ap" | "range" | "effectPower";
export type WeatherType =
    | "clear"
    | "rain"
    | "ashfall"
    | "thunderstorm"
    | "tornado"
    | "desertHaze";

export type VillageUpgradeKey =
    | "training"
    | "jutsuTraining"
    | "shop"
    | "townDefense"
    | "petYard"
    | "bank"
    | "missionHall"
    | "hospital";

export type VillageUpgrades = Record<VillageUpgradeKey, number>;

export type AdminAccount = "Admin 1" | "Admin 2";
// Admin role. "full" = Admin 1 (sees every tab, can call any admin endpoint).
// "content" = Admin 2 (jutsu/bloodline, events, VNs, AI creator, pet/card
// editors, village leaders, professions only — no players / hollow gate /
// moderation). Returned by /api/admin-auth based on which password matched.
export type AdminRole = "full" | "content";
