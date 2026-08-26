import assert from "node:assert/strict";
import test from "node:test";
import {
    MAX_SCARS_PER_SECTOR, SCAR_TTL_MS, parseScars, pruneScars, scarAgeLabel, scarLine, withScar,
    type SectorScar,
} from "./sector-scars.js";

const NOW = Date.UTC(2026, 7, 26, 12);
const scar = (victor: string, ago = 0, fallen = "Rin"): SectorScar =>
    ({ kind: "duel", victor, fallen, at: NOW - ago });

test("malformed rows are dropped rather than rendered", () => {
    assert.deepEqual(parseScars(null), []);
    assert.deepEqual(parseScars("nope"), []);
    assert.deepEqual(parseScars([null, 7, "x", {}]), []);
    assert.deepEqual(parseScars([{ kind: "duel", victor: "", at: NOW }]), [], "a nameless victor is not a scar");
    assert.deepEqual(parseScars([{ kind: "duel", victor: "Kaze", at: 0 }]), [], "a scar needs an instant");
    assert.deepEqual(parseScars([{ kind: "raid", victor: "Kaze", at: NOW }]), [], "unknown kinds are dropped");
});

test("names are trimmed and bounded so a long one cannot break the row", () => {
    const [parsed] = parseScars([{ kind: "duel", victor: `  ${"K".repeat(80)}  `, fallen: "  Rin  ", at: NOW }]);
    assert.equal(parsed.victor.length, 40);
    assert.equal(parsed.fallen, "Rin");
});

test("scars expire on their own and never exceed the cap", () => {
    assert.deepEqual(pruneScars([scar("Old", SCAR_TTL_MS + 1)], NOW), []);
    assert.equal(pruneScars([scar("Fresh", SCAR_TTL_MS - 1)], NOW).length, 1);

    const many = Array.from({ length: 20 }, (_, i) => scar(`Fighter${i}`, i * 1_000));
    const pruned = pruneScars(many, NOW);
    assert.equal(pruned.length, MAX_SCARS_PER_SECTOR);
    // Newest first.
    for (let i = 1; i < pruned.length; i++) assert.ok(pruned[i].at <= pruned[i - 1].at);
    assert.equal(pruned[0].victor, "Fighter0");
});

test("one victor holds one scar — farming the same ground cannot fill the board", () => {
    let board: SectorScar[] = [];
    for (let i = 0; i < 10; i++) board = withScar(board, scar("Kaze", 0, `Victim${i}`), NOW + i);
    assert.equal(board.length, 1, "ten wins by one player left more than one mark");
    assert.equal(board[0].fallen, "Victim9", "the newest win should be the one remembered");

    // ...while different victors still each get a line.
    for (const name of ["Rin", "Flint", "River"]) board = withScar(board, scar(name), NOW);
    assert.equal(board.length, 4);
});

test("the age label is coarse, and a draw reads as a duel with no fallen name", () => {
    assert.equal(scarAgeLabel(scar("Kaze", 0), NOW), "just now");
    assert.equal(scarAgeLabel(scar("Kaze", 5 * 60_000), NOW), "5m ago");
    assert.equal(scarAgeLabel(scar("Kaze", 3 * 3_600_000), NOW), "3h ago");

    assert.equal(scarLine(scar("Kaze", 0, "Rin")), "Kaze stood over Rin");
    assert.equal(scarLine(scar("Kaze", 0, "")), "Kaze walked away from a duel");
});
