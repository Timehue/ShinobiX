import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

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

test("Story Hall intent warms its active village payload beside the screen chunk", () => {
    const preloader = readFileSync(new URL("./screen-preload.ts", import.meta.url), "utf8");
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const village = readFileSync(new URL("../screens/Village.tsx", import.meta.url), "utf8");
    const admin = readFileSync(new URL("../screens/AdminPanel.tsx", import.meta.url), "utf8");
    assert.match(preloader, /import\("\.\/story-content-loader"\).*preloadStoryContent/s);
    assert.match(app, /preloadScreen\(nextScreen, character\?\.storyVillage \|\| character\?\.village\)/);
    assert.match(village, /preloadScreen\(location\.screen, character\.storyVillage \|\| character\.village\)/);
    assert.match(admin, /onPointerDown=\{\(\) => \{ void requestAdminStoryContent\(\); \}\}/);
});
