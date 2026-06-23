import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildRecommendations,
    dailyLoginRyo,
    recommendedMission,
    type RecoInput,
} from "./daily-briefing-core";

// A "nothing pressing" baseline: veteran, healed, all training busy, no slots.
const SETTLED: RecoInput = {
    hospitalized: false,
    onboardingStep: "done",
    unspentStats: 0,
    level: 40,
    hasMissionSlot: false,
    missionsDone: 20,
    missionCap: 20,
    recommendedMissionName: "Hunt the Shadow Panther",
    hasProfession: true,
    trainingIdle: false,
    jutsuTrainingIdle: false,
    hasJutsu: true,
    petTrainingIdle: false,
    hasPets: true,
};

test("dailyLoginRyo mirrors the server curve (modest, capped)", () => {
    assert.equal(dailyLoginRyo(5), 1000);
    assert.equal(dailyLoginRyo(50), 5500);
    assert.equal(dailyLoginRyo(100), 8000);
});

test("recommendedMission scales with level band", () => {
    assert.equal(recommendedMission(1)?.rank, "D Rank");
    assert.equal(recommendedMission(20)?.rank, "C Rank");
    assert.equal(recommendedMission(35)?.rank, "B Rank");
    assert.equal(recommendedMission(55)?.rank, "A Rank");
    assert.equal(recommendedMission(80)?.rank, "S Rank");
});

test("hospitalized is the top recommendation", () => {
    const recos = buildRecommendations({ ...SETTLED, hospitalized: true });
    assert.equal(recos[0].id, "heal");
    assert.equal(recos[0].screen, "hospital");
});

test("mid-tutorial pushes the next academy step ahead of generic advice", () => {
    const recos = buildRecommendations({ ...SETTLED, onboardingStep: "jutsu", hasMissionSlot: true });
    assert.equal(recos[0].id, "tutorial");
    assert.equal(recos[0].screen, "jutsuTraining");
});

test("unspent stat points and idle training are surfaced", () => {
    const recos = buildRecommendations({ ...SETTLED, unspentStats: 3, trainingIdle: true });
    const ids = recos.map((r) => r.id);
    assert.ok(ids.includes("stats"));
    assert.ok(ids.includes("training"));
    // unspent points rank above idle training
    assert.ok(ids.indexOf("stats") < ids.indexOf("training"));
});

test("a recommended mission names the specific hunt", () => {
    const recos = buildRecommendations({ ...SETTLED, hasMissionSlot: true });
    const mission = recos.find((r) => r.id === "mission");
    assert.ok(mission);
    assert.match(mission!.title, /Shadow Panther/);
    assert.equal(mission!.screen, "missions");
});

test("no-profession prompt only appears at level 10+", () => {
    const low = buildRecommendations({ ...SETTLED, hasProfession: false, level: 8 });
    assert.ok(!low.some((r) => r.id === "profession"));
    const high = buildRecommendations({ ...SETTLED, hasProfession: false, level: 20 });
    assert.ok(high.some((r) => r.id === "profession"));
});

test("falls back to explore when nothing is pressing", () => {
    const recos = buildRecommendations(SETTLED);
    assert.equal(recos.length, 1);
    assert.equal(recos[0].id, "explore");
    assert.equal(recos[0].screen, "worldMap");
});

test("a brand-new low level still gets a D-rank mission suggestion", () => {
    const recos = buildRecommendations({
        ...SETTLED, level: 3, onboardingStep: "done",
        hasMissionSlot: true, missionsDone: 0,
        recommendedMissionName: recommendedMission(3)?.name,
    });
    const mission = recos.find((r) => r.id === "mission");
    assert.ok(mission);
});
