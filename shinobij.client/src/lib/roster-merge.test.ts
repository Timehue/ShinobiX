import { test } from "node:test";
import assert from "node:assert/strict";
import { mergePlayerRoster, mergeRosterSnapshot, mergeSelfRosterRow } from "./roster-merge";
import type { Character, PlayerRecord } from "../types/character";

// Minimal PlayerRecord factory — mergePlayerRoster only touches `name` + `character`.
const rec = (name: string, level = 1): PlayerRecord =>
  ({ name, character: { name, level } as unknown as Character }) as unknown as PlayerRecord;
const lvl = (p: PlayerRecord) => (p.character as unknown as { level: number }).level;
const idNorm = (c: Character) => c;

test('self vitals and sector updates preserve all sleepers beyond the old 30-player limit', () => {
  const sleepers = Array.from({ length: 250 }, (_, i) => ({ ...rec(`Sleeper${i}`), sleeping: true }));
  let roster = [rec('Shadow Fox'), ...sleepers];
  for (let tick = 0; tick < 5; tick++) roster = mergeSelfRosterRow(roster, rec('shadowfox', 20));
  assert.equal(roster.length, 251);
  assert.equal(roster[0].name, 'shadowfox');
  assert.deepEqual(roster.slice(1), sleepers);
});

test('full snapshots reconcile account aliases, remove existing duplicates and preserve input', () => {
  const prev = [rec('Shadow Fox', 1), rec('Bob', 2), rec('shadowfox', 3)];
  const incoming = [rec('SHADOW FOX', 4), rec('Cara', 5), rec('cara', 6), rec('BOB', 7)];
  assert.deepEqual(mergeRosterSnapshot(prev, incoming), [rec('SHADOW FOX', 4), rec('BOB', 7), rec('cara', 6)]);
  assert.deepEqual(prev.map(lvl), [1, 2, 3]);
});

test('large public snapshots keep every player and replace rich profiles without quadratic name scans', () => {
  let nameReads = 0;
  const prev = Array.from({ length: 2000 }, (_, i) => {
    const row = rec(`P${i}`);
    Object.defineProperty(row, 'name', { enumerable: true, get() { nameReads++; return `P${i}`; } });
    return row;
  });
  const next = mergeRosterSnapshot(prev, Array.from({ length: 2000 }, (_, i) => rec(`p${i}`, 9)));
  assert.equal(next.length, 2000);
  assert.ok(next.every(row => lvl(row) === 9));
  assert.ok(nameReads <= 4000, `linear name accesses: ${nameReads}`);
});

// Heartbeats must preserve every discovered target, regardless of population.

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

test("name match uses account slugs across display-name variants", () => {
  const out = mergePlayerRoster([rec("Shadow Fox")], [rec("shadowfox")], idNorm);
  assert.deepEqual(out.map((p) => p.name), ["shadowfox"]);
});

test("keeps sleepers and newly discovered players beyond 100 entries", () => {
  const prev = Array.from({ length: 250 }, (_, i) => ({ ...rec("P" + i), sleeping: true }));
  const out = mergePlayerRoster(prev, [rec("NEW")], idNorm);
  assert.equal(out.length, 251);
  assert.equal(out.some((p) => p.name === "NEW"), true);
  assert.equal(out.filter(p => p.sleeping).length, 250);
  assert.equal(out[0].name, "P0");
});

test('a live heartbeat clears the cached sleeper flag', () => {
  const [out] = mergePlayerRoster([{ ...rec('Shadow Fox'), sleeping: true }], [rec('shadowfox')], idNorm);
  assert.equal(out.sleeping, false);
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

// Regression: the heartbeat ships a MINIMAL character ({ avatarImage: '' }) — it
// must not wipe rich profile fields (nindo, pets, …) the 60s /api/player/roster
// snapshot grafted in. Before the fix, an online player's Nindo vanished from
// their profile ~12s after each poll. The incoming light fields still win.
test("layers a minimal heartbeat character over the cached rich one (Nindo survives)", () => {
  const rich = {
    name: "Raiko",
    character: { name: "Raiko", level: 50, nindo: "Never give up", nindoBg: "ember", pets: [{ id: "p1" }],
      unlockedAchievements: ["exam-genin", "exam-chunin"], achievementUnlockedAt: { "exam-genin": 1234 } },
  } as unknown as PlayerRecord;
  const heartbeat = {
    name: "Raiko",
    level: 51,
    character: { avatarImage: "" }, // mirrors toPlayerRecord's minimal character
  } as unknown as PlayerRecord;

  const out = mergePlayerRoster([rich], [heartbeat], idNorm);
  const ch = out[0].character as unknown as {
    nindo?: string; nindoBg?: string; level?: number; pets?: unknown[]; avatarImage?: string;
    unlockedAchievements?: string[]; achievementUnlockedAt?: Record<string, number>;
  };
  assert.equal(ch.nindo, "Never give up"); // preserved (heartbeat doesn't carry it)
  assert.equal(ch.nindoBg, "ember");       // preserved
  assert.equal(ch.pets?.length, 1);        // preserved
  assert.equal(ch.level, 50);              // preserved (heartbeat character omits it)
  assert.equal(ch.avatarImage, "");        // light field the heartbeat DID carry applies
  assert.deepEqual(ch.unlockedAchievements, ["exam-genin", "exam-chunin"]);
  assert.deepEqual(ch.achievementUnlockedAt, { "exam-genin": 1234 });
});

test("preserves the server-projected eligible pet roster across a minimal heartbeat", () => {
  const eligiblePets = [{ id: "carried-1" }, { id: "carried-2" }];
  const rich = {
    name: "Raiko",
    eligiblePets,
    character: { name: "Raiko", level: 50, pets: [...eligiblePets, { id: "overflow-1" }] },
  } as unknown as PlayerRecord;
  const heartbeat = {
    name: "Raiko",
    character: { avatarImage: "" },
  } as unknown as PlayerRecord;

  const [merged] = mergePlayerRoster([rich], [heartbeat], idNorm);
  assert.deepEqual(merged.eligiblePets, eligiblePets);
});
