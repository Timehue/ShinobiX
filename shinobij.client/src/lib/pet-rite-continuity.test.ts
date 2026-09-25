import assert from "node:assert/strict";
import test from "node:test";
import type { Pet, PetJutsu } from "../types/pet";
import {
    aiRitePlan,
    deterministicRiteCounterMove,
    isValidRitePlan,
    runWarfrontRite,
    type RiteResult,
} from "./pet-warfront-rite";
import {
    automaticRiteReformChoice,
    lockRiteReform,
    riteHeldFormation,
} from "./pet-rite-continuity";

const j = (name: string, kind: PetJutsu["kind"], power = 100, signature = false, aoe = false): PetJutsu => ({
    name, kind, power, cooldown: signature ? 5 : 2, currentCooldown: 0, signature, aoe,
} as PetJutsu);
const pet = (id: string, role: Pet["role"], subRole: Pet["subRole"], element: string, speed: number, hp: number, attack: number): Pet => ({
    id, name: id, rarity: "rare", level: 20, xp: 0, maxLevel: 100,
    hp, attack, defense: role === "defender" ? 105 : 65, speed, element,
    role, subRole,
    jutsus: role === "sage"
        ? [j("Mending Current", "heal"), j("Mist Aegis", "shield"), j("Tidal Verdict", "slow", 130, true, true)]
        : role === "assassin"
            ? [j("Kunai Fan", "wound"), j("Shadow Fang", "damage", 120), j("Nightfall", "damage", 155, true)]
            : subRole === "kite"
                ? [j("Ember Needle", "burn", 105), j("Shuriken Arc", "mark", 90), j("Phoenix Volley", "burn", 145, true, true)]
                : [j("Guard Break", "crush", 110), j("Stone Ward", "barrier", 90), j("Mountain Fall", "crush", 155, true, true)],
} as Pet);
const band = (prefix: string, hp = 1050, attack = 120): Pet[] => [
    pet(`${prefix}-guard`, "defender", "tank", "Earth", 60, hp, attack),
    pet(`${prefix}-range`, "tracker", "kite", "Fire", 92, hp, attack),
    pet(`${prefix}-sage`, "sage", "support", "Water", 76, hp, attack),
    pet(`${prefix}-shadow`, "assassin", "assassin", "Wind", 112, hp, attack),
];

const verdict = (result: RiteResult) => ({
    winner: result.winner,
    rounds: [result.blueRounds, result.redRounds],
    clashes: result.clashes.map((clash) => ({
        winner: clash.winner,
        standing: [clash.blueStanding, clash.redStanding],
        ticks: clash.ticks,
        blueNodes: clash.blue.map((combatant) => [combatant.slot, combatant.node]),
    })),
    totalTicks: result.totalTicks,
});

/** A co-op spectator's opening: the seat's automatic plan passed explicitly,
 * exactly as the Rite resolves it before the first clash. */
function spectatorOpening(blue: Pet[], red: Pet[], seed: number) {
    const plan = aiRitePlan(blue, seed);
    return { plan, result: runWarfrontRite(blue, red, seed, plan) };
}

const pairings: Array<[string, Pet[], Pet[]]> = [
    ["mirror", band("b"), band("r")],
    ["blue favoured", band("b", 1250, 135), band("r", 950, 110)],
    ["red favoured", band("b", 950, 110), band("r", 1250, 135)],
];

test("holding the line fought is not a command and leaves the plan untouched", () => {
    const [, blue, red] = pairings[0];
    const { plan, result } = spectatorOpening(blue, red, 42);
    const clash = result.clashes[0];
    const held = riteHeldFormation(clash, plan, 4);
    assert.deepEqual(held.deployment, clash.blue.map((_, slot) => clash.blue.find((combatant) => combatant.slot === slot)!.node));
    const locked = lockRiteReform(plan, clash, 0, blue.length, held);
    assert.equal(locked.changed, false);
    assert.equal(locked.plan, plan, "a hold must not create a new transcript entry");
});

test("a locked re-form is appended exactly as the re-form panel recorded it", () => {
    const [, blue, red] = pairings[0];
    const { plan, result } = spectatorOpening(blue, red, 42);
    const clash = result.clashes[0];
    const held = riteHeldFormation(clash, plan, 4);
    const moved = [...held.deployment];
    const open = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].find((node) => !moved.includes(node))!;
    moved[2] = open;
    const first = lockRiteReform(plan, clash, 0, blue.length, { formation: held.formation, deployment: moved });
    assert.equal(first.changed, true);
    assert.deepEqual(first.plan.reforms, [{ afterClash: 0, formation: held.formation, deployment: moved }]);
    assert.equal(first.plan.reformAfterClash, 0, "the first re-form fills the legacy single-reform fields");
    assert.deepEqual(first.plan.reformDeployment, moved);
    assert.ok(isValidRitePlan(first.plan));
    const replay = runWarfrontRite(blue, red, 42, first.plan);
    assert.deepEqual(verdict({ ...replay, clashes: replay.clashes.slice(0, 1) }).clashes, verdict({ ...result, clashes: result.clashes.slice(0, 1) }).clashes,
        "a re-form never rewrites the clash it answers");
    if (replay.clashes[1]) assert.equal(replay.clashes[1].blue.find((combatant) => combatant.slot === 2)?.node, open);

    // Re-locking the same clash replaces its entry and keeps the legacy fields.
    const again = [...moved];
    again[2] = held.deployment[2];
    again[0] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].find((node) => !moved.includes(node) && node !== held.deployment[2])!;
    const second = lockRiteReform(first.plan, clash, 0, blue.length, { formation: held.formation, deployment: again });
    assert.equal(second.plan.reforms?.length, 1);
    assert.deepEqual(second.plan.reforms?.[0].deployment, again);
    assert.equal(second.plan.reformAfterClash, 0);
    assert.deepEqual(second.plan.reformDeployment, moved, "legacy fields keep the first recorded re-form");
});

test("an automatic seat answers a lost clash with the public counter and otherwise holds", () => {
    for (const [label, blue, red] of pairings) {
        const { plan, result } = spectatorOpening(blue, red, 7);
        const clash = result.clashes[0];
        const held = riteHeldFormation(clash, plan, 4);
        assert.equal(automaticRiteReformChoice(clash, held, true), held, `${label}: a sealed replay always holds`);
        const counter = deterministicRiteCounterMove(clash, "blue");
        const choice = automaticRiteReformChoice(clash, held, false);
        if (counter) assert.deepEqual(choice, { formation: counter.formation, deployment: counter.deployment }, label);
        else assert.equal(choice, held, `${label}: a winning or drawn seat holds its line`);
    }
});
