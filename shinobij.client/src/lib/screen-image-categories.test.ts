import assert from "node:assert/strict";
import test from "node:test";
import type { Screen } from "../types/core";
import { imageCategoriesForScreen, type ScreenImageCategory } from "./screen-image-categories";

function expectCategories(screen: Screen, categories: ScreenImageCategory[]) {
    const actual = imageCategoriesForScreen(screen);
    for (const category of categories) {
        assert.ok(actual.includes(category), `${screen} should load ${category} images`);
    }
}

test("image-heavy routes load every category their first paint consumes", () => {
    expectCategories("worldMap", ["avatar", "event", "landmark", "shrine", "ai", "pet"]);
    expectCategories("adminPanel", ["item", "ai", "bloodline", "jutsu", "event", "card", "pet", "avatar", "shrine"]);
    expectCategories("centralHub", ["bloodline", "item", "jutsu"]);
    expectCategories("pvpBattle", ["avatar", "jutsu", "item"]);
    expectCategories("battleTowers", ["jutsu", "item"]);
    expectCategories("weeklyBoss", ["ai"]);
    expectCategories("dungeon", ["shrine", "item", "event", "pet"]);
    expectCategories("hollowGateShrine", ["shrine", "item", "avatar", "ai", "jutsu"]);
    expectCategories("hollowGateTiles", ["card", "shrine"]);
    expectCategories("userView", ["avatar", "pet"]);
    expectCategories("professions", ["pet"]);
});

test("every PvP battle host can load its art from a cold route entry", () => {
    for (const screen of ["pvpBattle", "clanWar2v2"] as const)
        expectCategories(screen, ["avatar", "jutsu", "item"]);
    for (const screen of ["clanWarPet", "sectorPet", "eventPetBattle", "petArena", "petLadder"] as const)
        expectCategories(screen, ["pet", "avatar"]);
    for (const screen of ["tilecardsDuel", "sectorCard", "cardClashFreePlay", "eventTiles"] as const)
        expectCategories(screen, ["card"]);
});
