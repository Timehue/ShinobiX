import type { Screen } from "../types/core";

export type ScreenImageCategory =
    | "ai"
    | "avatar"
    | "bloodline"
    | "card"
    | "event"
    | "item"
    | "jutsu"
    | "landmark"
    | "pet"
    | "shrine";

const NONE: readonly ScreenImageCategory[] = [];

export function imageCategoriesForScreen(screen: Screen): readonly ScreenImageCategory[] {
    switch (screen) {
        case "worldMap": return ["avatar", "event", "landmark", "shrine", "ai", "pet"];
        case "worldCrisis": return ["avatar", "landmark", "ai", "jutsu", "item"];
        case "home": case "pets": case "petArena": case "petLadder": case "eventPetBattle": case "sectorPet": return ["pet"];
        case "jutsuTraining": return ["jutsu"];
        case "shop": case "inventory": case "grandMarketplace": return ["item"];
        case "profile": return ["item", "bloodline", "jutsu"];
        case "adminPanel": return ["item", "ai", "bloodline", "jutsu", "event", "card", "pet", "avatar", "shrine"];
        case "missions": case "hunting": return ["ai"];
        case "shinobiTiles": case "eventTiles": case "tilecardsDuel": case "sectorCard": case "cardClashFreePlay": return ["card"];
        case "hollowGateTiles": return ["card", "shrine"];
        case "arena": case "battleArena": case "arenaDistrict": return ["avatar", "jutsu", "ai", "pet", "item"];
        case "bloodlineMaker": return ["bloodline", "jutsu"];
        case "storyHall": case "storyBoss": case "logbook": return ["event", "ai"];
        case "hollowGateShrine": return ["shrine", "item", "avatar", "ai", "jutsu"];
        case "dungeon": return ["shrine", "item", "event", "pet"];
        case "centralHub": return ["bloodline", "item", "jutsu"];
        case "userView": return ["avatar", "pet"];
        case "userHub": case "townHall": case "tavern": return ["avatar"];
        case "pvpBattle": return ["avatar", "jutsu", "item"];
        case "weeklyBoss": return ["ai", "jutsu", "item"];
        case "battleTowers": case "clan": return ["avatar", "jutsu", "item"];
        default: return NONE;
    }
}
