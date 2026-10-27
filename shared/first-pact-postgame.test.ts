import test from "node:test";
import assert from "node:assert/strict";
import {
    FIRST_PACT_EXHIBITION_LENGTH,
    FIRST_PACT_EXHIBITION_ROUNDS,
    FIRST_PACT_EXHIBITION_STANDING,
    FIRST_PACT_UNBROKEN_ROUNDS,
    createFirstPactProgress,
    expectedFirstPactUnbrokenRound,
    firstPactEarnedTitleKeys,
    firstPactEncounter,
    firstPactReplayOpen,
    normalizeFirstPactProgress,
    settleFirstPactExhibitionSummary,
    settleFirstPactReplay,
    startFirstPactUnbroken,
    type FirstPactProgress,
} from "./first-pact-contract.js";

const DAY = Date.UTC(2026, 9, 26, 12);
const complete = (): FirstPactProgress => ({ ...createFirstPactProgress(DAY), mainStep: "complete" });

test("older progress records gain empty postgame records", () => {
    const old = normalizeFirstPactProgress({ ...createFirstPactProgress(DAY), version: 8, exhibition: undefined, replays: undefined }, DAY);
    assert.deepEqual(old.exhibition, { best: 0, clears: 0, battleProofs: [] });
    assert.equal(old.replays.run, null);
    assert.equal(old.replays.unbrokenClears, 0);
});

test("the Exhibition rounds are First Pact encounters with literal ids", () => {
    assert.equal(FIRST_PACT_EXHIBITION_ROUNDS.length, FIRST_PACT_EXHIBITION_LENGTH);
    for (const [index, round] of FIRST_PACT_EXHIBITION_ROUNDS.entries()) {
        assert.equal(round.round, index);
        assert.equal(firstPactEncounter(round.id)?.id, round.id);
    }
});

test("a finished Exhibition run pays Court Standing once per UTC day and records the clear", () => {
    let progress = complete();
    const first = settleFirstPactExhibitionSummary(progress, "win", FIRST_PACT_EXHIBITION_LENGTH, "p1", DAY);
    assert.equal(first.standingPaid, FIRST_PACT_EXHIBITION_STANDING);
    progress = first.progress;
    assert.equal(progress.courtStanding, FIRST_PACT_EXHIBITION_STANDING);
    assert.equal(progress.exhibition.clears, 1);
    assert.deepEqual(firstPactEarnedTitleKeys(progress).includes("exhibition"), true);

    const sameDay = settleFirstPactExhibitionSummary(progress, "win", FIRST_PACT_EXHIBITION_LENGTH, "p2", DAY + 3_600_000);
    assert.equal(sameDay.standingPaid, 0, "a second clear the same day pays nothing");
    assert.equal(sameDay.progress.exhibition.clears, 2);

    const nextDay = settleFirstPactExhibitionSummary(sameDay.progress, "win", FIRST_PACT_EXHIBITION_LENGTH, "p3", DAY + 86_400_000);
    assert.equal(nextDay.standingPaid, FIRST_PACT_EXHIBITION_STANDING);
});

test("an Exhibition result settles once, and a loss only records the best run", () => {
    const progress = complete();
    const loss = settleFirstPactExhibitionSummary(progress, "loss", 3, "proof", DAY);
    assert.equal(loss.progress.exhibition.best, 3);
    assert.equal(loss.progress.courtStanding, 0);
    const retry = settleFirstPactExhibitionSummary(loss.progress, "win", FIRST_PACT_EXHIBITION_LENGTH, "proof", DAY);
    assert.equal(retry.advanced, false, "the same proof never settles twice");
    const closed = settleFirstPactExhibitionSummary(createFirstPactProgress(DAY), "win", FIRST_PACT_EXHIBITION_LENGTH, "x", DAY);
    assert.equal(closed.advanced, false, "the Exhibition opens only after the crossing");
});

test("Court Replays open only for battles already won", () => {
    const progress = { ...complete(), writs: ["writ-silencing"] };
    assert.equal(firstPactReplayOpen(progress, FIRST_PACT_UNBROKEN_ROUNDS[0].id), true);
    assert.equal(firstPactReplayOpen(progress, "writ-silencing"), true);
    assert.equal(firstPactReplayOpen(progress, "writ-audit"), false, "an unanswered writ cannot be replayed");
    assert.equal(firstPactReplayOpen(progress, "stable-qualifier"), false, "an unfought tournament round cannot be replayed");
    assert.equal(firstPactReplayOpen({ ...progress, mainStep: "return-to-threshold" }, FIRST_PACT_UNBROKEN_ROUNDS[0].id), false);
});

test("a replay never touches the story record, and a Hard win is remembered", () => {
    const before = complete();
    const id = FIRST_PACT_UNBROKEN_ROUNDS[1].id;
    const { progress, advanced } = settleFirstPactReplay(before, id, { hard: true, unbroken: false }, "win", "r1", DAY);
    assert.equal(advanced, true);
    assert.deepEqual(progress.replays.hardClears, [id]);
    assert.deepEqual(progress.finalTrial, before.finalTrial);
    assert.equal(progress.courtStanding, before.courtStanding);
    assert.equal(progress.mainStep, before.mainStep);
});

test("an Unbroken attempt fights the Balancing in order and ends on a loss", () => {
    let progress = startFirstPactUnbroken(complete(), true, DAY);
    for (const [index, round] of FIRST_PACT_UNBROKEN_ROUNDS.entries()) {
        assert.equal(expectedFirstPactUnbrokenRound(progress)?.id, round.id);
        const wrong = settleFirstPactReplay(progress, round.id, { hard: false, unbroken: true }, "win", `wrong-${index}`, DAY);
        assert.equal(wrong.advanced, false, "a Normal battle cannot advance a Hard attempt");
        progress = settleFirstPactReplay(progress, round.id, { hard: true, unbroken: true }, "win", `u-${index}`, DAY).progress;
    }
    assert.equal(progress.replays.run, null);
    assert.equal(progress.replays.unbrokenClears, 1);
    assert.equal(progress.replays.hardUnbrokenClears, 1);
    assert.ok(firstPactEarnedTitleKeys(progress).includes("unbent"));
    assert.ok(firstPactEarnedTitleKeys(progress).includes("iron-docket"));

    let attempt = startFirstPactUnbroken(complete(), false, DAY);
    attempt = settleFirstPactReplay(attempt, FIRST_PACT_UNBROKEN_ROUNDS[0].id, { hard: false, unbroken: true }, "win", "a", DAY).progress;
    attempt = settleFirstPactReplay(attempt, FIRST_PACT_UNBROKEN_ROUNDS[1].id, { hard: false, unbroken: true }, "loss", "b", DAY).progress;
    assert.equal(attempt.replays.run, null);
    assert.equal(attempt.replays.unbrokenBest, 1);
    assert.equal(attempt.replays.unbrokenClears, 0);
    assert.ok(!firstPactEarnedTitleKeys(attempt).includes("unbent"));
});
