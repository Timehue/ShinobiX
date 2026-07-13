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
    expectCategories("hollowGateTiles", ["card", "shrine"]);
    expectCategories("userView", ["avatar", "pet"]);
});
