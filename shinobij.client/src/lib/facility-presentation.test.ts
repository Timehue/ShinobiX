import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const facilities = [
  "battle-arena", "story-hall", "town-hall", "bank", "shop",
  "clan-hall", "hospital", "mission-hall", "cafeteria", "tavern",
  "stat-training", "jutsu-training", "world-map", "home", "pet-yard", "card-hall",
] as const;

// Facility card icons are painted per village (lib/facility-thumbs.ts globs these).
const thumbVillages = ["frostfang", "stormveil", "ashen-leaf", "moonshadow"] as const;

const presentationSource = readFileSync(new URL("./facility-presentation.ts", import.meta.url), "utf8");
const studioSource = readFileSync(new URL("./studio-screen-presentation.ts", import.meta.url), "utf8");
const villageSource = readFileSync(new URL("../screens/Village.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("../components/layout/AdaptiveGameShell.tsx", import.meta.url), "utf8");

test("every Village destination has a coherent facility art contract", () => {
  assert.equal((presentationSource.match(/:\s*facility\(/g) ?? []).length, facilities.length);
  for (const id of facilities) {
    assert.ok(presentationSource.includes(id.includes("-") ? `"${id}": facility` : `${id}: facility`), `missing ${id} presentation`);
    for (const village of thumbVillages) {
      assert.ok(existsSync(new URL(`../assets/facilities/thumbs/${village}/${id}.webp`, import.meta.url)), `missing ${village}/${id} thumbnail`);
    }
  }
});

test("generated facility heroes exist for every destination without an existing studio hero", () => {
  for (const id of facilities.filter((facility) => facility !== "town-hall" && facility !== "clan-hall")) {
    assert.ok(existsSync(new URL(`../assets/facilities/${id}.webp`, import.meta.url)), `missing ${id} hero`);
  }
});

test("facility art is used by the Village directory and destination mastheads", () => {
  assert.ok(villageSource.includes("VILLAGE_FACILITIES.map"));
  assert.ok(!villageSource.includes("assets/village-icons"));
  for (const route of ["training", "jutsuTraining", "missions", "battleArena", "clan", "worldMap", "townHall", "bank", "shop", "hospital", "cafeteria", "storyHall", "home", "pets", "shinobiTiles", "tavern"])
    assert.match(studioSource, new RegExp(`\\b${route}: atFacility\\(`), `missing facility presentation for ${route}`);
  assert.ok(appSource.includes("<ScreenTopChrome"));
  assert.ok(appSource.includes("<AdaptiveGameShell"));
  assert.ok(shellSource.includes("screen-facility"));
});
