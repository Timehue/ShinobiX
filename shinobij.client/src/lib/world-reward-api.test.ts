import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

/*
 * Regression guard: world-map rewards must be settled by the server.
 *
 * Everything an explored tile can pay is server-owned in `sanitizeCharacterSave`
 * (api/save/[name].ts): tile cards are rejected outright, every entry in
 * CURRENCY_CAPS is 0, inventory is clamped to one net-new item per save, and
 * `totalTilesExplored` has a per-save delta of 0. Computing any of it in the
 * browser and leaning on the autosave means the player watches the reward land
 * and then lose it on the next reload.
 *
 * The endpoints (/api/world/explore, /api/world/open-chest,
 * /api/village/war-mission) are the only paths that can actually pay out.
 */

function source(relativeUrl: string): string {
    return readFileSync(new URL(relativeUrl, import.meta.url), "utf8");
}

describe("world-map reward settlement", () => {
    test("exploring a tile is counted by the server on every branch", () => {
        const worldMap = source("../screens/WorldMap.tsx");
        // Four outcome branches count the tile without paying ryo, and the
        // no-outcome branch pays it. Miss one and the tile silently stops
        // counting toward totalTilesExplored — which gates the rank exams.
        assert.equal(
            (worldMap.match(/settleExplore\(sector, "tile"\)/g) ?? []).length, 4,
            "dungeon, pet, chest and ambush branches must each count the tile",
        );
        assert.ok(
            worldMap.includes('settleExplore(sector, "full")'),
            "the no-outcome branch must claim the explore ryo",
        );
        assert.ok(
            !/totalTilesExplored:\s*\(character\.totalTilesExplored/.test(worldMap),
            "the client must not increment totalTilesExplored — the sanitizer freezes it",
        );
    });

    test("the Ancient Chest is rolled and banked by the server", () => {
        const worldMap = source("../screens/WorldMap.tsx");
        assert.ok(
            worldMap.includes("openAncientChest(character.name, sector)"),
            "the chest must be rolled by /api/world/open-chest",
        );
        assert.ok(
            !worldMap.includes("function rollAncientChest("),
            "the client chest roll table must be gone — its loot could never persist",
        );
        // The claim button only dismisses the reveal now. If it starts crediting
        // again, the sanitizer will eat the cards and the premium currency.
        const claim = worldMap.slice(worldMap.indexOf("function claimChest("));
        const body = claim.slice(0, claim.indexOf("\n    }"));
        for (const field of ["fateShards", "boneCharms", "auraStones", "auraDust", "tileCards"]) {
            assert.ok(!body.includes(field), `claimChest must not credit ${field} locally`);
        }
    });

    test("the village-war mission reward is claimed from the server", () => {
        const logbook = source("../screens/Logbook.tsx");
        const call = logbook.indexOf("claimWarMissionServer(character.name, index)");
        assert.notEqual(call, -1, "the war mission must settle through /api/village/war-mission");
        assert.ok(
            logbook.indexOf("updateCharacter(settled.character)", call) > call,
            "the server's persisted character must be adopted",
        );
        // The war damage runs only after the reward commits — otherwise a
        // refused claim would still chip the enemy village.
        const damage = logbook.indexOf("applyVillageWarMissionDamage(", call);
        assert.ok(damage > logbook.indexOf("updateCharacter(settled.character)", call),
            "war damage must follow the reward, not precede it");

        const worldState = source("./world-state.ts");
        assert.ok(
            !worldState.includes("claimVillageWarDailyMission"),
            "the inline claim must be gone — it consumed the day's stamp and paid nothing",
        );
        const fn = worldState.slice(worldState.indexOf("export function applyVillageWarMissionDamage"));
        const fnBody = fn.slice(0, fn.indexOf("\n}"));
        assert.ok(
            !fnBody.includes("villageWarMissionsCompleted") && !fnBody.includes("clanMissionContrib"),
            "the war-damage half must not touch the server-owned counters",
        );
        assert.ok(
            !fnBody.includes("LEGENDARY_WAR_CRATE_ID"),
            "the winner crate comes from /api/village/claim-war-crate, not an inline grant",
        );
    });

    test("every endpoint the client depends on is routed", () => {
        const routes = source("../../../server.ts");
        for (const path of ["/world/explore", "/world/open-chest", "/village/war-mission"]) {
            assert.ok(routes.includes(`route('${path}'`), `${path} must be registered in server.ts`);
        }
    });
});
