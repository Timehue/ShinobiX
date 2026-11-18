import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const missionFight = read("./MissionArenaFight.tsx");
const weeklyWrapper = read("./WeeklyBossFight.tsx");
const weeklyArena = read("./WeeklyBossArena.tsx");
const shadowguardRaid = read("../features/shadowguardInfiltration/ShadowguardVaultRaid.tsx");
const app = read("../App.tsx");
const worldBossHub = read("./WorldBossesHub.tsx");

test("MissionArenaFight is a runtime-neutral server-arena renderer", () => {
    assert.match(missionFight, /transport:\s*ServerArenaTransport/);
    assert.match(missionFight, /settleOnAnyDone\?:\s*boolean/);
    assert.match(missionFight, /onRecordBattle\?:/);
    assert.match(missionFight, /transport\.submitAction\(runId, me, session, action\)/);
    assert.doesNotMatch(missionFight, /towers-api|submitTowerAction|fetchTowerState/);
});

test("Weekly Boss renders on the arena shell, not the tower rail", () => {
    assert.match(weeklyWrapper, /<MissionArenaFight/);
    assert.match(weeklyWrapper, /settleOnAnyDone/);
    assert.match(weeklyArena, /<WeeklyBossFight/);
    assert.doesNotMatch(weeklyArena, /<BattleTowerFight|screens\/BattleTowerFight/);
    assert.match(app, /<WorldBossesHub/);
    assert.match(worldBossHub, /<WeeklyBossArena/);
    assert.doesNotMatch(app, /<WeeklyBossFight/);
    assert.doesNotMatch(app, /<BattleTowerFight|screens\/BattleTowerFight/);
});

test("Shadowguard Vault fight renders on the arena shell with a guarded Solo PvE transport", () => {
    assert.match(shadowguardRaid, /<MissionArenaFight/);
    assert.match(shadowguardRaid, /soloPveSessionForArena\(fight\.session\)/);
    assert.match(shadowguardRaid, /\.\.\.soloPveArenaTransport/);
    assert.match(shadowguardRaid, /soloPveArenaTransport\.(?:fetchState|submitAction)/);
    assert.match(shadowguardRaid, /transport=\{guardedArenaTransport\}/);
    assert.match(shadowguardRaid, /settleOnAnyDone/);
    assert.doesNotMatch(shadowguardRaid, /createTowerArenaTransport|infiltrationAct|towerSessionForArena|<BattleTowerFight|screens\/BattleTowerFight/);
});
