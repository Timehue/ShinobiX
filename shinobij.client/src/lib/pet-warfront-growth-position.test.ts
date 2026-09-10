import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pet } from "../types/pet";
import { gainPetXp } from "./pet-balance";
import { runPetSquadDuelCinematic } from "./pet-duel-cinematic";
import { runWarfrontRite, type RitePlan } from "./pet-warfront-rite";
import { runWarfrontRite as serverRun } from "../../../api/_pet-sim/pet-warfront-rite";

const pet = (id: string, overrides: Partial<Pet> = {}): Pet => ({
    id, name: id, rarity: "rare", level: 1, xp: 0, maxLevel: 100,
    hp: 1000, attack: 120, defense: 65, speed: 90, element: "None",
    role: "tracker", subRole: "kite", jutsus: [], ...overrides,
} as Pet);
const plan = (deployment = [3, 4, 7, 8]): RitePlan => ({ formation: [0, 1, 2, 3], deployment, reformAfterClash: null });
const duel = (blue: Pet, red: Pet) => runPetSquadDuelCinematic([blue], [red], 20, false, false, true, [5], [5]);
const firstDamage = (result: ReturnType<typeof duel>, actorId = "player-0") => {
    const hit = result.events.find((event) => event.type === "hit" && event.actorId === actorId && !event.crit);
    assert.ok(hit && hit.dmg, `${actorId} never landed a normal hit`);
    return hit.dmg;
};

test("Warfront uses earned level growth without normalizing or multiplying it twice", () => {
    const recruits = Array.from({ length: 4 }, (_, slot) => pet(`pet-${slot}`));
    const trained = recruits.map((entry) => gainPetXp(entry, 500_000));
    assert.ok(trained.every((entry) => entry.level === 100 && entry.hp > recruits[0].hp));
    const trainedOpening = runWarfrontRite(trained, recruits, 20, plan(), plan()).clashes[0];
    const openingActors = trainedOpening.result.snapshots[0].actors;
    const grown = openingActors.find((entry) => entry.id === "player-0")!;
    const recruit = openingActors.find((entry) => entry.id === "enemy-0")!;
    assert.ok(Math.abs(grown.maxHp / recruit.maxHp - trained[0].hp / recruits[0].hp) < 0.005,
        "the combat entry must retain the real trained HP ratio");
    for (const seed of [2, 7, 20, 31]) {
        assert.equal(runWarfrontRite(trained, recruits, seed, plan(), plan()).winner, "blue");
        assert.equal(runWarfrontRite(recruits, trained, seed, plan(), plan()).winner, "red");
    }
});

test("attack growth raises landed damage and defense keeps improving above 542", () => {
    const ordinary = duel(pet("blue"), pet("red"));
    const powerful = duel(pet("blue", { attack: 240 }), pet("red"));
    assert.ok(firstDamage(powerful) > firstDamage(ordinary) * 1.9);
    const guarded = duel(pet("blue"), pet("red", { defense: 600 }));
    const fortified = duel(pet("blue"), pet("red", { defense: 1200 }));
    assert.ok(firstDamage(fortified) < firstDamage(guarded) * 0.8,
        "both defenses used to collapse onto identical capped mitigation");
});

test("support potency grows with the caster's trained HP and move power", () => {
    const run = (hp: number, power: number) => runPetSquadDuelCinematic([
        pet("guard", { role: "defender", subRole: "tank", attack: 1 }),
        pet("sage", { hp, role: "sage", subRole: "support", attack: 1,
            jutsus: [{ name: "Ward", kind: "shield", power, cooldown: 2, currentCooldown: 0 }] }),
    ], [pet("enemy", { hp: 100_000, attack: 120 })], 20, false, false, true, [5, 4], [5]);
    const shield = (result: ReturnType<typeof run>) => {
        const event = result.events.find((entry) => entry.type === "shield" && entry.actorId === "player-1");
        assert.ok(event?.dmg, "support failed to protect its nearby ally");
        return event.dmg;
    };
    const baseline = shield(run(1000, 100));
    assert.equal(shield(run(2000, 100)), baseline * 2);
    assert.equal(shield(run(1000, 150)), baseline * 1.5);
});

test("trained stats, deployment, and re-form replay identically in the receipt authority", () => {
    const recruits = Array.from({ length: 4 }, (_, slot) => pet(`pet-${slot}`, {
        role: slot === 0 ? "defender" : slot === 3 ? "assassin" : "tracker",
        subRole: slot === 0 ? "tank" : slot === 3 ? "assassin" : "kite",
    }));
    const trained = recruits.map((entry, slot) => gainPetXp(entry, 50_000 + slot * 15_000));
    const committed = { ...plan([3, 4, 7, 0]), reforms: [{ afterClash: 0, formation: [0, 1, 2, 3], deployment: [3, 4, 7, 8] }] };
    assert.deepEqual(serverRun(trained, recruits, 21, committed, plan()), runWarfrontRite(trained, recruits, 21, committed, plan()));
});

test("speed training shortens actual movement and windup and earns more attacks", () => {
    const run = (speed: number) => duel(pet("blue", { speed, hp: 100_000 }), pet("red", { hp: 100_000, attack: 1 }));
    const slow = run(30), fast = run(270);
    const firstMoveDuration = (result: ReturnType<typeof duel>) => {
        const began = result.events.find((event) => event.type === "dash" && event.actorId === "player-0")!.t;
        const ended = result.snapshots.find((snapshot) => snapshot.t > began
            && snapshot.actors.find((actor) => actor.id === "player-0")?.state !== "dash")!.t;
        return ended - began;
    };
    const firstWindup = (result: ReturnType<typeof duel>) => {
        const began = result.events.find((event) => event.type === "windup" && event.actorId === "player-0")!.t;
        return result.events.find((event) => event.t > began && event.type === "hit" && event.actorId === "player-0")!.t - began;
    };
    assert.ok(firstMoveDuration(fast) < firstMoveDuration(slow));
    assert.ok(firstWindup(fast) < firstWindup(slow));
    const hits = (result: ReturnType<typeof duel>) => result.events.filter((event) => event.type === "hit" && event.actorId === "player-0").length;
    assert.ok(hits(fast) > hits(slow) * 1.15, "speed must affect the combat, not just an unused movement stat");
});

test("the pet placed ahead of the band receives opening pressure even if it is a sage", () => {
    const squad = [pet("guard", { role: "defender", subRole: "tank" }), pet("sage", { role: "sage", subRole: "support" }), pet("ranger"), pet("shadow", { role: "assassin", subRole: "assassin" })];
    const behind = runPetSquadDuelCinematic(squad, squad, 20, false, false, true, [3, 4, 6, 8], [3, 4, 7, 8]);
    const exposed = runPetSquadDuelCinematic(squad, squad, 20, false, false, true, [2, 5, 6, 8], [3, 4, 7, 8]);
    assert.equal(behind.snapshots[0].actors.find((actor) => actor.id === "enemy-0")?.targetId, "player-0");
    assert.equal(exposed.snapshots[0].actors.find((actor) => actor.id === "enemy-0")?.targetId, "player-1",
        "the opening must not silently move the tank ahead of an exposed sage");
});

test("each side keeps its committed shadow flank independently of the other side", () => {
    const squad = [pet("guard", { role: "defender", subRole: "tank" }), pet("range"), pet("sage", { role: "sage", subRole: "support" }), pet("shadow", { role: "assassin", subRole: "assassin" })];
    const run = (redFlank: number) => runPetSquadDuelCinematic(squad, squad, 20, false, false, true, [3, 4, 7, 0], [3, 4, 7, redFlank]);
    const north = run(0), south = run(8);
    const firstRouteY = (result: ReturnType<typeof duel>) => result.snapshots
        .flatMap((snapshot) => snapshot.actors.filter((actor) => actor.id === "enemy-3" && actor.state === "dash"))
        .slice(0, 8).map((actor) => actor.y);
    assert.ok(firstRouteY(north).every((y) => y < 0), "north flank was forced onto the opposite perimeter");
    assert.ok(firstRouteY(south).every((y) => y > 0), "south flank did not follow its own committed lane");
    assert.notDeepEqual(north.events.filter((event) => event.type === "hit"), south.events.filter((event) => event.type === "hit"));
});
