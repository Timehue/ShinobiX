import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    endlessScaleFactor as serverFactor,
    endlessWaveReward as serverReward,
    endlessMilestoneReward as serverMilestone,
} from "../api/endless/_run";
import {
    endlessScaleFactor as clientFactor,
    endlessWaveReward as clientReward,
    endlessTowerMilestoneReward as clientMilestone,
} from "../shinobij.client/src/lib/endless-tower";
import { endlessWaveSeed, scaleEndlessProfile, type EndlessProfile } from "../api/endless/_wave-opponent";

const BASE: EndlessProfile = {
    id: "builtin-ai-academy-sparring",
    name: "Sparring Partner",
    level: 20,
    hp: 2400,
    chakra: 1800,
    stamina: 1700,
    stats: { strength: 310, speed: 305 },
};

test("display-only Endless previews match authoritative reward math", () => {
    for (let wave = 1; wave <= 200; wave++) {
        assert.equal(clientFactor(wave), serverFactor(wave), `factor drift at wave ${wave}`);
        assert.deepEqual(clientReward(wave, 50), { ...serverReward(wave, 50), isMilestone: wave % 5 === 0 });
        assert.deepEqual(clientMilestone(wave), serverMilestone(wave));
    }
});

test("server-owned opponent scaling keeps its caps and milestone label", () => {
    const shallow = scaleEndlessProfile(BASE, 1);
    const milestone = scaleEndlessProfile(BASE, 10);
    const deep = scaleEndlessProfile(BASE, 200);
    assert.equal(shallow.hp, BASE.hp);
    assert.match(String(milestone.name), /^★ /);
    assert.equal(deep.hp, Number(BASE.hp) * 5);
    assert.equal(deep.chakra, Number(BASE.chakra) * 3);
    assert.equal(deep.stats?.strength, Number(BASE.stats?.strength) * 4);
});

test("server-owned wave selection seed is deterministic", () => {
    assert.equal(endlessWaveSeed("run-token-123456", 17), endlessWaveSeed("run-token-123456", 17));
    assert.notEqual(endlessWaveSeed("run-token-123456", 17), endlessWaveSeed("run-token-123456", 18));
});

test("the client contains no Endless opponent, combat, or economy authority", () => {
    const math = readFileSync("shinobij.client/src/lib/endless-tower.ts", "utf8");
    const actions = readFileSync("shinobij.client/src/lib/use-endless-tower-actions.ts", "utf8");
    const arena = readFileSync("shinobij.client/src/screens/Arena.tsx", "utf8");
    assert.doesNotMatch(math, /Math\.random|scaleEndlessAiClone|pickScaledEndlessAi|applyTowerCashOut/);
    assert.doesNotMatch(actions, /prepareOpponent|aiFightToken|\bhp\s*:|\bchakra\s*:|\bstamina\s*:/);
    assert.doesNotMatch(arena, /onEndless|endlessBattleWave|endlessSettlementPending/);
});
