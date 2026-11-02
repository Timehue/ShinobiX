import { strict as assert } from "node:assert";
import test from "node:test";
import { starterJutsus } from "../data/jutsu";
import { getJutsuSelectOptions, jutsuMatchesOffense } from "./jutsu-options";

const names = (offense: Parameters<typeof getJutsuSelectOptions>[1], element: Parameters<typeof getJutsuSelectOptions>[2]) =>
    getJutsuSelectOptions(starterJutsus, offense, element, "name").map((jutsu) => jutsu.name);

test("choosing an offense also lists the 40 AP jutsu of that element, which work with every offense", () => {
    const listed = getJutsuSelectOptions(starterJutsus, "Bukijutsu", "Earth", "name");

    assert.ok(listed.some((jutsu) => jutsu.ap === 60), "the discipline's own 60 AP jutsu stay listed");
    // The Ninjutsu utility is listed under Bukijutsu too: 40 AP is offense-free.
    assert.ok(listed.some((jutsu) => jutsu.name === "Stone Kunai Rain"));
    assert.ok(listed.some((jutsu) => jutsu.name === "Bedrock Chakra Focus"));
    assert.ok(listed.every((jutsu) => jutsu.element === "Earth"));
});

test("every 40 AP starter of the chosen element shows under each offense", () => {
    const fortyAp = starterJutsus.filter((jutsu) => jutsu.ap === 40 && jutsu.element === "Fire").map((jutsu) => jutsu.name);
    assert.ok(fortyAp.length > 0);

    for (const offense of ["Ninjutsu", "Taijutsu", "Genjutsu", "Bukijutsu"] as const) {
        const listed = names(offense, "Fire");
        for (const name of fortyAp) assert.ok(listed.includes(name), `${name} missing under ${offense}`);
    }
});

test("another discipline's 60 AP jutsu stay out of an offense filter", () => {
    const listed = getJutsuSelectOptions(starterJutsus, "Bukijutsu", "All", "name");

    assert.ok(listed.filter((jutsu) => jutsu.ap === 60).every((jutsu) => jutsu.type === "Bukijutsu"));
    assert.ok(!listed.some((jutsu) => jutsu.name === "Cyclone Cutter"));
});

test("the Any option still narrows to the jutsu that work with every offense", () => {
    const listed = getJutsuSelectOptions(starterJutsus, "Any", "All", "name");

    assert.ok(listed.length > 0);
    assert.ok(listed.every((jutsu) => jutsu.type === "Any"));
});

test("All offenses keeps every jutsu", () => {
    assert.ok(starterJutsus.every((jutsu) => jutsuMatchesOffense(jutsu, "All")));
});
