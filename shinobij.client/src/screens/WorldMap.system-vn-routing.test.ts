import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

const source = readFileSync(new URL("./WorldMap.tsx", import.meta.url), "utf8");

function branch(start: string, end: string): string {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.notEqual(from, -1, `missing branch: ${start}`);
    assert.notEqual(to, -1, `missing branch boundary: ${end}`);
    return source.slice(from, to);
}

test("live pet encounters use the premium reader and keep the discovered pet art", () => {
    const pet = branch(
        "if (activePetEncounter && !petVnDone)",
        "if (activePetEncounter && petVnDone)",
    );
    assert.match(pet, /<TriggeredVisualNovel/);
    assert.match(pet, /event=\{cinematicPetEvent\}/);
    assert.match(pet, /rightName: page\.rightName \|\| activePetEncounter\.name/);
    assert.match(pet, /rightImage: page\.rightImage \|\| petActorImage/);
    assert.match(pet, /onComplete=\{\(\) => setPetVnDone\(true\)\}/);
    assert.doesNotMatch(pet, /visual-novel admin-vn-play/);
});

test("live ancient chests use the premium reader and still enter the loot step", () => {
    const chest = branch(
        "if (activeChest && !chestVnDone)",
        "if (activeChest && chestVnDone)",
    );
    assert.match(chest, /<TriggeredVisualNovel/);
    assert.match(chest, /event=\{cinematicChestEvent\}/);
    assert.match(chest, /cinematicChestEvent: CreatorEvent = \{ \.\.\.ancientChestVn, biome \}/);
    assert.match(chest, /onComplete=\{\(\) => setChestVnDone\(true\)\}/);
    assert.doesNotMatch(chest, /visual-novel admin-vn-play/);
});

test("system-event finale actions preserve their domain handoffs", () => {
    const reader = readFileSync(new URL("../components/TriggeredVisualNovel.tsx", import.meta.url), "utf8");
    assert.match(reader, /isPetEncounterEvent[\s\S]*?"Meet Companion"/);
    assert.match(reader, /isAncientChestEvent[\s\S]*?"Open Chest"/);
});
