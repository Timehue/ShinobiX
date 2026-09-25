/*
 * A Beastbound Warfront must always reach its result screen, and must never do
 * it through a mid-battle exit. The ✕ exit was removed (797b81715) because it
 * stranded players; these pins keep both halves of that ruling: every state
 * that used to wait on a retry or a reload now progresses, and the rewarded
 * match still has no way out except its own result screen.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const rite = read("../components/PetWarfrontRite.tsx");
const shell = read("../components/PetWarfrontRiteStage.tsx");
const stage3d = read("../components/PetWarfrontRiteStage3D.tsx");
const arena = read("../screens/PetArena.tsx");
const css = read("../styles/pet-warfront-rite.css");

/** The live clash view: everything WarfrontRiteMatch renders once a clash exists. */
const clashView = rite.slice(rite.indexOf('<div className="wfr-stage">'));

test("the rewarded clash view offers no exit, and skipping exists only for spectators", () => {
    assert.ok(clashView.length > 0 && clashView.includes("<PetWarfrontRiteStage"));
    assert.doesNotMatch(clashView, /onExit|wfr-exit|Leave the Warfront/,
        "the owner removed the mid-battle exit because it stranded players; do not put it back");
    assert.match(clashView, /\{spectator \? \(\s*<button[\s\S]*?className="wfr-skip"[\s\S]*?Skip to result/,
        "Skip to result renders only for replay/spectator viewers");
    const arenaRite = arena.slice(arena.indexOf("<PetWarfrontRite"), arena.indexOf("/>", arena.indexOf("onExit={() => { if (canLeaveCurrentPetBattle")));
    assert.doesNotMatch(arenaRite, /spectator|sealedReplay/,
        "the player's own rewarded Warfront never becomes a skippable spectator view");
    assert.match(css, /\.wfr-skip \{[\s\S]*?min-width: 44px;[\s\S]*?min-height: 44px;/);
});

test("both graphics routes failing continues the battle in the reduced view instead of pausing it", () => {
    assert.doesNotMatch(shell, /Your battle is paused|wfr-render-failure/,
        "a retry-only pause panel is a dead end: the clock never resumes without new graphics");
    assert.match(shell, /if \(route === "reduced"\) return <ReducedBattleStage \{\.\.\.props\} onRetryGraphics=\{retryGraphics\} \/>;/);
    const reduced = shell.slice(shell.indexOf("function ReducedBattleStage"), shell.indexOf("export function PetWarfrontRiteStage("));
    assert.match(reduced, /onRendererAvailability\?\.\(true\);\s*onLoadProgress\?\.\(fighters\.length\);\s*onReady\?\.\(\);/,
        "the reduced view is ready the moment it mounts, which reopens the veil and resumes the clock");
    assert.doesNotMatch(reduced, /<canvas|<img|loadImpostorImage|getContext/,
        "the last route must have nothing that can fail to load");
    assert.match(shell, /<WarfrontRenderBoundary key="canvas" onFail=\{handleCanvasAssetFailure\}>/,
        "a Canvas render error falls through the chain instead of unmounting the match");
    assert.match(shell, /<WarfrontRenderBoundary key="webgl" onFail=\{handleWebGlFailure\}>/);
});

test("a lost WebGL context is restored within a visible-time deadline, a bounded number of times", () => {
    const lost = stage3d.slice(stage3d.indexOf("const handleContextLost"), stage3d.indexOf("const handleContextRestored"));
    assert.match(lost, /warfrontContextLossRecovery\(contextLosses\.current\) === "fall-back"\) \{\s*onGraphicsFailure\?\.\(\);\s*return;/);
    assert.match(lost, /startWarfrontVisibleCountdown\(WARFRONT_CONTEXT_RESTORE_DEADLINE_SECONDS, \(\) => \{[\s\S]*?onGraphicsFailure\?\.\(\);/);
    assert.match(stage3d, /cancelRestoreDeadline\.current\?\.\(\);/, "a restored or ready scene cancels the deadline");
});

test("a re-form that cannot be prepared can always hold the line it fought", () => {
    assert.match(rite, /resolveRite\(\{ blue: blueBand, red: redBand, seed, bluePlan: chosen, redPlan: sealedRedPlan \}, controller\.signal\)/);
    assert.doesNotMatch(rite, /resolveRiteInWorker/, "preparation goes through the bounded-retry resolver");
    assert.match(rite, /preparationError\s*\?\s*<button[^>]*onClick=\{\(\) => onCommit\(\{ formation: \[\.\.\.formation\], deployment: \[\.\.\.deployment\] \}\)\}>Hold formation<\/button>/,
        "the interactive panel offers the hold, which needs no simulation");
    assert.match(rite, /const choice = preparationError\s*\?\s*heldFormation\s*:\s*automaticRiteReformChoice\(/,
        "a seat that takes no decisions holds instead of waiting on a retry");
    assert.doesNotMatch(rite, /Retry rematch/);
    assert.match(rite, /const locked = lockRiteReform\(plan, clash, clashIndex, blueBand\.length, nextChoice\);/,
        "the live lock and the skip share one transcript policy");
});
