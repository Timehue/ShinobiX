import {
    GiAnvil, GiBeerStein, GiBiceps, GiBookCover, GiDna1, GiEnvelope,
    GiFireSpellCast, GiKnapsack, GiNinjaHeroicStance, GiPawPrint,
    GiScrollUnfurled, GiThreeFriends, GiTreasureMap,
} from "./icons/LightweightGameIcons";

export const PLAYER_MENU_GROUPS = [
    { id: "world", label: "World", items: [
        ["tavern", "Tavern", GiBeerStein], ["worldMap", "Travel", GiTreasureMap],
        ["villageWarMap", "Sector Map", GiTreasureMap],
        ["userHub", "Users", GiThreeFriends], ["messages", "Mail", GiEnvelope],
    ] },
    { id: "growth", label: "Growth", items: [
        ["missions", "Missions", GiScrollUnfurled], ["training", "Training", GiBiceps],
        ["jutsuTraining", "Jutsu", GiFireSpellCast], ["logbook", "Logbook", GiBookCover],
    ] },
    { id: "character", label: "Character", items: [
        ["profile", "Character", GiNinjaHeroicStance], ["inventory", "Inventory", GiKnapsack],
        ["home", "Pet Home", GiPawPrint], ["bloodlineMaker", "Bloodline", GiDna1],
        ["professions", "Professions", GiAnvil],
    ] },
] as const;
