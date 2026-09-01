import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./PetLadder.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const screenTypes = readFileSync(new URL("../types/core.ts", import.meta.url), "utf8");
const screenGuards = readFileSync(new URL("../lib/screen-guards.ts", import.meta.url), "utf8");

test("Pet Ladder returns to the Arena District named by its back action", () => {
    assert.match(source, /onClick=\{\(\) => setScreen\("arenaDistrict"\)\}>← Arena District<\/button>/);
    assert.doesNotMatch(source, /setScreen\("petArena"\)\}>← Arena District/);
});

test("Pet Ladder and its Arena District return target stay connected to the app router", () => {
    for (const screen of ["petLadder", "arenaDistrict"] as const) {
        assert.match(screenTypes, new RegExp(`\\| "${screen}"`), `${screen} must remain a valid Screen`);
        assert.match(screenGuards, new RegExp(`"${screen}"`), `${screen} must remain available to the player shell`);
    }

    assert.match(appSource, /const PetLadder = lazyWithRetry\(/, "the ladder must remain loadable");
    assert.match(appSource, /screen === "petLadder" && character && <PetLadder/, "the ladder must remain mounted by its screen key");
    assert.match(
        appSource,
        /screen === "arenaDistrict" \? "arenaDistrict" : "battleArena"/,
        "the return target must render the Arena District lobby rather than the Battle Arena lobby",
    );
});

test("Pet Ladder exposes its selected mode to assistive technology", () => {
    assert.match(source, /className="pl-tabs" role="group" aria-label="Pet Ladder mode"/);
    assert.match(source, /aria-pressed=\{mode === m\}/);
});
