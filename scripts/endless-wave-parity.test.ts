import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as server from "../api/endless/_run";
import {
    endlessScaleFactor as serverFactor,
    endlessWaveReward as serverReward,
    endlessMilestoneReward as serverMilestone,
} from "../api/endless/_run";
import * as client from "../shinobij.client/src/lib/endless-tower";
import {
    endlessScaleFactor as clientFactor,
    endlessWaveReward as clientReward,
    endlessTowerMilestoneReward as clientMilestone,
} from "../shinobij.client/src/lib/endless-tower";
import { endlessWaveSeed, scaleEndlessProfile, type EndlessProfile } from "../api/endless/_wave-opponent";

// The parity below is between the client mirror and the server's CODE defaults.
// An env override on Railway is a server-only kill switch, so clear any here.
const DIALS = ["ENDLESS_REWARD_MULT", "ENDLESS_FACTOR_CAP_WAVE", "ENDLESS_LEVEL_CAP", "ENDLESS_FS_LIFETIME_FIRST", "ENDLESS_BC_FIRST_RUN_OF_DAY"] as const;
for (const name of DIALS) delete process.env[name];
// Either side of every clamp (level 70, wave 20) plus the extremes.
const LEVELS = [1, 10, 30, 50, 69, 70, 71, 90, 100, 150];

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
        for (const level of LEVELS) {
            assert.deepEqual(clientReward(wave, level), { ...serverReward(wave, level), isMilestone: wave % 5 === 0 },
                `reward drift at wave ${wave}, level ${level}`);
        }
        assert.deepEqual(clientMilestone(wave), serverMilestone(wave));
    }
});

test("the client mirrors every Endless rebalance dial default", () => {
    for (const name of DIALS) {
        assert.equal(client[name], server[name], `${name} drifted between client and server`);
    }
    // With no env override, the server's call-time dials equal those defaults.
    assert.equal(server.endlessRewardMult(), client.ENDLESS_REWARD_MULT);
    assert.equal(server.endlessFactorCapWave(), client.ENDLESS_FACTOR_CAP_WAVE);
    assert.equal(server.endlessLevelCap(), client.ENDLESS_LEVEL_CAP);
    assert.equal(server.endlessFsLifetimeFirst(), client.ENDLESS_FS_LIFETIME_FIRST);
    assert.equal(server.endlessBcFirstRunOfDay(), client.ENDLESS_BC_FIRST_RUN_OF_DAY);
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
    const fight = readFileSync("shinobij.client/src/screens/EndlessTowerFight.tsx", "utf8");
    assert.doesNotMatch(math, /Math\.random|scaleEndlessAiClone|pickScaledEndlessAi|applyTowerCashOut/);
    assert.doesNotMatch(actions, /prepareOpponent|aiFightToken|\bhp\s*:|\bchakra\s*:|\bstamina\s*:/);
    assert.match(fight, /MissionArenaFight/);
    assert.match(fight, /soloPveArenaTransport/);
    assert.doesNotMatch(`${actions}\n${fight}`, /onEndless|endlessBattleWave|endlessSettlementPending/);
});
