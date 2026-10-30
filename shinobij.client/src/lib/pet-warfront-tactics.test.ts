import assert from "node:assert/strict";
import test from "node:test";
import type { Pet } from "../types/pet";
import { runPetSquadDuelCinematic, WARFRONT_CELL_X, WARFRONT_CELL_Y } from "./pet-duel-cinematic";

const pet = (id: string, element: Pet["element"] = "None", role: Pet["role"] = "tracker", subRole: Pet["subRole"] = "kite"): Pet => ({
    id, name: id, rarity: "rare", level: 1, xp: 0, maxLevel: 100,
    hp: 10_000, attack: 10, defense: 65, speed: 90, element, role, subRole, jutsus: [],
} as Pet);
const clash = (element: Pet["element"], chaseSpeed = 90) => runPetSquadDuelCinematic(
    [pet("screen", "None", "defender", "tank"), pet("ranger", element)],
    [{ ...pet("wind", "Wind", "defender", "tank"), speed: chaseSpeed }, { ...pet("water", "Water", "defender", "tank"), speed: chaseSpeed }],
    // Stage the screen below the island and its ranged partner in the centre:
    // both opposing matchups have a legal route around the solid terraces.
    20, false, false, true, [7, 4], [7, 5],
);

test("elemental counters guide cross-cover without pulling the whole formation onto one foe", () => {
    const fire = clash("Fire"), earth = clash("Earth"), neutral = clash("None");
    const laterTargets = (result: typeof fire) => new Set(result.snapshots.filter(s => s.t > 240)
        .map(s => s.actors.find(a => a.id === "player-1")!.targetId));
    assert.deepEqual(laterTargets(fire), new Set(["enemy-0"]), "Fire should keep cross-cover on Wind despite Water pressure");
    assert.ok(laterTargets(earth).has("enemy-1"), "Earth should take the accessible Water matchup");
    const waterHits = (result: typeof fire) => result.events.filter(e => e.type === "hit" && e.actorId === "player-1" && e.targetId === "enemy-1").length;
    assert.ok(waterHits(earth) > waterHits(neutral), "Earth must favor Water more than the same neutral ranger, even when both react to pressure");
    const hits = fire.events.filter(e => e.type === "hit" && e.targetId === "enemy-0");
    assert.ok(hits.some(e => e.actorId === "player-0") && hits.some(e => e.actorId === "player-1"),
        "the screen and ranged counter must actually damage their shared contact");
});

test("a defender breaks its order to intercept a threat to the firing rank", () => {
    const member = (id: string, role: Pet["role"], subRole: Pet["subRole"], element: Pet["element"], hp = 900) => ({ ...pet(id, element, role, subRole), hp, attack: 65 });
    const result = runPetSquadDuelCinematic([
        member("guard", "defender", "tank", "Earth"), member("caster", "tracker", "kite", "Fire", 300),
        member("water", "tracker", "kite", "Water", 350), member("wing", "assassin", "assassin", "Wind"),
    ], [
        member("hunter", "assassin", "assassin", "Earth"), member("screen", "defender", "tank", "Water"),
        member("fire", "tracker", "kite", "Fire"), member("support", "sage", "support", "Wind"),
    ], 2, false, false, true, [5, 2, 8, 6], [1, 4, 9, 3]);
    const protection = result.snapshots.find(s => s.actors.some(a => a.id === "player-0" && a.ai?.plan === "protect the firing rank"));
    assert.ok(protection, "the guard must react to a real backline breach");
    const threatId = protection.actors.find(a => a.id === "player-0")!.targetId;
    const threat = protection.actors.find(a => a.id === threatId)!;
    const destination = (actor: typeof threat) => actor.ai?.path.at(-1) ?? actor;
    assert.ok(protection.actors.filter(a => ["player-1", "player-2"].includes(a.id)).some(ally => {
        const foePoint = destination(threat), allyPoint = destination(ally);
        return Math.max(Math.abs(foePoint.x - allyPoint.x) / WARFRONT_CELL_X, Math.abs(foePoint.y - allyPoint.y) / WARFRONT_CELL_Y) < 1.1
            // A hit reaction can mask the windup pose while that attack is
            // still committed. Read the public attack evidence as well.
            || result.events.some(event => event.actorId === threatId && event.targetId === ally.id
                && (event.type === "windup" || event.type === "hit") && event.t >= protection.t - 30 && event.t <= protection.t);
    }), "the chosen threat must be breaching or actively casting at a ranged teammate");
    assert.ok(result.events.some(e => e.t >= protection.t && e.type === "hit" && e.actorId === "player-0" && e.targetId === threatId), "the guard must physically intercept and hit the threat, not just publish an intention");
});

test("teammates reserve a near-certain finish instead of wasting two named techniques", () => {
    const caster = (id: string) => ({ ...pet(id, "Fire"), hp: 1500, attack: 150, battleLoadoutVersion: "legacy-v1",
        jutsus: [{ name: "Focused Flame", kind: "burn", power: 180, cooldown: 2, currentCooldown: 0 }] } as Pet);
    const result = runPetSquadDuelCinematic([caster("left"), caster("right")], [
        { ...pet("weak", "Wind", "defender", "tank"), hp: 40 },
        { ...pet("strong", "Earth", "defender", "tank"), hp: 3000 },
    ], 20, false, false, true, [2, 6], [3, 7]);
    const firstHit = result.events.find(e => e.type === "hit" && e.targetId === "enemy-0");
    assert.ok(firstHit, "the wounded target must actually be engaged");
    const committed = result.events.filter(e => e.t < firstHit.t && e.type === "windup" && e.targetId === "enemy-0" && e.move === "Focused Flame");
    const resolveAt = (cast: typeof committed[number]) => result.events.find(event => event.t > cast.t
        && event.actorId === cast.actorId && (event.type === "hit" || event.type === "whiff"))?.t ?? Infinity;
    for (const cast of committed) assert.ok(committed.filter(other => other.t <= cast.t && resolveAt(other) > cast.t).length <= 1,
        "do not overlap two finishing techniques; a retry after a blocked shot is valid");
    for (const actorId of ["player-0", "player-1"]) assert.ok(result.events.some(e => e.actorId === actorId && e.targetId === "enemy-1" && e.move === "Focused Flame" && e.type === "hit"), "both teammates must continue fighting the surviving threat");
});

test("ranged pets escape an adjacent attacker even while targeting a different foe", () => {
    // The trained kiter can outrun these guards. Equal-speed pursuit may force
    // a defensive volley instead of promising permanent separation.
    const result = clash("Fire", 30);
    const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
        Math.max(Math.abs(a.x - b.x) / WARFRONT_CELL_X, Math.abs(a.y - b.y) / WARFRONT_CELL_Y);
    const escape = result.snapshots.find(s => {
        const ranger = s.actors.find(a => a.id === "player-1")!;
        const pressure = s.actors.find(a => a.id === "enemy-1")!;
        return ranger.state === "dash" && ranger.ai?.plan === "restore the firing lane"
            && ranger.targetId === "enemy-0" && distance(ranger, pressure) < 1.1;
    });
    assert.ok(escape, "a nearby non-target must trigger a physical retreat");
    const recovered = result.snapshots.find(s => s.t > escape.t && s.actors.some(a => a.id === "player-1"
        && a.state === "windup" && s.actors.filter(e => e.team === "enemy" && e.hp > 0).every(e => distance(a, e) >= 1.9)));
    assert.ok(recovered, "the pet must resume casting from safe distance rather than flee forever");
});

test("equal-speed pressure cannot keep a ranger fleeing without another attack", () => {
    const result = clash("Fire");
    const escape = result.snapshots.find(snapshot => snapshot.actors.some(actor => actor.id === "player-1"
        && actor.state === "dash" && actor.ai?.plan === "restore the firing lane"));
    assert.ok(escape, "exercise a real disengagement under pressure");
    assert.ok(result.events.some(event => event.t > escape.t && event.actorId === "player-1" && event.type === "hit"),
        "a pressured ranger must resume contributing damage instead of endlessly retreating");
});


test("a ranged pet chooses an area technique when it can catch a cluster", () => {
    const caster = { ...pet("caster", "Fire"), battleLoadoutVersion: "legacy-v1", jutsus: [
        // Keep the single-target alternative ready after recovery so the
        // area choice is tested independently of staggered cooldown timing.
        { name: "Needle", kind: "burn", power: 100, cooldown: .1, currentCooldown: 0 },
        { name: "Flame Sweep", kind: "burn", power: 100, cooldown: 2, currentCooldown: 0, aoe: true },
    ] } as Pet;
    const result = runPetSquadDuelCinematic([caster], [pet("one", "Wind", "defender", "tank"), pet("two", "Wind", "defender", "tank")],
        20, false, false, true, [0], [1, 3]);
    const firstCast = result.events.find(e => e.type === "windup" && e.actorId === "player-0");
    assert.equal(firstCast?.move, "Needle", "the isolated opening contact needs the single-target technique");
    assert.ok(result.events.filter(e => e.type === "windup" && e.actorId === "player-0" && e.move === "Flame Sweep").some(cast => {
        const snapshot = result.snapshots.find(s => s.t >= cast.t && s.actors.find(a => a.id === "player-0")?.state === "windup");
        return snapshot?.actors.find(a => a.id === "player-0")?.ai?.cooldownPriorities?.includes("Needle: ready");
    }), "area value must win while the single-target alternative is ready");
    const sweep = result.events.filter(e => e.type === "hit" && e.actorId === "player-0" && e.move === "Flame Sweep");
    assert.ok(sweep.some(e => sweep.some(other => other.t === e.t && other.targetId !== e.targetId)), "the selected area attack must actually hit multiple enemies");
});
