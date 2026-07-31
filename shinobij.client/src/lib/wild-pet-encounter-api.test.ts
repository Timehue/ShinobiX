import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

/*
 * Regression guard: world-map wild pets must be settled by the server.
 *
 * The explore tile used to roll the encounter locally and append the pet to
 * `character.pets`, relying on the generic save to persist it. It never did —
 * `sanitizeCharacterSave` (api/save/[name].ts) drops any pet id the stored
 * roster doesn't already have, so a befriended pet survived only until the next
 * reload. These assertions pin the fixed shape: the roll comes from
 * /api/pet/encounter-start, the commit from /api/pet/befriend, and the roster
 * the server returns is adopted instead of merged locally.
 */

function source(relativeUrl: string): string {
    return readFileSync(new URL(relativeUrl, import.meta.url), "utf8");
}

describe("world-map wild-pet encounters", () => {
    test("the explore tile rolls the encounter server-side", () => {
        const worldMap = source("../screens/WorldMap.tsx");
        assert.ok(
            worldMap.includes("startWildPetEncounter(character.name)"),
            "exploring must ask the server for the wild-pet roll",
        );
        assert.ok(
            !worldMap.includes("rollPetEncounter("),
            "the client must not roll its own wild pet — the server-minted token seals the pet",
        );
    });

    test("befriending commits through the server and adopts its character", () => {
        const worldMap = source("../screens/WorldMap.tsx");
        const call = worldMap.indexOf("befriendWildPet(character.name, token)");
        assert.notEqual(call, -1, "befriending must spend the encounter token server-side");

        const adopt = worldMap.indexOf("updateCharacter(result.character)", call);
        assert.ok(adopt > call, "the server's persisted character must be adopted after the call");

        assert.ok(
            !/pets:\s*\[\s*\.\.\.character\.pets/.test(worldMap),
            "the world map must not append a pet to the roster locally — the save sanitizer strips it",
        );
        assert.ok(
            !worldMap.includes("rollPetTrait("),
            "the trait is rolled by the server alongside the roster write",
        );
    });

    test("both endpoints the client depends on exist and are routed", () => {
        const routes = source("../../../server.ts");
        for (const path of ["/pet/encounter-start", "/pet/befriend"]) {
            assert.ok(routes.includes(`route('${path}'`), `${path} must be registered in server.ts`);
        }
    });
});
