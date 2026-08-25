import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const screen = readFileSync(new URL("../screens/WorldCrisis80.tsx", import.meta.url), "utf8");
const start = readFileSync(new URL("../../../api/world-crisis-80/combat-start.ts", import.meta.url), "utf8");
const settle = readFileSync(new URL("../../../api/world-crisis-80/combat-settle.ts", import.meta.url), "utf8");
const showdown = readFileSync(new URL("../../../api/pet/showdown.ts", import.meta.url), "utf8");
const state = readFileSync(new URL("../../../api/world-crisis-80/_state.ts", import.meta.url), "utf8");
const save = readFileSync(new URL("../../../api/save/[name].ts", import.meta.url), "utf8");
const mutations = readFileSync(new URL("../../../api/save/_mutate-player-save.ts", import.meta.url), "utf8");

describe("level-80 world crisis authority boundary", () => {
    it("launches one human against exactly three server-authored shinobi", () => {
        assert.match(start, /activeWorldCrisis80Encounter\(\{ character, sourceId, path: 'shinobi' \}\)/);
        assert.match(start, /buildWorldCrisis80EnemyTemplates\(encounter, character\.level, admin\)/);
        assert.match(start, /worldCrisis80 = \{ crisisId: WORLD_CRISIS_80_ID, village: encounter\.village, sourceId: encounter\.sourceId \}/);
        assert.doesNotMatch(screen, /enemyTemplates\s*:/);
        assert.doesNotMatch(screen, /floorProvenance\s*:/);
    });

    it("requires a sealed terminal Tower outcome before a shinobi win contributes", () => {
        assert.match(settle, /session\.worldCrisis80/);
        assert.match(settle, /session\.winner === 'squad'/);
        assert.match(settle, /proofId: `tower:\$\{runId\}`/);
        assert.match(state, /current\.appliedProofIds\.includes\(input\.proofId\)/);
        assert.doesNotMatch(state, /input\.(?:amount|defenses|contribution)/);
    });

    it("binds exactly three ready carried pets to an unpaid server-built 3v3 pursuit pack", () => {
        assert.match(showdown, /petIds\.length !== 3 \|\| new Set\(petIds\)\.size !== 3/);
        assert.match(showdown, /activeCarriedPets/);
        assert.match(showdown, /showdownBusyIssue\(myChar, chosen\)/);
        assert.match(showdown, /format: '3v3'/);
        assert.match(showdown, /rewardEligible: false/);
        assert.match(showdown, /showdownWorldCrisis80Key/);
        assert.match(showdown, /proofId: `showdown:\$\{session\.sessionId\}`/);
    });

    it("observes only a committed level-80 crossing on both save authorities", () => {
        for (const source of [save, mutations]) {
            assert.match(source, /beforeLevel < WORLD_CRISIS_80_TRIGGER_LEVEL && afterLevel >= WORLD_CRISIS_80_TRIGGER_LEVEL/);
            assert.match(source, /observeWorldCrisis80LevelCrossing/);
        }
        assert.match(save, /identityName && beforeCharacter && afterCharacter/);
    });
});
