import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

/*
 * Source guards on the SEALED Academy spar's client wiring (step 5 of the
 * AI-fight migration). The spar shares StoryBossFightHost and the arena shell
 * with story-boss chapters, and the three ways that sharing goes wrong are all
 * silent — nothing throws, the fight still plays, and the tutorial is just
 * quietly worse:
 *
 *   1. local fallback     → the client becomes combat authority again
 *   2. no coaching        → a brand-new player is dropped into a fight with no hints
 *   3. chapter theming    → the chapter-seal sting fires for a training dummy
 *
 * Guards, not behaviour: the rules with real logic (the opponent, eligibility,
 * the settle) are behaviour-tested in api/story/_academy-spar.test.ts and
 * scripts/academy-spar-parity.test.ts. A grep only answers "is this hooked up".
 */

const host = readFileSync(new URL("../components/StoryBossFightHost.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const arena = readFileSync(new URL("../screens/MissionArenaFight.tsx", import.meta.url), "utf8");
const coach = readFileSync(new URL("../components/SparCoach.tsx", import.meta.url), "utf8");

test("the spar launch is fail-closed on the sealed server path", () => {
    const launch = app.slice(app.indexOf("function startAcademySparringMatch"), app.indexOf("function startAcademySparringMatch") + 1400);
    assert.match(launch, /requestStoryBossFight\(/, "the spar must launch through the sealed-fight bus");
    assert.match(launch, /kind: "academySpar"/, "…as a spar, not a chapter boss");
    assert.doesNotMatch(launch, /playLocally:|buildAcademySparDummy|temp-academy-spar|setScreen\("arena"\)/);
});

test("the bus never invokes client combat when no host is mounted", () => {
    const bus = readFileSync(new URL("./story-fight-theme.ts", import.meta.url), "utf8");
    const fn = bus.slice(bus.indexOf("export function requestStoryBossFight"), bus.indexOf("export function requestStoryBossFight") + 260);
    assert.match(fn, /if \(!listener\) return false/);
    assert.doesNotMatch(fn, /playLocally/);
});

test("the host reports a sealed-start failure without local combat", () => {
    const subscribe = host.indexOf("return onStoryBossFightRequest((theme)");
    assert.notEqual(subscribe, -1, "the host must still subscribe to the fight bus");
    const activeFight = host.indexOf("const activeFight =", subscribe);
    assert.ok(activeFight > subscribe, "could not bound the sealed-start subscription");
    const start = host.slice(subscribe, activeFight);
    assert.match(start, /startAcademySparCombat\(/, "the spar must start its own sealed endpoint");
    const catchStart = start.indexOf(".catch((error) =>");
    const finallyStart = start.indexOf(".finally(() =>", catchStart);
    assert.ok(catchStart >= 0 && finallyStart > catchStart, "could not isolate the sealed-start failure path");
    const failure = start.slice(catchStart, finallyStart);
    assert.match(failure, /mountedRef\.current/);
    assert.match(failure, /startRequestIdRef\.current === requestId/);
    assert.match(failure, /activePlayerKeyRef\.current === originatingPlayerKey/);
    assert.ok(
        failure.indexOf("activePlayerKeyRef.current === originatingPlayerKey") < failure.indexOf("alert("),
        "a stale Academy start failure must not alert after the player switches accounts",
    );
    assert.doesNotMatch(start, /playLocally|TowerSession|towerArenaTransport/);
    assert.match(start, /startAcademySparCombat\(\{ playerName: originatingPlayerName \}\)/);
});

test("a sealed spar keeps its coaching and skips the chapter presentation", () => {
    assert.match(host, /soloPveArenaTransport/);
    assert.match(host, /coach=\{isSpar \? "academySpar" : undefined\}/, "the spar must get the in-battle coaching banner");
    assert.match(host, /storyTheme=\{isSpar \? undefined : theme\}/, "a training dummy must not fire chapter stings or wear the chapter backdrop");
});

test("the coaching banner is not painted behind the fight it coaches", () => {
    // MissionArenaFight's portal sits at z-index 1000000 and SparCoach portals to
    // document.body, so its default 9000 would be invisible there.
    assert.match(coach, /zIndex = 9000/, "the default must still clear the local Arena spar");
    const mount = arena.slice(arena.indexOf("<SparCoach"), arena.indexOf("<SparCoach") + 320);
    assert.match(mount, /zIndex=\{1_000_001\}/, "the sealed spar must raise the banner above the fight portal");
});

test("the onboarding modal stands down while the sealed fight is on screen", () => {
    // The sealed fight is a body portal, so App's `screen` stays "village" and the
    // screen-keyed coach would otherwise stay mounted UNDER it — carrying a live
    // r3f companion canvas (no demand frameloop) through the whole tutorial fight.
    assert.match(host, /onFightOpenChange/, "the host must announce open/close");
    assert.match(app, /onFightOpenChange=\{setStoryFightOpen\}/, "App must track it");
    assert.match(app, /screen !== "arena" && !storyFightOpen/, "the coach must hide for the sealed spar as well as the local one");
});

test("coaching progress follows authoritative success and never gates a move", () => {
    const sendStart = arena.indexOf("async function send(");
    const send = arena.slice(sendStart, arena.indexOf("function resetTargeting", sendStart));
    const responseStart = send.indexOf("const res = await transport.submitAction");
    const rejectionStart = send.indexOf("if (!res.applied)");
    const successStart = send.indexOf("} else {", rejectionStart);
    const catchStart = send.indexOf("} catch", successStart);
    assert.ok(responseStart >= 0, "the lesson action must still be submitted to combat authority");
    assert.ok(rejectionStart > responseStart && successStart > rejectionStart && catchStart > successStart,
        "tutorial state must be considered only after the server distinguishes rejection from success");
    const rejectionBranch = send.slice(rejectionStart, successStart);
    const successBranch = send.slice(successStart, catchStart);
    assert.doesNotMatch(rejectionBranch, /setSpar(?:Attacked|Casted)\(true\)/,
        "rejected intent must not advance the tutorial");
    assert.match(successBranch, /if \(action\.type === "attack"\) setSparAttacked\(true\)/);
    assert.match(successBranch, /if \(action\.type === "jutsu"\) setSparCasted\(true\)/);
    // The flags remain display-only: they may react to an accepted move, but
    // they must never decide whether a real action is sent.
    assert.doesNotMatch(send, /if \(sparAttacked|if \(sparCasted/, "coaching state must never gate a combat move");
});
