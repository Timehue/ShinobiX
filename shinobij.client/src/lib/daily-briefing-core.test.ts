import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildRecommendations,
    dailyLoginRyo,
    recommendedMission,
    type RecoInput,
} from "./daily-briefing-core";
import { normalizeOnboardingStep, onboardingStepAtLeast } from "./onboarding-step";

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

test("academy spar recommendation returns to the coach-driven village flow", () => {
    const recos = buildRecommendations({ ...SETTLED, onboardingStep: "academySpar" });
    assert.equal(recos[0].id, "tutorial");
    assert.equal(recos[0].screen, "village");
    assert.match(recos[0].cta, /spar/i);
});

test("new tutorial equipment beats point to the correct screens", () => {
    const loadout = buildRecommendations({ ...SETTLED, onboardingStep: "jutsuLoadout" });
    assert.equal(loadout[0].id, "tutorial");
    assert.equal(loadout[0].screen, "profile");

    const inventory = buildRecommendations({ ...SETTLED, onboardingStep: "inventory" });
    assert.equal(inventory[0].id, "tutorial");
    assert.equal(inventory[0].screen, "inventory");

    const fieldTrip = buildRecommendations({ ...SETTLED, onboardingStep: "sectorReturn" });
    assert.equal(fieldTrip[0].id, "tutorial");
    assert.equal(fieldTrip[0].screen, "worldMap");
});

test("onboarding step normalization preserves veterans and legacy aliases", () => {
    assert.equal(normalizeOnboardingStep(undefined), "done");
    assert.equal(normalizeOnboardingStep(null), "done");
    assert.equal(normalizeOnboardingStep(""), "done");
    assert.equal(normalizeOnboardingStep("spar"), "academySpar");
    assert.equal(normalizeOnboardingStep("tour"), "training");
    assert.equal(normalizeOnboardingStep("storyUnlocked"), "sectorReturn");
    assert.equal(normalizeOnboardingStep("firstMission"), "firstMission");
});

test("onboarding step ordering follows the academy path", () => {
    assert.equal(onboardingStepAtLeast("jutsuLoadout", "inventory"), false);
    assert.equal(onboardingStepAtLeast("inventory", "jutsuLoadout"), true);
    assert.equal(onboardingStepAtLeast("cafeteria", "academySpar"), true);
    assert.equal(onboardingStepAtLeast("storyUnlocked", "sectorReturn"), true);
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
