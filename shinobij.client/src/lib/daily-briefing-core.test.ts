import { test } from "node:test";
import assert from "node:assert/strict";
import {
    SESSION_MISSION_GOAL,
    buildRecommendations,
    dailyLoginRyo,
    missionProgressDetail,
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
    examsPassed: ["genin", "chunin"],
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

test("a recommended mission names the specific hunt and routes to the Hunter Board", () => {
    const recos = buildRecommendations({ ...SETTLED, hasMissionSlot: true });
    const mission = recos.find((r) => r.id === "mission");
    assert.ok(mission);
    assert.match(mission!.title, /Shadow Panther/);
    // recommendedMission() picks from the builtin HUNT catalog, and hunt
    // contracts are accepted at the Hunter Board — NOT the Mission Hall, which
    // never lists them. Routing to "missions" sent the player somewhere the
    // mission they had just been told to run did not exist.
    assert.equal(mission!.screen, "hunting");
});

test("a mission recommendation with no named hunt still routes to the Mission Hall", () => {
    // No hunt qualifies at this level, so the generic prompt is used.
    const recos = buildRecommendations({ ...SETTLED, hasMissionSlot: true, recommendedMissionName: null });
    const mission = recos.find((r) => r.id === "mission");
    assert.ok(mission);
    assert.equal(mission!.title, "Run a mission");
    assert.equal(mission!.screen, "missions");
});

test("no-profession prompt appears at the level-13 profession unlock", () => {
    const low = buildRecommendations({ ...SETTLED, hasProfession: false, level: 12 });
    assert.ok(!low.some((r) => r.id === "profession"));
    const high = buildRecommendations({ ...SETTLED, hasProfession: false, level: 13 });
    assert.ok(high.some((r) => r.id === "profession"));
});

test("rank gate recommendations call out the level-20 and level-39 holds", () => {
    const geninHold = buildRecommendations({ ...SETTLED, level: 20, examsPassed: [], hasMissionSlot: true });
    assert.equal(geninHold.find((r) => r.id === "genin-exam")?.screen, "logbook");
    assert.ok(geninHold.findIndex((r) => r.id === "genin-exam") < geninHold.findIndex((r) => r.id === "mission"));

    const chuninHold = buildRecommendations({ ...SETTLED, level: 39, examsPassed: ["genin"], hasMissionSlot: true });
    assert.equal(chuninHold.find((r) => r.id === "chunin-exam")?.screen, "logbook");
    assert.ok(chuninHold.findIndex((r) => r.id === "chunin-exam") < chuninHold.findIndex((r) => r.id === "mission"));
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

// ── Session-goal framing ─────────────────────────────────────────────────────
// The briefing used to render mission progress as `3/20`. The 20 is a generous
// HEADROOM cap for a long session, not a target, but shown that way it reads to a
// half-hour player as seventeen unfinished chores every single day.

test("mission progress is framed against a reachable session goal, not the daily cap", () => {
    // A fresh session must not lead with the cap at all.
    const none = missionProgressDetail(0, 20);
    assert.doesNotMatch(none, /20/, "an untouched day must not present the cap as a target");
    assert.match(none, /solid session/);

    // Part-way through, the remaining count is to the SESSION goal, not the cap.
    const some = missionProgressDetail(3, 20);
    assert.match(some, /3 done today/);
    assert.match(some, new RegExp(`${SESSION_MISSION_GOAL - 3} more`));
    assert.doesNotMatch(some, /20/, "the cap must not reappear as the shortfall");
});

test("past a normal session the cap becomes useful headroom instead of a debt", () => {
    const heavy = missionProgressDetail(12, 20);
    assert.match(heavy, /12\/20/, "a heavy player still sees real remaining headroom");
    assert.match(heavy, /strong session/);
});

test("mission progress copy survives nonsense inputs and tiny caps", () => {
    // A cap below the session goal must clamp, never promise more than exists.
    assert.match(missionProgressDetail(2, 2), /2\/2/);
    assert.match(missionProgressDetail(-5, 0), /solid session|strong session/);
    assert.doesNotMatch(missionProgressDetail(0, 20), /NaN|undefined/);
});

test("the mission recommendation uses the session-goal copy", () => {
    const recos = buildRecommendations({ ...SETTLED, hasMissionSlot: true, missionsDone: 0, missionCap: 20 });
    const mission = recos.find((r) => r.id === "mission");
    assert.ok(mission, "a free mission slot must still recommend a mission");
    assert.equal(mission.detail, missionProgressDetail(0, 20));
});
