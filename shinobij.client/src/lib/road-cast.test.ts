import test from "node:test";
import assert from "node:assert/strict";
import { RESOURCE_NODES, resourceNodeOffer } from "../../../shared/resource-nodes";
import { RESOURCE_REFILL_MS } from "../../../shared/resource-gathering";
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

test('the existing Frostfang patrol calls an Ashen Leaf visitor a Leaf Rat without forcing combat at peace',()=>{
    const [rival,local]=withPatrolStance([patrol,pilgrim],'Frostfang Village','Ashen Leaf Village',[]);
    assert.equal(rival.name,'Frostfang Village Patrol');
    assert.equal(rival.greeting,'Leaf Rat. Keep walking.');
    assert.equal(rival.avatarKey,patrol.avatarKey);
    assert.equal(rival.movement,patrol.movement);
    assert.equal(wandererForcesChoice(rival),false);
    assert.equal(local,pilgrim);
    const [home]=withPatrolStance([patrol],'Frostfang Village','Frostfang Village',[]);
    assert(!home.greeting.includes('Leaf Rat'));
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

const fishingOffers = (at: number) => RESOURCE_NODES.filter((node) => node.activity === "fishing").map((node) => resourceNodeOffer(node, at));
const cycleTimes = () => Array.from({ length: 50 }, (_, cycle) => cycle * RESOURCE_REFILL_MS);

test("the angler names a shoal in this sector that suits your skill", () => {
    const found = cycleTimes().flatMap((at) => [...new Set(fishingOffers(at).map((node) => node.sector))].map((sector) => {
        const shoals = fishingOffers(at).filter((node) => node.sector === sector);
        return { at, sector, easiest: shoals.find((node) => node.difficulty === 1), hardest: shoals.find((node) => node.difficulty === 7) };
    })).find((entry) => entry.easiest && entry.hardest && entry.easiest.name !== entry.hardest.name)!;
    assert.ok(found);
    const novice = anglerTip(found.sector, undefined, BUCKET, found.at);
    assert.ok(novice.includes(found.easiest!.name), novice);
    const master = anglerTip(found.sector, { fishingXp: 99_999 }, BUCKET, found.at);
    assert.ok(master.includes(found.hardest!.name), master);
});

test('an angler at a difficult shoal explains the skill requirement instead of inviting an impossible attempt', () => {
    const found = cycleTimes().flatMap((at) => fishingOffers(at).map((node) => ({ at, node })))
        .find(({ at, node }) => !fishingOffers(at).some((other) => other.sector === node.sector && other.difficulty === 1))!;
    assert.ok(found);
    const tip = anglerTip(found.node.sector, undefined, BUCKET, found.at);
    assert.match(tip, /You need Fishing skill/);
    assert.match(tip, /Practice at an easier shoal first/);
});

test("each road fight ends with a line about the one you fought", () => {
    assert.match(roadFightAftermath({ sourceId: "nemesis", won: true, nemesisTier: 1 })!, /Kagero/u);
    assert.match(roadFightAftermath({ sourceId: `w-38-5000-${WANDERER_TRADE_INDEX}`, name: "Seam-Boss Tetsu", won: true, nemesisTier: 1 })!, /seam to you/u);
    assert.match(roadFightAftermath({ sourceId: `w-12-5000-${WANDERER_RIFT_INDEX}`, won: false, nemesisTier: 1 })!, /rift/u);
    assert.equal(roadFightAftermath({ sourceId: "w-12-5000-0", name: "Kano Two-Blades", won: true, nemesisTier: 1 }), null, "a beaten bandit needs no epilogue");
    assert.match(roadFightAftermath({ sourceId: "w-12-5000-2", name: "Nightjar Reiko", won: false, nemesisTier: 1 })!, /Kagero/u);
});

test("a player who broke away is never told they were beaten or robbed", () => {
    const line = roadFightAftermath({ sourceId: "w-12-5000-0", name: "Kano Two-Blades", won: false, brokeAway: true, nemesisTier: 1 })!;
    assert.match(line, /broke away from Kano Two-Blades/u);
    assert.doesNotMatch(line, /took what they wanted|you lost/u);
    assert.doesNotMatch(roadFightAftermath({ sourceId: `w-12-5000-${WANDERER_RIFT_INDEX}`, won: false, brokeAway: true, nemesisTier: 1 })!, /bleeding/u);
    assert.match(roadFightAftermath({ sourceId: "nemesis", won: false, brokeAway: true, nemesisTier: 1 })!, /Kagero/u);
});
