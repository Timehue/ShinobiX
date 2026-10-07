import assert from "node:assert/strict";
import test from "node:test";
import { starterItems } from "../shinobij.client/src/data/starter-items.ts";
import { eventItems } from "../shinobij.client/src/data/event-items.ts";
import { GEAR_STEP_NAMES } from "../shared/gear-step-names.ts";
import { parseStepItemId } from "../shared/gear-steps.ts";

const steps = starterItems.filter((item) => parseStepItemId(item.id));

test("every step piece has its own name, and the table has nothing extra", () => {
    assert.equal(steps.length, 110);
    assert.deepEqual(Object.keys(GEAR_STEP_NAMES).sort(), steps.map((item) => item.id).sort());
    for (const item of steps) assert.equal(item.name, GEAR_STEP_NAMES[item.id], item.id);
});

test("names are unique across every item in the game, and never the base item's name", () => {
    const others = [...starterItems.filter((item) => !parseStepItemId(item.id)), ...eventItems].map((item) => item.name.toLowerCase());
    const seen = new Set();
    for (const item of steps) {
        const key = item.name.toLowerCase();
        assert.ok(!seen.has(key), `duplicate step name ${item.name}`);
        seen.add(key);
        assert.ok(!others.includes(key), `${item.name} is already another item's name`);
    }
});

test("names follow the style rules: no hyphens, no digits, a sensible length", () => {
    for (const item of steps) {
        assert.ok(!/[-‐-―]/.test(item.name), `${item.name} has a hyphen`);
        assert.ok(!/\d/.test(item.name), `${item.name} has a digit`);
        assert.ok(item.name.length >= 8 && item.name.length <= 28, `${item.name} length`);
        assert.ok(/^[A-Z][A-Za-z ]+$/.test(item.name), `${item.name} characters`);
    }
});

test("no piece still sounds like the item it upgrades", () => {
    const legacy = /\b(Whetted|Honed|Tempered|Folded|Shadow Forged|Mended|Lacquered|Ironstitched)\b/;
    for (const item of steps) assert.ok(!legacy.test(item.name), `${item.name} still uses an old rung word`);
});

test("the description names the item it outclasses and keeps the exact numbers", () => {
    const kunai = steps.find((item) => item.id === "rustfang-kunai-s1");
    assert.match(kunai.description, /^A prized find that outclasses the Rustfang Kunai\. \[Damage 14\.5 EP \| Increase Damage Given 10% \| 40 AP \| Range 4 \| CD 5\]$/);
    const hood = steps.find((item) => item.id === "cloth-hood-s2");
    assert.equal(hood.description, "A prized find that outclasses the Cloth Hood: 2% damage reduction, up from 1%.");
    for (const item of steps) assert.ok(!item.description.includes("An upgrade of"), item.id);
});
