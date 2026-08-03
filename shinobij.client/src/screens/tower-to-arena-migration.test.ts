import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

// The remaining SOLO tower fights (Weekly Boss, Anbu Vault) were migrated off the
// tactical Battle Tower rail (BattleTowerFight) onto the normal Arena shell
// (MissionArenaFight), matching PvE / missions / story. Co-op / N-enemy modes
// (Battle Towers, Endless Spire, Clan Boss) intentionally STAY on BattleTowerFight.
// These guards keep the solo modes from regressing back to the tower shell.
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const missionFight = read("./MissionArenaFight.tsx");
const weeklyWrapper = read("./WeeklyBossFight.tsx");
const weeklyArena = read("./WeeklyBossArena.tsx");
const anbuRaid = read("../features/anbuInfiltration/AnbuVaultRaid.tsx");
const app = read("../App.tsx");

test("MissionArenaFight is a general-purpose solo-arena renderer (actionFn/settleOnAnyDone/onRecordBattle)", () => {
    assert.match(missionFight, /actionFn\?:\s*typeof submitTowerAction/, "must accept an action-route override (Anbu)");
    assert.match(missionFight, /settleOnAnyDone\?:\s*boolean/, "must accept settle-on-any-done (Weekly Boss / Anbu)");
    assert.match(missionFight, /onRecordBattle\?:/, "must accept a battle-history recorder");
    assert.match(missionFight, /\(actionFn \?\? submitTowerAction\)\(runId, me, action\)/, "send() must use the actionFn override when present");
});

test("Weekly Boss renders on the arena shell, not the tower rail", () => {
    // The shared wrapper drives MissionArenaFight with settle-on-any-done.
    assert.match(weeklyWrapper, /<MissionArenaFight/, "WeeklyBossFight must render the arena shell");
    assert.match(weeklyWrapper, /settleOnAnyDone/, "Weekly Boss banks damage on any resolution");
    // Both entry points use the wrapper, neither renders BattleTowerFight.
    assert.match(weeklyArena, /<WeeklyBossFight/, "the menu path must use WeeklyBossFight");
    assert.doesNotMatch(weeklyArena, /<BattleTowerFight|screens\/BattleTowerFight/, "the menu path must not use the tower shell");
    assert.match(app, /<WeeklyBossFight/, "the roaming path (App) must use WeeklyBossFight");
    assert.doesNotMatch(app, /<BattleTowerFight|screens\/BattleTowerFight/, "App must not render the tower shell for the weekly boss");
});

test("Anbu Vault fight renders on the arena shell with its own action route", () => {
    assert.match(anbuRaid, /<MissionArenaFight/, "the vault fight must render the arena shell");
    assert.match(anbuRaid, /actionFn=\{infiltrationAct\}/, "moves must go to the Anbu route, not /api/towers/action");
    assert.match(anbuRaid, /settleOnAnyDone/, "the raid settles on win OR loss");
    assert.doesNotMatch(anbuRaid, /<BattleTowerFight|screens\/BattleTowerFight/, "the vault fight must not use the tower shell");
});
