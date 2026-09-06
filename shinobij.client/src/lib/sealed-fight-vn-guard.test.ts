import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { onStoryBossFightRequest, requestStoryBossFight, type StoryFightTheme } from "./story-fight-theme";

/*
 * Guards on the seam that made auto-triggered visual novels replay on top of the
 * fight they had just launched.
 *
 * Both sealed hosts render their fight in a BODY PORTAL, so App's `screen` never
 * moves while one is up. The VN auto-triggers gate on the screen, so they read
 * back "not in a battle" for the whole fight — and a story chapter is not consumed
 * by being read (only a sealed boss WIN consumes it). Picking a lane therefore
 * closed the scene, launched the boss, and immediately re-offered the very same
 * chapter over the top of it at z-index 1000000; picking again just restarted the
 * loop, and Skip — the one control that dismisses a scene for the session —
 * revealed the battle that had been running underneath.
 *
 * Three facts hold that shut, and all three are cheap to break silently.
 */

const theme = (): StoryFightTheme => ({ bossName: "Stormveil Training Scout" });

test("the story-fight bus reports the host's verdict, not merely that one is mounted", () => {
    assert.equal(requestStoryBossFight(theme()), false, "no host mounted → fail closed");

    const seen: StoryFightTheme[] = [];
    let accept = false;
    const unsubscribe = onStoryBossFightRequest((requested) => {
        seen.push(requested);
        return accept;
    });
    try {
        // A busy host (a start already in flight, a fight already on screen) declines.
        // Answering `true` here is what closed the chapter VN onto no fight at all.
        assert.equal(requestStoryBossFight(theme()), false);
        accept = true;
        assert.equal(requestStoryBossFight(theme()), true);
        assert.equal(seen.length, 2, "the host must see both requests");
    } finally {
        unsubscribe();
    }
    assert.equal(requestStoryBossFight(theme()), false, "unsubscribing restores fail-closed");
});

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const storyHost = readFileSync(new URL("../components/StoryBossFightHost.tsx", import.meta.url), "utf8");
const aiHost = readFileSync(new URL("../components/AiFightHost.tsx", import.meta.url), "utf8");
const triggeredBattle = readFileSync(new URL("./triggered-event-battle.ts", import.meta.url), "utf8");

test("both sealed hosts announce themselves engaged from acceptance, not from the opened session", () => {
    // The sealed start is a network round-trip and the caller dismisses its launch
    // UI immediately, so announcing only once the session lands leaves that whole
    // window looking like "nothing is fighting" — which is the window the VN
    // auto-trigger fires in.
    for (const [name, host] of [["StoryBossFightHost", storyHost], ["AiFightHost", aiHost]] as const) {
        assert.match(host, /onFightOpenChange/, `${name} must announce open/close`);
        assert.match(host, /const open = starting \|\| !!activeFight/, `${name} must count an accepted-but-unopened start as engaged`);
        assert.match(host, /setStarting\(true\)/, `${name} must mark acceptance`);
        assert.match(host, /setStarting\(false\)/, `${name} must release it when the start settles`);
    }
});

test("App tracks both hosts and the VN auto-triggers consult them", () => {
    assert.match(app, /onFightOpenChange=\{setStoryFightOpen\}/, "App must track the story host");
    assert.match(app, /onFightOpenChange=\{setAiFightOpen\}/, "App must track the AI host");
    assert.match(app, /useSealedFightPresence\(\)/, "both must feed one presence value");
    // The ref, not the state: a host announces from a CHILD effect, which React
    // flushes before App's own effects in the same commit, so the state the effect
    // closed over is still stale exactly when the VN would re-open.
    assert.match(
        app,
        // `[^}]` already matches newlines, so keep it a single unambiguous class:
        // the `(?:[^}]|\n)` alternation this replaced overlapped itself and was a
        // genuine ReDoS (js/redos, caught by CodeQL on this PR).
        /function isBattleFlowScreen\([^)]*\): boolean \{[^}]*?sealedFightOnScreen \|\| sealedFightEngagedRef\.current/,
        "isBattleFlowScreen must treat an engaged sealed fight as a battle flow",
    );
    const guards = app.match(/if \(isBattleFlowScreen\(screen, sealedFightOpen\)\) return;/g) ?? [];
    assert.equal(guards.length, 3, "all three VN auto-trigger effects must gate on the sealed fight");
    // The story beat resolves behind a lazy import, so re-check after the await too.
    assert.match(app, /vnTriggerClaimRef\.current \|\| sealedFightEngagedRef\.current\) return;/);
});

test("a declined chapter launch keeps the scene open instead of falling through to a practice bout", () => {
    const chapter = triggeredBattle.slice(triggeredBattle.indexOf("const chapterIndex"), triggeredBattle.indexOf("const opponent"));
    // `\s+`, not `\s*\n\s*` — `\s` matches newlines, so that spelling was ambiguous too.
    assert.match(chapter, /if \(started\) setActiveEvent\(null\);[\s\S]*?return;/,
        "the current chapter's boss is the sealed fight or nothing — never the flavor arena");
    assert.doesNotMatch(chapter, /requestAiFight/, "the chapter branch must not reach the practice launcher");
});
