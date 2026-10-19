import test from "node:test";
import assert from "node:assert/strict";
import { RESOURCE_NODES } from "../../../shared/resource-nodes";
import { roadNemesisPresentIn } from "../../../shared/road-nemesis";
import { WANDERER_RIFT_INDEX, WANDERER_TRADE_INDEX, type Wanderer } from "../../../shared/wanderer-roster";
import { anglerTip, extraRoadWanderers, roadFightAftermath, roadNemesisWanderer, wandererForcesChoice, withPatrolStance, withOrdinaryPvePreview } from "./road-cast";

const BUCKET = 5000;
const NOW = BUCKET * 6 * 60 * 60 * 1000 + 1_000;
const patrol: Wanderer = { id: "w-12-5000-0", name: "Storm Road Patrol", archetype: "patrol", verb: "patrol", level: 20,
    homeTile: 40, waypoints: [40, 41], movement: "patrol", greeting: "State your village.", tellTint: "#93c5fd", avatarKey: "patrol" };
const pilgrim: Wanderer = { ...patrol, id: "w-12-5000-1", name: "Brother Yuki", archetype: "pilgrim", verb: "gift", movement: "stationary" };

test("rift creature markers and dialogs preview the sealed player-relative fight level", () => {
    for (const level of [1, 12, 17, 35, 60, 99, 100]) {
        const seal = { name: "Roadwalker", level, activeRiftQuest: { id: "rift-a", targetSector: 12 } };
        const rolled = extraRoadWanderers(12, BUCKET, seal, {}, {}, NOW).find(w => w.archetype === "riftspawn")!;
        assert.ok(rolled);
        const preview = withOrdinaryPvePreview(rolled, level, 12);
        assert.equal(preview.level, Math.min(100, level + 1), `player level ${level}`);
        assert.equal(preview.id, rolled.id);
        assert.equal(preview.name, rolled.name);
        assert.equal(preview.avatarKey, rolled.avatarKey);
    }
    assert.equal(withOrdinaryPvePreview(pilgrim, 100, 12), pilgrim, "friendly NPCs keep their roster identity");
});

test("patrols take the voice and stance of the village that holds the road", () => {
    assert.deepEqual(withPatrolStance([patrol, pilgrim], undefined, "Leaf", []), [patrol, pilgrim], "an unclaimed road changes nothing");
    const [home, untouched] = withPatrolStance([patrol, pilgrim], "Leaf", "Leaf", []);
    assert.equal(home.patrolStance, "home");
    assert.equal(home.name, "Leaf Patrol");
    assert.equal(home.movement, "patrol");
    assert.equal(untouched, pilgrim);
    const [war] = withPatrolStance([patrol], "Mist", "Leaf", ["Mist"]);
    assert.equal(war.patrolStance, "rivalWar");
    assert.equal(war.movement, "pursue", "a warring holder's patrol hunts you");
    assert.equal(wandererForcesChoice(war), true);
    assert.equal(wandererForcesChoice(home), false);
    assert.equal(wandererForcesChoice(withPatrolStance([patrol], "Mist", "Leaf", [])[0]), false, "a rival at peace can be walked past");
});

test("Kagero appears only for a marked player, where his gate opens, unless he just stepped back", () => {
    const marked = { name: "Roadwalker", level: 30, wandererNemesis: { name: "Kagero", level: 31, tier: 2 } };
    let sector = 1;
    while (!roadNemesisPresentIn("Roadwalker", sector, BUCKET)) sector++;
    const kagero = roadNemesisWanderer(sector, BUCKET, marked, {}, NOW)!;
    assert.equal(kagero.name, "Kagero of the Cracked Mask");
    assert.equal(kagero.archetype, "nemesis");
    assert.equal(kagero.movement, "pursue");
    assert.equal(kagero.level, 32);
    assert.equal(roadNemesisWanderer(sector, BUCKET, { ...marked, wandererNemesis: null }, {}, NOW), null);
    assert.equal(roadNemesisWanderer(sector, BUCKET, marked, { [kagero.id]: NOW + 60_000 }, NOW), null);
});

test("the rift creature and the node workers respect cooldowns and relocation", () => {
    const seal = { name: "Roadwalker", level: 30, activeRiftQuest: { id: "rift-a", targetSector: 12 } };
    const ids = extraRoadWanderers(12, BUCKET, seal, {}, {}, NOW).map((w) => w.id);
    assert.ok(ids.includes(`w-12-${BUCKET}-${WANDERER_RIFT_INDEX}`));
    assert.deepEqual(extraRoadWanderers(12, BUCKET, seal, { [`w-12-${BUCKET}-${WANDERER_RIFT_INDEX}`]: NOW + 1 }, {}, NOW)
        .filter((w) => w.archetype === "riftspawn"), []);
    assert.deepEqual(extraRoadWanderers(12, BUCKET, seal, {}, { [`w-12-${BUCKET}-${WANDERER_RIFT_INDEX}`]: 30 }, NOW)
        .filter((w) => w.archetype === "riftspawn"), []);
});

test("the angler names a shoal in this sector that suits your skill", () => {
    const sector = RESOURCE_NODES.find((node) => node.activity === "fishing")!.sector;
    const shoals = RESOURCE_NODES.filter((node) => node.sector === sector && node.activity === "fishing");
    const novice = anglerTip(sector, undefined, BUCKET);
    const easiest = [...shoals].sort((a, b) => a.difficulty - b.difficulty)[0];
    assert.ok(novice.includes(easiest.name), novice);
    const master = anglerTip(sector, { fishingXp: 99_999 }, BUCKET);
    const hardest = [...shoals].sort((a, b) => b.difficulty - a.difficulty)[0];
    assert.ok(master.includes(hardest.name), master);
});

test("each road fight ends with a line about the one you fought", () => {
    assert.match(roadFightAftermath({ sourceId: "nemesis", won: true, nemesisTier: 1 })!, /Kagero/u);
    assert.match(roadFightAftermath({ sourceId: `w-38-5000-${WANDERER_TRADE_INDEX}`, name: "Seam-Boss Tetsu", won: true, nemesisTier: 1 })!, /seam to you/u);
    assert.match(roadFightAftermath({ sourceId: `w-12-5000-${WANDERER_RIFT_INDEX}`, won: false, nemesisTier: 1 })!, /rift/u);
    assert.equal(roadFightAftermath({ sourceId: "w-12-5000-0", name: "Kano Two-Blades", won: true, nemesisTier: 1 }), null, "a beaten bandit needs no epilogue");
    assert.match(roadFightAftermath({ sourceId: "w-12-5000-2", name: "Nightjar Reiko", won: false, nemesisTier: 1 })!, /Kagero/u);
});
