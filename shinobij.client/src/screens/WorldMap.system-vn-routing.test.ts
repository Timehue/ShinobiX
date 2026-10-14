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
    assert.match(pet, /buildPetEncounterVn\(canonicalNarrativeEvent\(defaultPetEncounterVn, petEncounterVn, \['pet-encounter'\]\), activePetEncounter, petActorImage\)/);
    assert.match(pet, /petCardImage\(activePetEncounter, sharedImages\)/);
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
    assert.match(chest, /cinematicChestEvent: CreatorEvent = \{ \.\.\.canonicalNarrativeEvent\(defaultAncientChestVn, ancientChestVn, \['ancient-chest'\]\), biome \}/);
    assert.match(chest, /onComplete=\{\(\) => setChestVnDone\(true\)\}/);
    assert.doesNotMatch(chest, /visual-novel admin-vn-play/);
});

test("system-event finale actions preserve their domain handoffs", () => {
    const reader = readFileSync(new URL("../components/TriggeredVisualNovel.tsx", import.meta.url), "utf8");
    assert.match(reader, /isPetEncounterEvent[\s\S]*?"Meet Companion"/);
    assert.match(reader, /isAncientChestEvent[\s\S]*?"Open Chest"/);
});

test("accepting Senna's rift travels to the sealed destination instead of opening a remote board", () => {
    const accept = branch("if (c.trait === RIFT_ACCEPT_MARKER)", "if (c.trait === SCRIBE_ACCEPT_MARKER)");
    assert.match(accept, /if \(resp\.ok && resp\.activeRiftQuest\)/);
    assert.match(accept, /if \(!presentation\.isCurrent\(\)\) return/);
    assert.match(accept, /if \(onServerVersion\?\.\(resp\._saveVersion\) === false\) return/);
    assert.match(accept, /const sealedSector = resp\.activeRiftQuest\.targetSector/);
    assert.match(accept, /triggerTravelPoint\(playableFieldObjectiveSector\(sealedSector\)\)/);
    assert.doesNotMatch(accept, /setSelectedSector\(/);

    // The shared map action requests real travel and installs the sealed tile
    // alongside the destination sector; merely changing the board hides the
    // avatar and leaves walking disabled by sectorIsCurrent.
    const point = branch("function triggerTravelPoint(sector: number)", "// Consume navigation after");
    assert.match(point, /travelToSector\(sector\)/);
    const travel = branch("function travelToSector(", "function triggerTravelPoint(");
    assert.match(travel, /beginSectorTravel\(sector, \(arrivalTile\) =>/);
    assert.match(travel, /setCurrentSector\(sector\)/);
    assert.match(travel, /setSelectedSector\(sector\)/);
    assert.match(travel, /setSectorPlayerPos\(arrival \?\? SECTOR_CENTRE_TILE\)/);
});
