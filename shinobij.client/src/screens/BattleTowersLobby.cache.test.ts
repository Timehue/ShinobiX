import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./BattleTowersLobby.tsx", import.meta.url), "utf8");

describe("Tower floor cache schema", () => {
    it("versions the DTO cache for the authored campaign, reinforcements, and adaptive arenas", () => {
        assert.match(source, /const FLOOR_CACHE_KEY = "tower-floors:v5"/);
        assert.doesNotMatch(source, /const FLOOR_CACHE_KEY = "tower-floors";/);
    });

    it("rejects cached and fetched floors missing fields dereferenced by the lobby", () => {
        assert.match(source, /Array\.isArray\(floor\.reinforcementWaves\)/);
        assert.match(source, /floor\.reinforcementWaves\.every\(Number\.isFinite\)/);
        assert.match(source, /Array\.isArray\(floor\.dynamicHazards\)/);
        assert.match(source, /Number\.isFinite\(reward\.fateShards\)/);
        assert.match(source, /Number\.isInteger\(map\.width\)/);
        assert.match(source, /map\.width > 0/);
        assert.match(source, /Number\.isInteger\(map\.height\)/);
        assert.match(source, /map\.height > 0/);
        assert.match(source, /if \(!isTowerFloorList\(f\)\) throw new Error/);
    });
});
