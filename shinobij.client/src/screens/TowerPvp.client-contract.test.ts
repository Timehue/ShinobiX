import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const fight = readFileSync(new URL("./BattleTowerFight.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../components/TowerPvpPanel.tsx", import.meta.url), "utf8");
const wrapper = readFileSync(new URL("./BattleTowers.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

test("the live MPvP board reconciles its own match pushes and retains an outage poll", () => {
    assert.match(fight, /kick\.channel === "pvp" && kick\.matchId === runId/);
    assert.match(fight, /kick\.channel === "session" && kick\.runId === runId/);
    assert.match(fight, /kick\.channel === "reconcile" \|\| matchesFight/);
    assert.match(fight, /visiblePoll\(poll, realtimeConnected \? 20_000 : 2_500, 0\.08\)/);
    assert.match(fight, /if \(inFlight\) \{[\s\S]{0,100}?refreshPending = true/);
    assert.match(fight, /if \(alive && refreshPending\) queueMicrotask\(poll\)/);
});

test("ready-room side effects run only for an accepted monotonic match revision", () => {
    const adoptionStart = panel.indexOf("const adoptPresence");
    const refreshStart = panel.indexOf("useEffect(() =>", adoptionStart);
    assert.ok(adoptionStart >= 0 && refreshStart > adoptionStart);
    const adoption = panel.slice(adoptionStart, refreshStart);
    assert.match(adoption, /const current = presenceRef\.current/);
    assert.match(adoption, /current\.match\.version > next\.match\.version\) return false/);
    const rejection = adoption.indexOf("return false");
    assert.ok(rejection >= 0 && rejection < adoption.indexOf("onMatchLockChange"));
    assert.ok(rejection < adoption.indexOf("onEnter(nextMatch)"));
    assert.match(panel, /if \(requestRef\.current\) \{[\s\S]{0,120}?refreshPending = true;[\s\S]{0,80}?return;/,
        "an HTTP read predating a mutation must not overwrite its response");
});

test("forfeit bypasses turn-target gating and cannot present a clickable silent no-op", () => {
    const promptAt = fight.indexOf("Forfeit your fighter from this 2v2 match?");
    assert.ok(promptAt >= 0);
    const control = fight.slice(Math.max(0, promptAt - 500), promptAt + 500);
    assert.match(control, /disabled=\{busy\}/);
    assert.match(control, /void send\(\{ type: "forfeit" \}\)/);
    assert.doesNotMatch(control, /!myTurn|if \(myTurn\)|if \(!myTurn\)/);
});

test("viewer-relative rivals remain identified as live humans with a turn countdown", () => {
    assert.match(fight, /\(isTeamPvp \|\| activeActor\.side !== "enemy"\)/);
    assert.match(fight, /isTeamPvp && activeActor\.ai === false \? `[^`]*\$\{activeActor\.name\}'s turn`/);
    assert.match(fight, /activeIsLiveHuman && session\.turnStartedAt \? <TowerTurnCountdown/);
});

test("recovery and ready-toggle copy describe the actions the UI actually permits", () => {
    assert.match(fight, /Showing the last confirmed battlefield\. Actions remain available and the server will verify the current revision\./);
    assert.match(panel, /me\?\.ready \? "Mark not ready" : "Ready up"/);
    assert.doesNotMatch(fight, /Commands resume after the connection recovers/);
});

test("MPvP refresh recovery preserves the prefixed match lock through App boot", () => {
    // Team Arena lives in the BATTLE ARENA now. The Towers wrapper must refuse
    // to resume its key, and boot recovery must route the match to the arena.
    assert.match(wrapper, /towerPvpMatchIdFromRunKey\(saved\)/);
    assert.doesNotMatch(wrapper, /phase: "pvpFight"/);
    assert.match(app, /const arena2v2 = bootLock\.meta\?\.mode === "mpvp"/);
    assert.match(app, /setScreen\(arena2v2 \? "battleArena" : "battleTowers"\)/);
    // The queue + board are one self-contained Battle Arena section.
    const section = readFileSync(new URL("../components/TeamArenaSection.tsx", import.meta.url), "utf8");
    assert.match(section, /<TowerPvpPanel/);
    assert.match(section, /variant="team-pvp"/);
    assert.doesNotMatch(readFileSync(new URL("./BattleTowersLobby.tsx", import.meta.url), "utf8"), /TowerPvpPanel/);
});
