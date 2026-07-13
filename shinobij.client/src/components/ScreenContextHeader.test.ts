import assert from "node:assert/strict";
import test from "node:test";
import { shouldShowScreenContextHeader } from "../lib/screen-context";

test("native page headings suppress the redundant shared context header", () => {
  for (const screen of ["professions", "training", "jutsuTraining", "missions", "townHall", "tavern"] as const) {
    assert.equal(shouldShowScreenContextHeader(screen), false, screen);
  }
});

test("routes that rely on the shared context header keep it", () => {
  for (const screen of ["inventory", "profile", "worldMap", "shop"] as const) {
    assert.equal(shouldShowScreenContextHeader(screen), true, screen);
  }
});
