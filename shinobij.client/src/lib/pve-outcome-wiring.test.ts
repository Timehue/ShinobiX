import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { reportPveFightOutcome } from "./pve-outcome-api";

/*
 * Every server-resolved PvE mode must report what its fight COST.
 *
 * The reward settles (api/story/settle, queue-combat-claim, report-ai-fight) all
 * refuse a losing run by design, so before this a defeat reached the server
 * through nothing at all: the player kept full HP, was never hospitalized, and
 * could walk straight back in. The local Arena has always done the opposite.
 *
 * These are source guards on the WIRING. The rules themselves
 * (resolveAiFightOutcome, applyAiFightOutcomeToCharacter, isPveFightMember) are
 * behaviour-tested in api/missions/_ai-fight-outcome.test.ts — a grep cannot
 * tell a live branch from a dead one, so it is only used for "is this hooked
 * up", never for "does this work".
 */

const arena = readFileSync(new URL("../screens/MissionArenaFight.tsx", import.meta.url), "utf8");
const storyHost = readFileSync(new URL("../components/StoryBossFightHost.tsx", import.meta.url), "utf8");
const missions = readFileSync(new URL("../screens/Missions.tsx", import.meta.url), "utf8");

test("the arena shell reports the outcome on ANY resolution, not just a win", () => {
    assert.match(arena, /outcomeFn\?:/, "the shell must accept an outcome reporter");
    // Gated on `status === "done"` alone — adding a winner check here would
    // reintroduce exactly the hole this closes.
    const effect = arena.slice(arena.indexOf("outcomeReportedRef"), arena.indexOf("outcomeReportedRef") + 700);
    assert.match(effect, /session\.status !== "done"/, "the report must fire on any resolution");
    assert.doesNotMatch(effect, /winner === "squad"/, "a LOSS must report too — that is the whole point");
});

test("abandoning an unresolved fight requires a terminal server forfeit before unmounting", () => {
    // Walking out of a fight you are losing must not be cheaper than finishing
    // it. The server scores an unresolved session as a defeat, but only if the
    // client tells it the player left.
    const leave = arena.slice(arena.indexOf("async function abandonFight"), arena.indexOf("async function abandonFight") + 1800);
    assert.match(leave, /result\.session\.status !== "done"/, "abandonFight must refuse to hide an active session");
    assert.match(leave, /outcomeFn/, "abandonFight must report the forfeit");
    assert.match(leave, /outcomeReportedRef\.current = true/, "and must not double-report a run already settled");
    assert.match(arena, /send\(\{ type: "flee" \}\)/, "Flee must submit its own probabilistic action instead of unmounting");
});

test("every mode on the shared arena shell passes the outcome reporter", () => {
    const weeklyBoss = readFileSync(new URL("../screens/WeeklyBossFight.tsx", import.meta.url), "utf8");
    for (const [name, source] of [["StoryBossFightHost", storyHost], ["Missions", missions]] as const) {
        assert.match(source, /outcomeFn=\{/, `${name} must wire outcomeFn, or its defeats cost nothing`);
        assert.match(source, /reportPveFightOutcome\(/, `${name} must call the shared outcome endpoint`);
    }
    assert.match(weeklyBoss, /outcomeFn=\{settleFn\}/, "Weekly Boss must use its durable settlement as the outcome reporter");
    assert.match(weeklyBoss, /settleOnAnyDone/, "Weekly Boss must bank damage on every completed result");
    assert.doesNotMatch(weeklyBoss, /reportPveFightOutcome\(/, "Weekly Boss must not double-report through the shared endpoint");
});

test("the outcome reporter never carries a client-asserted result", () => {
    const api = readFileSync(new URL("./pve-outcome-api.ts", import.meta.url), "utf8");
    const body = api.slice(api.indexOf("JSON.stringify"), api.indexOf("JSON.stringify") + 120);
    assert.match(body, /runId, playerName/, "the body must carry only the run and the caller");
    assert.doesNotMatch(body, /outcome|won|hp|hospitaliz/i, "the SESSION decides the outcome, never the client");
});

test("terminal action/state responses reconcile physical outcomes server-side", () => {
    const action = readFileSync(new URL("../../../api/solo-pve/action.ts", import.meta.url), "utf8");
    const state = readFileSync(new URL("../../../api/solo-pve/state.ts", import.meta.url), "utf8");
    const missionQueue = readFileSync(new URL("../../../api/missions/queue-combat-claim.ts", import.meta.url), "utf8");
    assert.match(action, /reconcileTerminalSoloPveOutcome\(terminal, playerName\)/, "the terminal action response must wait for physical settlement");
    assert.match(state, /reconcileTerminalSoloPveOutcome\(session, playerName\)/, "a reconnect must repair an interrupted physical settlement");
    assert.ok(
        state.indexOf("reconcileTerminalSoloPveOutcome(session, playerName)") < state.indexOf("session.expiresAt <= Date.now()"),
        "a still-readable expired terminal session must repair its outcome before returning 410",
    );
    assert.match(missionQueue, /settlePveFightOutcome\(initialSession!, playerName\)/, "a mission reward must not queue before its physical cost");
});

test("the mission screen adopts authoritative character and save versions", () => {
    assert.match(missions, /responseAccepted = onServerVersion\?\.\(data\?\._saveVersion\) !== false/, "mission queue settlement must advance and guard the save version");
    assert.match(missions, /updateCharacter\(data\.character\)/, "mission queue settlement must install the authoritative save character");
    assert.match(missions, /responseAccepted = onServerVersion\?\.\(applied\._saveVersion\) !== false/, "physical outcome confirmation must advance and guard the save version");
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    assert.match(app, /<Missions[^>]+onServerVersion=/s, "App must connect Missions to its optimistic-concurrency version ref");
});

test("client confirmation retries a lost response instead of silently returning null", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
        calls += 1;
        if (calls === 1) throw new Error("simulated lost response");
        return new Response(JSON.stringify({ ok: true, outcome: "win", applied: false, replayed: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    };
    try {
        const result = await reportPveFightOutcome("mission-run", "Alice");
        assert.equal(calls, 2);
        assert.equal(result.replayed, true);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
