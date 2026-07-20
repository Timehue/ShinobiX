import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pet, PetJutsu } from "../types/pet";
import { runPetDuelCinematic } from "./pet-duel-cinematic";
import { directPetDuelPresentation } from "./pet-duel-stage-director";
import { DUEL_TPS } from "./pet-duel-sim";

const move = (value: Partial<PetJutsu>): PetJutsu => ({
    name: "Strike", power: 88, cooldown: 2, currentCooldown: 0, kind: "damage", ...value,
} as PetJutsu);
const pet = (value: Partial<Pet>): Pet => ({
    id: "pet", name: "Pet", rarity: "rare", level: 18, xp: 0, maxLevel: 100,
    hp: 620, attack: 136, defense: 58, speed: 92, element: "Wind",
    jutsus: [
        move({ name: "Force Pulse", kind: "damage" }),
        move({ name: "Tempest Break", kind: "push", power: 112, cooldown: 4, signature: true }),
        move({ name: "Storm Focus", kind: "buff", power: 52, cooldown: 5 }),
        move({ name: "Gale Step", kind: "move", power: 1, cooldown: 3 }),
    ],
    ...value,
} as Pet);

test("stage director preserves combat truth while replacing leader/follower motion", () => {
    const original = runPetDuelCinematic(
        pet({ id: "hawk", name: "Tempest Hawk", element: "Wind" }),
        pet({ id: "hound", name: "Arena Guardhound", element: "Earth", speed: 76 }),
        20260601,
    );
    const directed = directPetDuelPresentation(original);
    assert.equal(directed.result, original.result);
    assert.equal(directed.winner, original.winner);
    assert.deepEqual(directed.events, original.events);
    assert.equal(directed.snapshots.length, original.snapshots.length);
    for (let tick = 0; tick < original.snapshots.length; tick++) {
        const before = original.snapshots[tick].actors;
        const after = directed.snapshots[tick].actors;
        assert.deepEqual(after.map(({ id, hp, maxHp, stamina, statuses }) => ({ id, hp, maxHp, stamina, statuses })), before.map(({ id, hp, maxHp, stamina, statuses }) => ({ id, hp, maxHp, stamina, statuses })));
    }

    let activeTicks = 0;
    let simultaneousTicks = 0;
    let trainRun = 0;
    let longestTrain = 0;
    let plantedRun = 0;
    let longestPlant = 0;
    let largestStep = 0;
    let largestNonBurstStep = 0;
    let largestStepLabel = "";
    let largestNonBurstLabel = "";
    const distances: number[] = [];
    for (let tick = 1; tick < directed.snapshots.length; tick++) {
        const previous = directed.snapshots[tick - 1].actors;
        const current = directed.snapshots[tick].actors;
        const pa = previous.find((actor) => actor.team === "player")!;
        const pb = previous.find((actor) => actor.team === "enemy")!;
        const a = current.find((actor) => actor.team === "player")!;
        const b = current.find((actor) => actor.team === "enemy")!;
        const av = { x: a.x - pa.x, y: a.y - pa.y };
        const bv = { x: b.x - pb.x, y: b.y - pb.y };
        const as = Math.hypot(av.x, av.y);
        const bs = Math.hypot(bv.x, bv.y);
        if (as > largestStep) { largestStep = as; largestStepLabel = `${a.id} ${pa.state}->${a.state} at ${tick}`; }
        if (bs > largestStep) { largestStep = bs; largestStepLabel = `${b.id} ${pb.state}->${b.state} at ${tick}`; }
        const aBurst = a.state === "dash" || a.state === "dodge" || a.state === "strike" || a.state === "stagger";
        const bBurst = b.state === "dash" || b.state === "dodge" || b.state === "strike" || b.state === "stagger";
        if (!aBurst && as > largestNonBurstStep) { largestNonBurstStep = as; largestNonBurstLabel = `${a.id} ${pa.state}->${a.state} at ${tick}`; }
        if (!bBurst && bs > largestNonBurstStep) { largestNonBurstStep = bs; largestNonBurstLabel = `${b.id} ${pb.state}->${b.state} at ${tick}`; }
        const separation = Math.hypot(b.x - a.x, b.y - a.y);
        distances.push(separation);
        if (as > 0.01 || bs > 0.01) activeTicks++;
        if (as > 0.01 && bs > 0.01) simultaneousTicks++;
        if (as <= 0.01 && bs <= 0.01) longestPlant = Math.max(longestPlant, ++plantedRun);
        else plantedRun = 0;
        let train = false;
        if (as > 0.01 && bs > 0.01 && separation > 2.5) {
            const alignment = (av.x * bv.x + av.y * bv.y) / (as * bs);
            train = alignment > 0.86;
        }
        trainRun = train ? trainRun + 1 : 0;
        longestTrain = Math.max(longestTrain, trainRun);
    }
    assert.ok(Math.max(...distances) - Math.min(...distances) >= 6, "the fight should visibly contract and expand");
    assert.ok(simultaneousTicks / Math.max(1, activeTicks) < 0.42, "one fighter should usually own the movement beat");
    assert.ok(longestTrain < DUEL_TPS * 0.65, `leader/follower train lasted ${longestTrain} ticks`);
    assert.ok(longestPlant >= DUEL_TPS * 0.28, `no readable planted guard beat (${longestPlant} ticks)`);
    assert.ok(largestStep < 0.72, `stage motion snapped ${largestStep.toFixed(3)} arena units in one tick (${largestStepLabel})`);
    assert.ok(largestNonBurstStep < 0.72, `non-burst motion snapped ${largestNonBurstStep.toFixed(3)} arena units in one tick (${largestNonBurstLabel})`);
    assert.ok(directed.snapshots.some((snapshot) => snapshot.actors.some((actor) => actor.state === "dodge")), "the performance should contain a readable evade");
    assert.ok(directed.snapshots.some((snapshot) => snapshot.actors.some((actor) => actor.state === "strike")), "the performance should contain committed strikes");
    assert.ok(directed.snapshots.some((snapshot) => snapshot.actors.some((actor) => actor.state === "recover")), "contact should hold a recovery pose before repositioning");
    const setupCasts = directed.events.filter((event) => event.type === "cast" && (event.kind === "buff" || event.kind === "haste" || event.kind === "heal" || event.kind === "barrier"));
    assert.ok(setupCasts.length > 0, "fixture should exercise a disengaging setup cast");
    for (const cast of setupCasts) {
        const snapshot = directed.snapshots[Math.min(directed.snapshots.length - 1, cast.t)];
        const caster = snapshot.actors.find((actor) => actor.id === cast.actorId)!;
        const foe = snapshot.actors.find((actor) => actor.team !== caster.team && actor.hp > 0)!;
        assert.ok(Math.hypot(caster.x - foe.x, caster.y - foe.y) >= 5.5, `${cast.move ?? cast.kind} should resolve from a visible distance break`);
    }
    let dodgeRun = 0, longestDodge = 0;
    for (const snapshot of directed.snapshots) {
        dodgeRun = snapshot.actors.some((actor) => actor.state === "dodge") ? dodgeRun + 1 : 0;
        longestDodge = Math.max(longestDodge, dodgeRun);
    }
    assert.ok(longestDodge >= DUEL_TPS * 0.36, `dodge phrase ended before its landing (${longestDodge} ticks)`);
});
test("stage director leaves party fights unchanged until multi-actor shot grammar is available", () => {
    const fake = runPetDuelCinematic(pet({ id: "a" }), pet({ id: "b" }), 7);
    const partyShape = {
        ...fake,
        snapshots: fake.snapshots.map((snapshot) => ({
            ...snapshot,
            actors: [...snapshot.actors, { ...snapshot.actors[0], id: "player-1", slot: 1 }],
        })),
    };
    assert.equal(directPetDuelPresentation(partyShape), partyShape);
});
