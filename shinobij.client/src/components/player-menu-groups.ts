import {
    GiAnvil, GiBiceps, GiBookCover, GiEnvelope, GiMissionBoard,
    GiFireSpellCast, GiKnapsack, GiNinjaHeroicStance,
    GiPetYard, GiTavern, GiThreeFriends, GiTreasureMap,
} from "./icons/LightweightGameIcons";

export const PLAYER_MENU_GROUPS = [
    { id: "world", label: "World", items: [
        ["worldMap", "Travel", GiTreasureMap], ["tavern", "Tavern", GiTavern],
    ] },
    { id: "activities", label: "Activities", items: [
        ["missions", "Missions", GiMissionBoard], ["training", "Training", GiBiceps],
        ["jutsuTraining", "Jutsu", GiFireSpellCast], ["logbook", "Logbook", GiBookCover],
    ] },
    { id: "character", label: "Character", items: [
        ["profile", "Character", GiNinjaHeroicStance], ["inventory", "Inventory", GiKnapsack],
        ["home", "Pet Home", GiPetYard], ["professions", "Professions", GiAnvil],
    ] },
    { id: "social", label: "Social", items: [
        ["userHub", "Users", GiThreeFriends], ["messages", "Mail", GiEnvelope],
    ] },
] as const;
