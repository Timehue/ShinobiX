import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DUNGEON_CLEAR_REWARD } from "../api/dungeon/_run";
import { craftDungeonEvents, hiddenDungeonVnEvent } from "../shinobij.client/src/data/vn-events";

// The server pays DUNGEON_CLEAR_REWARD on a verified clear. The client shows it
// in two places: the dungeon VN's reward line (hiddenDungeonVnEvent and its five
// Crafter clones) and the clear alert in App.tsx. Both must read one copy.

test("the dungeon VN reward line mirrors the server clear reward", () => {
    assert.deepEqual(hiddenDungeonVnEvent.currencyRewards, { ...DUNGEON_CLEAR_REWARD });
    for (const event of craftDungeonEvents) {
        assert.deepEqual(event.currencyRewards, { ...DUNGEON_CLEAR_REWARD }, `${event.id} drifted from the server reward`);
    }
});

test("the dungeon clear alert reads the canonical reward instead of literal amounts", () => {
    const app = readFileSync("shinobij.client/src/App.tsx", "utf8");
    const line = app.split("\n").find((row) => row.includes("cleared.") && row.includes("Dungeon Legendary Relic"));
    assert.ok(line, "App.tsx lost the dungeon clear alert");
    assert.match(line, /hiddenDungeonVnEvent\.currencyRewards/);
    for (const [key, label] of [["boneCharms", "Bone Charms"], ["auraStones", "Aura Stones"], ["fateShards", "Fate Shards"]] as const) {
        assert.ok(line.includes(`\${pay?.${key} ?? 0} ${label}`), `the alert must print ${label} from the canonical reward`);
        assert.doesNotMatch(line, new RegExp(`\\+\\d+ ${label}`), `the alert hard-codes a ${label} amount`);
    }
});
