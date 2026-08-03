import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

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

test("leaving an unresolved fight reports a forfeit before unmounting", () => {
    // Walking out of a fight you are losing must not be cheaper than finishing
    // it. The server scores an unresolved session as a defeat, but only if the
    // client tells it the player left.
    const leave = arena.slice(arena.indexOf("async function leaveFight"), arena.indexOf("async function leaveFight") + 900);
    assert.match(leave, /outcomeFn/, "leaveFight must report the forfeit");
    assert.match(leave, /outcomeReportedRef\.current = true/, "and must not double-report a run already settled");
});

test("story bosses and combat missions both pass the outcome reporter", () => {
    for (const [name, source] of [["StoryBossFightHost", storyHost], ["Missions", missions]] as const) {
        assert.match(source, /outcomeFn=\{/, `${name} must wire outcomeFn, or its defeats cost nothing`);
        assert.match(source, /reportPveFightOutcome\(/, `${name} must call the shared outcome endpoint`);
    }
});

test("the outcome reporter never carries a client-asserted result", () => {
    const api = readFileSync(new URL("./pve-outcome-api.ts", import.meta.url), "utf8");
    const body = api.slice(api.indexOf("JSON.stringify"), api.indexOf("JSON.stringify") + 120);
    assert.match(body, /runId, playerName/, "the body must carry only the run and the caller");
    assert.doesNotMatch(body, /outcome|won|hp|hospitaliz/i, "the SESSION decides the outcome, never the client");
});
