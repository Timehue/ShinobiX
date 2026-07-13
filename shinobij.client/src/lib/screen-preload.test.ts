import assert from "node:assert/strict";
import test from "node:test";

import { canPreloadScreen } from "./screen-preload";
import type { Screen } from "../types/core";

const VILLAGE_DESTINATIONS: Screen[] = [
    "battleArena", "storyHall", "townHall", "bank", "shop", "clan",
    "hospital", "missions", "cafeteria", "tavern", "training",
    "jutsuTraining", "worldMap", "pets", "shinobiTiles",
];

test("every Village destination supports intent preloading", () => {
    for (const screen of VILLAGE_DESTINATIONS) {
        assert.equal(canPreloadScreen(screen), true, `${screen} should have a preloader`);
    }
});
