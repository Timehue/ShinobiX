import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rankFromLevel } from "./stats";
import { MAX_LEVEL } from "../constants/game";
import { PROGRESSION_EXAM_HOLDS } from "../../../shared/progression-holds";
import type { Profession } from "../types/core";

/*
 * docs/PROGRESSION_SPINE_LEVEL_10_100.md is player-facing guidance that states
 * levels as fact — which rank you hold, where XP is held, what the cap is. None
 * of it was pinned to code, so the doc could drift silently and only be caught
 * by a player reading it and finding it wrong. This asserts the checkable half:
 * every number the doc claims is the number the code enforces.
 *
 * The prose columns are deliberately NOT asserted word-for-word. Copy should be
 * free to improve; what must not drift is the level a milestone sits at.
 */
const doc = readFileSync(new URL("../../../docs/PROGRESSION_SPINE_LEVEL_10_100.md", import.meta.url), "utf8");

type Row = { milestone: string; direction: string; optional: string; note: string };

function milestoneRows(): Row[] {
    return doc
        .split("\n")
        .filter((line) => line.trim().startsWith("|"))
        .map((line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim()))
        .filter((cells) => cells.length === 4)
        // drop the header row and the |---|---| separator
        .filter((cells) => cells[0] !== "Milestone" && !/^-+$/.test(cells[0]))
        .map(([milestone, direction, optional, note]) => ({ milestone, direction, optional, note }));
}

test("the spine table still has every milestone row, in order", () => {
    // Pinned as an exact list: a row silently disappearing is the failure mode
    // this doc has, since nothing else references it.
    assert.deepEqual(milestoneRows().map((r) => r.milestone), [
        "13", "15", "20", "30", "39", "50", "60\u201369", "70\u201379", "80\u201399", "100",
    ]);
});

test("every milestone names a direction, an optional/social track, and a gating note", () => {
    // The acceptance criteria asks each milestone to identify solo/social/
    // repeatable/beta/gated activities. An empty cell silently drops one.
    for (const row of milestoneRows()) {
        assert.ok(row.direction.length > 0, `milestone ${row.milestone} has no primary direction`);
        assert.ok(row.optional.length > 0, `milestone ${row.milestone} has no optional/social track`);
        assert.ok(row.note.length > 0, `milestone ${row.milestone} has no beta/gated note`);
    }
});

test("every rank milestone in the doc is the level rankFromLevel actually promotes at", () => {
    // Doc claims: 15 Genin, 30 Chunin, 50 Jonin, 80-99 Special Jonin.
    const claims: Array<[number, string]> = [[15, "Genin"], [30, "Chunin"], [50, "Jonin"], [80, "Special Jonin"]];
    for (const [level, rank] of claims) {
        assert.equal(rankFromLevel(level), rank, `doc says level ${level} is ${rank}`);
        // and that it is the FIRST level of that band, not merely inside it
        assert.notEqual(rankFromLevel(level - 1), rank, `level ${level} should be where ${rank} begins`);
    }
});

test("every exam-hold milestone in the doc is a real hold level", () => {
    // Doc claims XP is held at 20 (Genin Exam) and 39 (Chunin Exam).
    const holds = new Map(PROGRESSION_EXAM_HOLDS.map((gate) => [gate.exam, gate.level]));
    assert.equal(holds.get("genin"), 20);
    assert.equal(holds.get("chunin"), 39);

    // The doc must describe a hold at exactly the levels that hold, and nowhere
    // else — a stale hold row is the "is my save broken?" support ticket.
    const holdRows = milestoneRows().filter((r) => /XP is held/i.test(r.direction));
    assert.deepEqual(holdRows.map((r) => r.milestone).sort(), ["20", "39"]);
});

test("the doc's level-100 goal is the real level cap", () => {
    assert.equal(MAX_LEVEL, 100);
    assert.ok(milestoneRows().some((r) => r.milestone === String(MAX_LEVEL)));
});

test("the three professions the doc names at 13 are the three the type allows", () => {
    // Compile-time exhaustiveness: adding a fourth Profession fails to build here.
    const all: Record<Profession, string> = { healer: "Healer", vanguard: "Vanguard", petTamer: "Pet Tamer" };
    const thirteen = milestoneRows().find((r) => r.milestone === "13");
    assert.ok(thirteen, "milestone 13 row is missing");
    for (const label of Object.values(all)) {
        assert.ok(thirteen.direction.includes(label), `milestone 13 should name ${label}`);
    }
});
