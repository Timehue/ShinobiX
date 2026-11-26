import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createMatch, MAIN_DECK_SIZE, STARTING_LIFE_POINTS, validateDeckIds } from "../../shared/chronicle-duel.js";
import {
    HALL_LADDER_DUELISTS,
    HALL_LADDER_TOTAL_BOUTS,
    hallLadderArt,
    hallLadderBout,
    hallLadderBoutOpen,
    hallLadderFirstClearCp,
    hallLadderFrontier,
    hallLadderOf,
    settleHallLadderWin,
} from "../../shared/hall-ladder-contract.js";
import { applyHallLadderBout, HALL_LADDER_DECK_NAMES, hallLadderOpponentDeck } from "./_hall-ladder.js";

// process.cwd(): api tests also compile into the CommonJS server build.
const ROOT = process.cwd();
const DIFFICULTY_RANK = { easy: 0, medium: 1, hard: 2 } as const;

test("every duelist plays a legal 40-card deck and has its portrait shipped", () => {
    for (const duelist of HALL_LADDER_DUELISTS) {
        const deck = hallLadderOpponentDeck(duelist.id);
        assert.ok(deck, `${duelist.id} has a deck`);
        assert.equal(deck!.length, MAIN_DECK_SIZE, `${duelist.id} runs ${MAIN_DECK_SIZE} cards`);
        assert.equal(validateDeckIds(deck!).valid, true, `${duelist.id} deck is legal`);
        assert.ok(fs.existsSync(path.join(ROOT, "shinobij.client/public", hallLadderArt(duelist.id))), `${duelist.id} portrait exists`);
        assert.ok(fs.existsSync(path.join(ROOT, "shinobij.client/public", hallLadderArt(duelist.id, true))), `${duelist.id} figure exists`);
    }
    assert.equal(hallLadderOpponentDeck("nobody"), null);
    assert.deepEqual(Object.keys(HALL_LADDER_DECK_NAMES).sort(), HALL_LADDER_DUELISTS.map((d) => d.id).sort(), "every duelist has a deck name");
});

test("ids are unique, each duelist's bouts climb, and each final bout is at least the last one", () => {
    assert.equal(new Set(HALL_LADDER_DUELISTS.map((d) => d.id)).size, HALL_LADDER_DUELISTS.length);
    const weight = (b: { difficulty: keyof typeof DIFFICULTY_RANK; opponentLifeBonus: number }) =>
        DIFFICULTY_RANK[b.difficulty] * 100_000 + b.opponentLifeBonus;
    let previousFinal = -1;
    for (const duelist of HALL_LADDER_DUELISTS) {
        const [first, second, third] = duelist.bouts.map(weight);
        assert.ok(first < second && second < third, `${duelist.id}: each bout is harder than the one before`);
        assert.ok(third >= previousFinal, `${duelist.id}: final bout is not easier than the previous duelist's`);
        previousFinal = third;
    }
    assert.equal(hallLadderBout(HALL_LADDER_TOTAL_BOUTS), null);
});

test("the record reader clamps junk to the ladder", () => {
    assert.deepEqual(hallLadderOf({}), { cleared: 0 });
    assert.deepEqual(hallLadderOf({ hallLadder: { cleared: "7" } }), { cleared: 7 });
    assert.deepEqual(hallLadderOf({ hallLadder: { cleared: -4 } }), { cleared: 0 });
    assert.deepEqual(hallLadderOf({ hallLadder: { cleared: 999 } }), { cleared: HALL_LADDER_TOTAL_BOUTS });
    assert.deepEqual(hallLadderOf({ hallLadder: "x" }), { cleared: 0 });
    assert.deepEqual(hallLadderOf(null), { cleared: 0 });
});

test("only cleared bouts and the frontier are open", () => {
    const record = { cleared: 4 };
    assert.equal(hallLadderBoutOpen(record, 0), true);
    assert.equal(hallLadderBoutOpen(record, 4), true);
    assert.equal(hallLadderBoutOpen(record, 5), false);
    assert.equal(hallLadderBoutOpen(record, -1), false);
    assert.equal(hallLadderBoutOpen(record, 1.5), false);
    assert.equal(hallLadderFrontier(record), 4);
    assert.equal(hallLadderFrontier({ cleared: HALL_LADDER_TOTAL_BOUTS }), null);
    assert.equal(hallLadderBoutOpen({ cleared: HALL_LADDER_TOTAL_BOUTS }, HALL_LADDER_TOTAL_BOUTS), false);
});

test("first wins pay 10 per bout, 30 to beat a duelist and 60 to beat the champion: 330 in all", () => {
    const paid = Array.from({ length: HALL_LADDER_TOTAL_BOUTS }, (_, index) => hallLadderFirstClearCp(index));
    assert.deepEqual(paid.slice(0, 3), [10, 10, 30]);
    assert.deepEqual(paid.slice(-3), [10, 10, 60]);
    assert.equal(paid.reduce((sum, cp) => sum + cp, 0), 330);
    assert.equal(hallLadderFirstClearCp(-1), 0);
    assert.equal(hallLadderFirstClearCp(HALL_LADDER_TOTAL_BOUTS), 0);
});

test("a win moves the ladder only on the frontier bout", () => {
    assert.deepEqual(settleHallLadderWin({ cleared: 2 }, 2), { record: { cleared: 3 }, advanced: true });
    assert.deepEqual(settleHallLadderWin({ cleared: 2 }, 1), { record: { cleared: 2 }, advanced: false });
    assert.deepEqual(settleHallLadderWin({ cleared: 2 }, 3), { record: { cleared: 2 }, advanced: false });
    const last = HALL_LADDER_TOTAL_BOUTS - 1;
    assert.deepEqual(settleHallLadderWin({ cleared: last }, last), { record: { cleared: HALL_LADDER_TOTAL_BOUTS }, advanced: true });
});

test("a bout's Health handicap lands on the AI side and is logged", () => {
    const deck = hallLadderOpponentDeck("apprentice")!;
    const state = createMatch("Player", deck, "Kiri", deck, () => 0.5);
    applyHallLadderBout(state, { difficulty: "hard", opponentLifeBonus: 3_000 });
    assert.equal(state.p1.lifePoints, STARTING_LIFE_POINTS);
    assert.equal(state.p2.lifePoints, STARTING_LIFE_POINTS + 3_000);
    assert.match(state.log.at(-1) ?? "", /Kiri starts with 3,000 more Health/);
    const plain = createMatch("Player", deck, "Kiri", deck, () => 0.5);
    const before = plain.log.length;
    applyHallLadderBout(plain, { difficulty: "easy", opponentLifeBonus: 0 });
    assert.equal(plain.p2.lifePoints, STARTING_LIFE_POINTS);
    assert.equal(plain.log.length, before);
});
