import assert from "node:assert/strict";
import { test } from "node:test";
import type { QuestLine, QuestLinesList, QuestSite } from "../../lib/quest-lines-api";
import { coastAtlasGoals } from "./coast-atlas-goals";

const gather: QuestLine = {
    id: "wrack", title: "Saltstair Rounds II", series: "coast-rounds", world: "coast",
    state: "active", marks: 0, stages: 5, needLevel: 75, needMarks: 0, giver: "keeper", giverName: "Urabe",
    stage: {
        index: 1, kind: "gather", text: "Harvest 6 Wrack Cord.",
        place: { sector: 102, sectorName: "Wrack Strand" },
        need: { itemId: "cord", name: "Wrack Cord", count: 6, have: 2 },
    },
};

const site: QuestSite = {
    id: "strand", name: "Wrack Strand", questId: "wrack", sector: 102, approach: 1, target: 2,
    activity: "harvesting", level: 1, itemId: "cord", need: 6, have: 2, remaining: 0, refillAt: 1,
};

function list(lines: QuestLine[], sites: QuestSite[] = [site]): QuestLinesList {
    return { ok: true, marks: 0, lines, sites, coast: { level: 75, boat: true, region: 1, places: [{ sector: 102 }, { sector: 103 }] } };
}

test("atlas goals show active quest text and progress on the authoritative sector number", () => {
    const goals = coastAtlasGoals(list([gather]));
    assert.deepEqual(goals.get(102), [{ questId: "wrack", text: "Saltstair Rounds II: Harvest 6 Wrack Cord. (2/6)" }]);
    assert.equal(goals.has(2), false);
    assert.equal(goals.has(103), false);
});

test("atlas goals ignore unavailable quests and unmarked or repeat-only destinations", () => {
    const goals = coastAtlasGoals(list([gather, { ...gather, id: "open", state: "open" }], [
        site, { ...site, sector: 103, kept: true }, { ...site, sector: 104 },
    ]));
    assert.equal(goals.size, 1);
    assert.equal(goals.get(102)?.length, 1);
    assert.equal(goals.has(103), false);
    assert.equal(goals.has(104), false);
});

test("a marked alternative quest site shares the objective without duplicate rows", () => {
    const goals = coastAtlasGoals(list([gather], [site, { ...site, id: "alternate", sector: 103 }]));
    assert.equal(goals.get(102)?.length, 1);
    assert.deepEqual(goals.get(103), goals.get(102));
});

test("a prior gathering stage or a different marked site does not inherit the current goal", () => {
    const source = list([gather], [site, { ...site, id: "old-stage", itemId: "fittings", sector: 103 },
        { ...site, id: "unmarked-strand", sector: 104 }]);
    source.coast.places = [{ sector: 102, site: site.id }, { sector: 103, site: "old-stage" }, { sector: 104, site: "other-strand" }];
    const goals = coastAtlasGoals(source);
    assert.deepEqual([...goals.keys()], [102]);
});

test("atlas uses the server delivery target when another quest needs the same material", () => {
    const delivery: QuestLine = { ...gather, stage: {
        ...gather.stage!, kind: "deliver", text: "Hand 6 Wrack Cord in.", need: { ...gather.stage!.need!, have: 6 },
        deliveryReservation: { target: 10, message: "First Footing still needs 4. Gather 4 more before handing any in." },
    } };
    const goals = coastAtlasGoals(list([delivery]));
    assert.match(goals.get(102)![0]!.text, /\(6\/10\).*First Footing still needs 4/);
});
