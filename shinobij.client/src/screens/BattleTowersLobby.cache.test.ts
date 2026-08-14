import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./BattleTowersLobby.tsx", import.meta.url), "utf8");

describe("Tower floor cache schema", () => {
    it("versions the DTO cache for the authored campaign and reinforcement payload", () => {
        assert.match(source, /const FLOOR_CACHE_KEY = "tower-floors:v4"/);
        assert.doesNotMatch(source, /const FLOOR_CACHE_KEY = "tower-floors";/);
    });

    it("rejects cached and fetched floors missing fields dereferenced by the lobby", () => {
        assert.match(source, /Array\.isArray\(floor\.reinforcementWaves\)/);
        assert.match(source, /floor\.reinforcementWaves\.every\(Number\.isFinite\)/);
        assert.match(source, /Array\.isArray\(floor\.dynamicHazards\)/);
        assert.match(source, /Number\.isFinite\(reward\.fateShards\)/);
        assert.match(source, /Number\.isFinite\(map\.width\)/);
        assert.match(source, /if \(!isTowerFloorList\(f\)\) throw new Error/);
    });
});
