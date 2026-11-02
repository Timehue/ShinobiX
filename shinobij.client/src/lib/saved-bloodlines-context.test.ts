import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("every fight mount gets the stored bloodlines for its jutsu lens", () => {
    const app = source("../App.tsx");
    const arena = source("../screens/MissionArenaFight.tsx");
    assert.match(app, /<SavedBloodlinesContext\.Provider value=\{savedBloodlines\}>\s*<MaintenanceOperatorBoundary/);
    assert.match(arena, /useContext\(SavedBloodlinesContext\)/);
    assert.match(arena, /playerLensDiscipline\(character, savedBloodlines \?\? contextBloodlines\)/);
});
