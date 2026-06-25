import { test } from "node:test";
import assert from "node:assert/strict";
import { mergePlayerRoster } from "./roster-merge";
import type { Character, PlayerRecord } from "../types/character";

// Minimal PlayerRecord factory — mergePlayerRoster only touches `name` + `character`.
const rec = (name: string, level = 1): PlayerRecord =>
  ({ name, character: { name, level } as unknown as Character }) as unknown as PlayerRecord;
const lvl = (p: PlayerRecord) => (p.character as unknown as { level: number }).level;
const idNorm = (c: Character) => c;

// These lock in the behavior-equivalence with the old inline findIndex+slice merge
// that the heartbeat used before it was extracted + throttled. The sector-liveness
// safety argument depends on this staying set-equivalent (prev-priority, 100-cap).

test("appends new players after existing ones", () => {
  const out = mergePlayerRoster([rec("A"), rec("B")], [rec("C")], idNorm);
  assert.deepEqual(out.map((p) => p.name), ["A", "B", "C"]);
});

test("updates an existing player in place, preserving order", () => {
  const out = mergePlayerRoster([rec("A", 1), rec("B", 1)], [rec("A", 2)], idNorm);
  assert.deepEqual(out.map((p) => p.name), ["A", "B"]);
  assert.equal(lvl(out[0]), 2);
});

test("dedupes incoming by exact name (last write wins)", () => {
  const out = mergePlayerRoster([], [rec("A", 1), rec("A", 2)], idNorm);
  assert.deepEqual(out.map((p) => p.name), ["A"]);
  assert.equal(lvl(out[0]), 2);
});

test("name match is case-sensitive (matches the old merge)", () => {
  const out = mergePlayerRoster([rec("Alice")], [rec("alice")], idNorm);
  assert.deepEqual(out.map((p) => p.name), ["Alice", "alice"]);
});

test("caps at 100, keeping prev-priority", () => {
  const prev = Array.from({ length: 100 }, (_, i) => rec("P" + i));
  const out = mergePlayerRoster(prev, [rec("NEW")], idNorm);
  assert.equal(out.length, 100);
  assert.equal(out.some((p) => p.name === "NEW"), false); // prev fills the cap; new appended past 100 is sliced off
  assert.equal(out[0].name, "P0");
});

test("an update to an at-cap player still applies (not dropped)", () => {
  const prev = Array.from({ length: 100 }, (_, i) => rec("P" + i, 1));
  const out = mergePlayerRoster(prev, [rec("P50", 9)], idNorm);
  assert.equal(out.length, 100);
  assert.equal(lvl(out.find((p) => p.name === "P50")!), 9);
});

test("applies normalize to each incoming character", () => {
  let calls = 0;
  const norm = (c: Character) => { calls++; return c; };
  mergePlayerRoster([], [rec("A"), rec("B")], norm);
  assert.equal(calls, 2);
});
