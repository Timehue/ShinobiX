import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolveStoryContinuation } from "./story-load-authority";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

test("a delayed story load cannot commit after an account switch", async () => {
    const gate = deferred<string>();
    let active = "Kaya";
    const result = resolveStoryContinuation(() => gate.promise, " Kaya ", () => active);
    active = "Ren";
    gate.resolve("chapter");
    assert.deepEqual(await result, { current: false });
});

test("a delayed story load cannot commit after its effect becomes stale", async () => {
    const gate = deferred<string>();
    let stale = false;
    const result = resolveStoryContinuation(() => gate.promise, "Kaya", () => "kaya", () => stale);
    stale = true;
    gate.resolve("chapter");
    assert.deepEqual(await result, { current: false });
});

test("the current normalized account receives the resolved story value", async () => {
    assert.deepEqual(await resolveStoryContinuation(async () => "chapter", " Kaya ", () => "kAyA"), { current: true, value: "chapter" });
});

test("story delivery re-checks account authority after every lazy content seam", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const delivery = readFileSync(new URL("./use-story-delivery.ts", import.meta.url), "utf8");
    assert.equal((app.match(/resolveStoryContinuation\(/g) ?? []).length, 1);
    assert.match(app, /resolveStoryContinuation\(\(\) => forcedId \? currentStoryChapterTrigger\(character\) : nextStoryTrigger\(/);
    assert.match(delivery, /if \(stale \|\| !accountIsCurrentRef\.current\(character\.name\)\) return/);
});

test("delayed narrative delivery stays blocked for the entire Echoes battle venue", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const delivery = readFileSync(new URL("./use-story-delivery.ts", import.meta.url), "utf8");
    assert.match(
        app,
        /blocked:\s*storyFightOpen\s*\|\|\s*isBattleFlowScreen\(screen\)\s*\|\|\s*screen === "hollowGateShrine"\s*\|\|\s*screen === "echoesOfWar"/,
    );
    assert.match(delivery, /if \(!character \|\| activeEvent \|\| blocked\) return/);
    assert.match(delivery, /return \(\) => \{ stale = true; \}/);
    assert.match(delivery, /\[activeEvent, blocked, character, retry, triggeredEvents\]/);
});
