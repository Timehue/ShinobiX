import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { FULL_COLS, FULL_MASK, FULL_ROWS } from "./pet-arena-fullmask";
import { WALK_COLS, WALK_MASK, WALK_ROWS } from "./pet-arena-walkmask";

function assertExactMask(name: string, mask: string, cols: number, rows: number, sha256: string) {
    assert.equal(mask.length, cols * rows, `${name} cell count`);
    assert.match(mask, /^[01]+$/, `${name} binary alphabet`);
    assert.equal(createHash("sha256").update(mask).digest("hex"), sha256, `${name} source bytes`);
}

test("compressed pet-arena masks expand to the exact generated source bytes", () => {
    assertExactMask("full", FULL_MASK, FULL_COLS, FULL_ROWS, "8b1a4612495adaf7d656b63e9711d7ba7f3abdce1a56cbe48880d48a58f207b3");
    assertExactMask("walk", WALK_MASK, WALK_COLS, WALK_ROWS, "fd0732619633cb3eaa17a901e5f41beafe6f8d4776836b69340ae7fcc19748dc");
});
