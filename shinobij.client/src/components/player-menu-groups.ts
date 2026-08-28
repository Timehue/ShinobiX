import {
    GiAnvil, GiBeerStein, GiBiceps, GiBookCover, GiEnvelope,
    GiFireSpellCast, GiKnapsack, GiNinjaHeroicStance, GiPawPrint,
    GiScrollUnfurled, GiThreeFriends, GiTreasureMap,
} from "./icons/LightweightGameIcons";

export const PLAYER_MENU_GROUPS = [
    { id: "world", label: "World", items: [
        ["worldMap", "Travel", GiTreasureMap], ["tavern", "Tavern", GiBeerStein],
    ] },
    { id: "activities", label: "Activities", items: [
        ["missions", "Missions", GiScrollUnfurled], ["training", "Training", GiBiceps],
        ["jutsuTraining", "Jutsu", GiFireSpellCast], ["logbook", "Logbook", GiBookCover],
    ] },
    { id: "character", label: "Character", items: [
        ["profile", "Character", GiNinjaHeroicStance], ["inventory", "Inventory", GiKnapsack],
        ["home", "Pet Home", GiPawPrint], ["professions", "Professions", GiAnvil],
    ] },
    { id: "social", label: "Social", items: [
        ["userHub", "Users", GiThreeFriends], ["messages", "Mail", GiEnvelope],
    ] },
] as const;
