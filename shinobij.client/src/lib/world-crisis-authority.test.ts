import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const screen = readFileSync(new URL("../screens/WorldCrisis.tsx", import.meta.url), "utf8");
const report = readFileSync(new URL("../../../api/missions/report-ai-fight.ts", import.meta.url), "utf8");
const state = readFileSync(new URL("../../../api/world-crisis/_state.ts", import.meta.url), "utf8");
const save = readFileSync(new URL("../../../api/save/[name].ts", import.meta.url), "utf8");
const mutations = readFileSync(new URL("../../../api/save/_mutate-player-save.ts", import.meta.url), "utf8");

describe("world crisis client/server boundary", () => {
    it("launches through the singleton sealed World AI host", () => {
        assert.match(screen, /requestAiFight\(\{/);
        assert.match(screen, /kind: "world-crisis"/);
        assert.match(screen, /sector: 0/);
        assert.doesNotMatch(screen, /fetch\([^)]*report-ai-fight/);
    });

    it("derives contribution only from a settled server outcome and proof token", () => {
        assert.match(report, /sealedWorldContext\.kind === 'world-crisis'[\s\S]*outcome === 'win'/);
        assert.match(report, /proofId: aiFightToken/);
        assert.match(state, /current\.appliedProofIds\.includes\(input\.proofId\)/);
        assert.doesNotMatch(state, /input\.(?:amount|defenses|contribution)/);
    });

    it("observes only a committed crossing on both save authorities", () => {
        for (const source of [save, mutations]) {
            assert.match(source, /beforeLevel < WORLD_CRISIS_TRIGGER_LEVEL && afterLevel >= WORLD_CRISIS_TRIGGER_LEVEL/);
            assert.match(source, /observeWorldCrisisLevelCrossing/);
        }
        assert.match(save, /identityName && beforeCharacter && afterCharacter/);
    });
});
