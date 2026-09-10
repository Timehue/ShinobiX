import { strict as assert } from "node:assert";
import test from "node:test";
import { bloodlineNamesByJutsuId, hasBloodlineMarker } from "./bloodline-marker.js";

const kit = (name: string, ...ids: string[]) => ({ name, jutsus: ids.map((id) => ({ id })) }) as unknown as Parameters<typeof bloodlineNamesByJutsuId>[0][number];

test("names every jutsu the carried bloodlines grant, first bloodline winning a shared id", () => {
    const names = bloodlineNamesByJutsuId([
        kit("Ashen Eyes", "ashen-eyes-blood-gaze", "shared-jutsu"),
        kit("Crimson Tide", "crimson-tide-surge", "shared-jutsu"),
    ]);

    assert.equal(names.get("ashen-eyes-blood-gaze"), "Ashen Eyes");
    assert.equal(names.get("crimson-tide-surge"), "Crimson Tide");
    // Starter comes first in getCharacterBloodlines, so it keeps a shared jutsu.
    assert.equal(names.get("shared-jutsu"), "Ashen Eyes");
    assert.equal(names.size, 3);
});

test("carrying no bloodline names nothing", () => {
    assert.equal(bloodlineNamesByJutsuId([]).size, 0);
});

test("marks the character's own bloodline jutsu, and any jutsu getAllJutsus stamped with a rank", () => {
    const names = new Map([["own-jutsu", "Ashen Eyes"]]);

    assert.equal(hasBloodlineMarker({ id: "own-jutsu" }, names), true);
    // Someone else's kit: no name to show, but still a bloodline jutsu.
    assert.equal(hasBloodlineMarker({ id: "foreign-jutsu", bloodlineRank: "A Rank" }, names), true);
    // Ordinary starter / authored jutsu carry neither.
    assert.equal(hasBloodlineMarker({ id: "ember-palm" }, names), false);
});
