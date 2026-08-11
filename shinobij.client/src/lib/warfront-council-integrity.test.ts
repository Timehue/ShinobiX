import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const clientRoot = process.cwd().endsWith("shinobij.client") ? process.cwd() : join(process.cwd(), "shinobij.client");

test("Coach Council waits for the authenticated append before resuming and remains retryable on failure", () => {
    const match = readFileSync(join(clientRoot, "src", "components", "PetWarfrontMatch.tsx"), "utf8");
    const submitStart = match.indexOf("const commitCouncil = useCallback(async () =>");
    const lockOrders = match.indexOf("setOrdersLocked(true)", submitStart);
    const awaitCommit = match.indexOf("await resumeRef.current(decisionRef.current)", submitStart);
    const successLatch = match.indexOf("resumedRef.current = true", awaitCommit);
    const failureMessage = match.indexOf("setSubmitError(", successLatch);
    assert.ok(submitStart >= 0 && lockOrders > submitStart && awaitCommit > lockOrders && successLatch > awaitCommit && failureMessage > successLatch,
        "the modal must latch only after success and expose a same-path retry after failure");
    assert.match(match, /disabled=\{submitting \|\| ordersLocked\}/,
        "a lost response must freeze the first submitted package and order instead of allowing a fork");
});

test("Council deadline work is effect-owned and never scheduled from a state updater", () => {
    const match = readFileSync(join(clientRoot, "src", "components", "PetWarfrontMatch.tsx"), "utf8");
    const countdownStart = match.indexOf("setCouncilLeft((seconds) => Math.max(0, seconds - 1))");
    const deadlineStart = match.indexOf("if (timerHeld || submitting || councilLeft > 0 || deadlineCommitQueuedRef.current) return;");
    const deadlineEnd = match.indexOf("}, [commitCouncil, councilLeft, submitting, timerHeld]);", deadlineStart);
    const deadlineEffect = match.slice(deadlineStart, deadlineEnd);
    assert.ok(countdownStart >= 0, "the countdown updater must remain a pure state calculation");
    assert.doesNotMatch(match.slice(countdownStart, deadlineStart), /setTimeout\s*\(/,
        "the state updater must not escape into a replayable side effect");
    assert.match(deadlineEffect, /deadlineCommitQueuedRef\.current = true/,
        "the deadline may queue only one automatic commit");
    assert.match(deadlineEffect, /window\.clearTimeout\(id\)/,
        "an unmounted or held Council must cancel its queued deadline task");
    assert.match(match, /submitError \? "Retry same decisions"/,
        "a failed automatic commit must keep the same frozen decision manually retryable");
});

test("reload recovery hydrates the committed prefix before opening a later Council", () => {
    const match = readFileSync(join(clientRoot, "src", "components", "PetWarfrontMatch.tsx"), "utf8");
    const frontier = match.indexOf("onFrontier.current = () =>");
    const recovered = match.indexOf("committedChoicesRef.current[ctl.round - 1]", frontier);
    const openModal = match.indexOf("setCouncil({ round: ctl.round })", frontier);
    assert.ok(frontier >= 0 && recovered > frontier && openModal > recovered,
        "accepted rounds must auto-replay before the next uncommitted modal can open");

    const arena = readFileSync(join(clientRoot, "src", "screens", "PetArena.tsx"), "utf8");
    assert.match(arena, /postWarfront<[^>]+>\("\/api\/pet\/warfront-council"/);
    assert.match(arena, /committedChoices=\{arenaMatch\.committedChoices\}/);
    assert.match(arena, /onCouncilCommit=\{arenaMatch\.vsAi/);
});

test("Coach Mode discloses its fixed capped completion reward before launch", () => {
    const arena = readFileSync(join(clientRoot, "src", "screens", "PetArena.tsx"), "utf8");
    assert.match(arena, /Coach Mode pays a fixed completion reward\./,
        "the setup screen must disclose the completion policy before Start");
    assert.match(arena, /Win, loss, and draw pay the same server-sealed base ryo for up to 3 paid completions per UTC day/);
    assert.match(arena, /It never adds first-win bonuses or win progress/);
    assert.match(arena, /warfrontTerminalReceiptMessage\(receipt/,
        "the durable server receipt, not a client outcome, decides the post-match explanation");
});

test("Coach setup leaves one-use technique and comeback choices reachable", () => {
    const arena = readFileSync(join(clientRoot, "src", "screens", "PetArena.tsx"), "utf8");
    assert.match(arena, /if \(buyPolicy === "off"\) \{\s*delete setup\.objectiveTechnique;\s*delete setup\.counterstrike;/s,
        "Coach Start must omit both precommits so Council can arm them live");
    assert.match(arena, /\.\.\.localWarfrontSetup\(wfAutoPref\)/,
        "the mode-aware authored setup must be the one sent to Start");
});

test("Exit confirmation restores focus to the invoking control after Cancel or Escape", () => {
    const match = readFileSync(join(clientRoot, "src", "components", "PetWarfrontMatch.tsx"), "utf8");
    const lifecycle = match.match(/useEffect\(\(\) => \{\s*if \(!exitPrompt\) return;([\s\S]*?)\}, \[exitPrompt\]\);/)?.[1] ?? "";
    assert.match(lifecycle, /document\.activeElement instanceof HTMLElement/,
        "opening the confirmation must capture the control that launched it");
    assert.match(lifecycle, /exitHeadingRef\.current\?\.focus\(\)/,
        "the dialog must receive an announced initial focus target");
    assert.match(lifecycle, /previous\?\.isConnected\) previous\.focus\(\)/,
        "closing the dialog must restore focus only while its trigger remains connected");
    assert.match(match, /event\.key === "Escape" && !exitPending[\s\S]*?setExitPrompt\(false\)/,
        "Escape must close the same prompt and run its focus-restoring cleanup");
});
