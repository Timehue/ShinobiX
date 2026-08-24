import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CombatRoundTimer } from "./CombatRoundTimer";
import {
    PVP_TURN_MS,
    PVP_TURN_SECONDS,
    pvpTurnDeadlineAt,
    pvpTurnRemainingSeconds,
} from "../../../shared/pvp-turn";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const ANCHOR = 1_700_000_000_000;

test("the anchored countdown is derived from the server stamp, not from mount time", () => {
    // At the instant the turn starts the player is shown the full turn.
    assert.equal(pvpTurnRemainingSeconds(ANCHOR, ANCHOR), PVP_TURN_SECONDS);
    assert.equal(pvpTurnRemainingSeconds(ANCHOR, ANCHOR + 1_000), 44);
    assert.equal(pvpTurnRemainingSeconds(ANCHOR, ANCHOR + 20_000), 25);

    // THE REGRESSION THIS EXISTS FOR: a refresh 40s into a live turn used to
    // remount the ring at a full 45 and then be auto-passed seconds later,
    // because the server was still measuring the real turn. The anchor makes a
    // fresh mount read the same 5s the server does.
    assert.equal(pvpTurnRemainingSeconds(ANCHOR, ANCHOR + 40_000), 5);
});

test("the anchored countdown clamps at both ends", () => {
    // Never past the promised length — the server's join stamp is deliberately
    // in the FUTURE (offset by the pre-fight countdown), and the ring must read
    // full during it rather than showing an impossible 50.
    assert.equal(pvpTurnRemainingSeconds(ANCHOR, ANCHOR - 5_000), PVP_TURN_SECONDS);
    // Never negative, however far past the deadline the reader is.
    assert.equal(pvpTurnRemainingSeconds(ANCHOR, ANCHOR + PVP_TURN_MS), 0);
    assert.equal(pvpTurnRemainingSeconds(ANCHOR, ANCHOR + 10 * PVP_TURN_MS), 0);
    // A missing / nonsense anchor falls back to the full length rather than 0,
    // so a bad row can never auto-pass a present player.
    assert.equal(pvpTurnRemainingSeconds(0, ANCHOR), PVP_TURN_SECONDS);
    assert.equal(pvpTurnRemainingSeconds(Number.NaN, ANCHOR), PVP_TURN_SECONDS);
    // A custom length (the PvE arena's transport timeout) is honoured.
    assert.equal(pvpTurnRemainingSeconds(ANCHOR, ANCHOR - 1_000, 30), 30);
});

test("a background tab catches up instead of accumulating lost ticks", () => {
    // The old countdown decremented a local variable once per interval, so a
    // throttled tab drifted by however many ticks the browser skipped. An
    // absolute anchor simply lands on the truth on the next tick.
    const beforeSleep = pvpTurnRemainingSeconds(ANCHOR, ANCHOR + 3_000);
    const afterSleep = pvpTurnRemainingSeconds(ANCHOR, ANCHOR + 38_000);
    assert.equal(beforeSleep, 42);
    assert.equal(afterSleep, 7, "resuming reads real elapsed time, not the tick count");
});

test("the client's zero always arrives before the server would enforce", () => {
    // Walk the whole turn: at every second the ring reads > 0, the server's own
    // deadline must still be in the future.
    for (let elapsed = 0; elapsed <= PVP_TURN_MS + 10_000; elapsed += 1_000) {
        const now = ANCHOR + elapsed;
        if (pvpTurnRemainingSeconds(ANCHOR, now) > 0) {
            assert.ok(now < pvpTurnDeadlineAt(ANCHOR),
                `client still counting at ${elapsed}ms but the server deadline had passed`);
        }
    }
    // And the client reaches zero strictly first.
    assert.equal(pvpTurnRemainingSeconds(ANCHOR, ANCHOR + PVP_TURN_MS), 0);
    assert.ok(ANCHOR + PVP_TURN_MS < pvpTurnDeadlineAt(ANCHOR));
});

test("an anchored timer renders the true remaining time on a fresh mount", () => {
    const startedAt = Date.now() - 40_000;
    const html = renderToStaticMarkup(
        React.createElement(CombatRoundTimer, {
            active: true,
            resetSignal: 0,
            anchor: { turnStartedAt: startedAt },
            onExpire: () => { throw new Error("must not expire on mount"); },
        }),
    );
    assert.match(html, /round-timer-num">5</, "a mid-turn remount shows ~5s left, not a full 45");
    assert.match(html, /round-timer-urgent/, "and is already in the urgent band");
});

test("an anchored timer shows a waiting state while the server has no clock", () => {
    // P1 is on the board but P2 has not joined, so the server has not started
    // any turn clock. Counting down here used to strand P1's ring at 0 (the
    // queued `wait` is refused with "Waiting for both fighters to join", and
    // nothing re-armed the ring).
    const html = renderToStaticMarkup(
        React.createElement(CombatRoundTimer, {
            active: true,
            resetSignal: 0,
            anchor: { turnStartedAt: undefined },
            opponentName: "Kenji",
            onExpire: () => { throw new Error("must not expire while waiting"); },
        }),
    );
    assert.match(html, /round-timer-inactive/);
    // "Waiting to start" had no subject: waiting for WHAT, and for how long?
    assert.match(html, /Waiting for Kenji/);
    assert.doesNotMatch(html, /Waiting to start/);
    assert.doesNotMatch(html, /round-timer-num">0</);
});

test("the waiting state is announced, and names who is being waited for", () => {
    const html = renderToStaticMarkup(
        React.createElement(CombatRoundTimer, {
            active: true,
            resetSignal: 0,
            anchor: { turnStartedAt: undefined },
            opponentName: "Kenji",
            onExpire: () => { throw new Error("must not expire while waiting"); },
        }),
    );
    // Urgency and state used to be conveyed by colour and animation alone.
    assert.match(html, /role="timer"/);
    assert.match(html, /aria-label="Waiting for Kenji to join the match"/);
    assert.match(html, /aria-live="polite"/);
});

test("the waiting state falls back to a subject when no opponent name is passed", () => {
    for (const opponentName of [undefined, "", "   "]) {
        const html = renderToStaticMarkup(
            React.createElement(CombatRoundTimer, {
                active: true,
                resetSignal: 0,
                anchor: { turnStartedAt: undefined },
                opponentName,
                onExpire: () => { throw new Error("must not expire while waiting"); },
            }),
        );
        assert.match(html, /Waiting for your opponent/);
    }
});

test("the waiting ring uses the same no-number glyph as the sibling inactive rings", () => {
    // The battle screens' own inactive rings render an em dash; the digit slot
    // is styled for digits, so the ellipsis that used to sit here read wrong.
    const html = renderToStaticMarkup(
        React.createElement(CombatRoundTimer, {
            active: true,
            resetSignal: 0,
            anchor: { turnStartedAt: undefined },
            onExpire: () => { throw new Error("must not expire while waiting"); },
        }),
    );
    assert.match(html, /round-timer-num">—</);
    assert.doesNotMatch(html, /round-timer-num">…</);
});

test("a live turn is a labelled timer, and the last ten seconds are announced", () => {
    const urgent = renderToStaticMarkup(
        React.createElement(CombatRoundTimer, {
            active: true,
            resetSignal: 0,
            anchor: { turnStartedAt: Date.now() - 40_000 },
            onExpire: () => { throw new Error("must not expire on mount"); },
        }),
    );
    assert.match(urgent, /role="timer"/);
    assert.match(urgent, /aria-label="Turn timer — 5 seconds left"/);
    assert.match(urgent, /Under ten seconds left in your turn/);
    // The visible label never changes, so the HUD's layout cannot shift.
    assert.match(urgent, /<small>Turn timer<\/small>/);

    const calm = renderToStaticMarkup(
        React.createElement(CombatRoundTimer, {
            active: true,
            resetSignal: 0,
            anchor: { turnStartedAt: Date.now() },
            onExpire: () => { throw new Error("must not expire on mount"); },
        }),
    );
    assert.doesNotMatch(calm, /Under ten seconds left/);
    assert.match(calm, /<small>Turn timer<\/small>/);
});

test("the local (unanchored) mode is unchanged for the PvE arena", () => {
    const html = renderToStaticMarkup(
        React.createElement(CombatRoundTimer, {
            active: true,
            resetSignal: 0,
            seconds: 30,
            onExpire: () => { throw new Error("must not expire on mount"); },
        }),
    );
    assert.match(html, /round-timer-num">30</, "starts at the full length with no anchor");
    assert.match(html, /Turn timer/);
});
