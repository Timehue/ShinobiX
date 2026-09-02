import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pet, PetJutsu } from "../types/pet";
import { DUEL_TPS } from "./pet-duel-sim";
import {
    RITE_ACTIVE_SIZE, RITE_BAND_SIZE, RITE_CLASHES_TO_WIN, RITE_MAX_CLASHES,
    isValidRitePlan, runWarfrontRite, sanitizeRitePlan, type RitePlan,
} from "./pet-warfront-rite";
import {
    WARFRONT_ARENA_X, WARFRONT_ARENA_Y, WARFRONT_DEFAULT_DEPLOYMENT,
    WARFRONT_DEPLOYMENT_NODES, WARFRONT_GRID_COLS, WARFRONT_GRID_ROWS,
    WARFRONT_MAZE_WALLS, runPetSquadDuelCinematic,
} from "./pet-duel-cinematic";

const j = (name: string, kind: PetJutsu["kind"], power = 100, signature = false, aoe = false): PetJutsu => ({
    name, kind, power, cooldown: signature ? 5 : 2, currentCooldown: 0, signature, aoe,
} as PetJutsu);
const pet = (id: string, role: Pet["role"], subRole: Pet["subRole"], element: string, speed = 85): Pet => ({
    id, name: id, rarity: "rare", level: 20, xp: 0, maxLevel: 100,
    hp: 1050, attack: 120, defense: role === "defender" ? 105 : 65, speed, element,
    role, subRole,
    jutsus: role === "sage"
        ? [j("Mending Current", "heal"), j("Mist Aegis", "shield"), j("Tidal Verdict", "slow", 130, true, true)]
        : role === "assassin"
            ? [j("Kunai Fan", "wound"), j("Shadow Fang", "damage", 120), j("Nightfall", "damage", 155, true)]
            : subRole === "kite"
                ? [j("Ember Needle", "burn", 105), j("Shuriken Arc", "mark", 90), j("Phoenix Volley", "burn", 145, true, true)]
                : [j("Guard Break", "crush", 110), j("Stone Ward", "barrier", 90), j("Mountain Fall", "crush", 155, true, true)],
} as Pet);
const band = (prefix: string): Pet[] => [
    pet(`${prefix}-guard`, "defender", "tank", "Earth", 60),
    pet(`${prefix}-range`, "tracker", "kite", "Fire", 92),
    pet(`${prefix}-sage`, "sage", "support", "Water", 76),
    pet(`${prefix}-shadow`, "assassin", "assassin", "Wind", 112),
];
const plan = (deployment = [...WARFRONT_DEFAULT_DEPLOYMENT]): RitePlan => ({
    formation: [0, 1, 2, 3], deployment, reformAfterClash: null, reform: null, reformDeployment: null,
});

test("Kage Tactics fields all four pets and never emits a reserve or relic objective", () => {
    assert.equal(RITE_BAND_SIZE, 4); assert.equal(RITE_ACTIVE_SIZE, 4);
    const result = runWarfrontRite(band("b"), band("r"), 42, plan(), plan());
    assert.ok(result.clashes.length >= 1 && result.clashes.length <= RITE_MAX_CLASHES);
    for (const clash of result.clashes) {
        assert.equal(clash.blue.length, 4); assert.equal(clash.red.length, 4);
        assert.equal(clash.blueReserveSlot, -1); assert.equal(clash.redReserveSlot, -1);
        assert.ok(clash.result.snapshots.every((snapshot) => !snapshot.objectives?.length));
        assert.ok(!clash.result.events.some((event) => ["capture", "seal_capture", "vault_open", "relic_pickup"].includes(event.type)));
    }
});

test("ten free cells accept any four distinct pet placements", () => {
    assert.equal(WARFRONT_DEPLOYMENT_NODES.length, 10);
    assert.equal(WARFRONT_GRID_COLS, 7); assert.equal(WARFRONT_GRID_ROWS, 5);
    for (const deployment of [[0, 2, 4, 6], [1, 3, 5, 9], [9, 0, 7, 2]]) {
        assert.ok(isValidRitePlan(plan(deployment)));
        assert.deepEqual(sanitizeRitePlan(plan(deployment)).deployment, deployment);
    }
    assert.ok(!isValidRitePlan(plan([0, 0, 2, 3])));
});

test("the formation sim is byte-deterministic", () => {
    const run = () => runPetSquadDuelCinematic(band("b"), band("r"), 90210, false, true, true, [1, 4, 7, 8], [1, 4, 7, 8]);
    assert.deepEqual(run(), run());
});

test("actors stay in bounds, never share an idle cell, and face their target", () => {
    const result = runPetSquadDuelCinematic(band("b"), band("r"), 77, false, true, false, [1, 4, 7, 8], [1, 4, 7, 8]);
    for (const snapshot of result.snapshots) {
        const occupied = new Set<string>();
        for (const actor of snapshot.actors.filter((entry) => entry.hp > 0)) {
            assert.ok(Math.abs(actor.x) <= WARFRONT_ARENA_X && Math.abs(actor.y) <= WARFRONT_ARENA_Y);
            const key = `${Math.round(actor.x / 3.2)},${Math.round(actor.y / 3)}`;
            if (actor.state !== "dash") { assert.ok(!occupied.has(key), `two actors occupied ${key} at tick ${snapshot.t}`); occupied.add(key); }
            if (!actor.targetId) continue;
            const target = snapshot.actors.find((entry) => entry.id === actor.targetId && entry.hp > 0);
            if (!target) continue;
            const dx = target.x - actor.x, dy = target.y - actor.y;
            assert.ok(dx * actor.faceX + dy * actor.faceY >= -0.08, `${actor.id} faced away at tick ${snapshot.t}`);
        }
    }
});

test("ranged pets attack across cells instead of collapsing into melee", () => {
    const result = runPetSquadDuelCinematic(band("b"), band("r"), 19, false, true, false, [1, 4, 7, 8], [1, 4, 7, 8]);
    assert.ok(result.events.some((event) => event.type === "hit" && event.ranged), "no ranged hit was produced");
    assert.ok(result.snapshots.some((snapshot) => snapshot.projectiles.length > 0), "ranged attacks have no visible travel");
});

test("shadow pets traverse and supports protect allies", () => {
    const result = runPetSquadDuelCinematic(band("b"), band("r"), 31337, false, true, false, [1, 4, 7, 8], [1, 4, 7, 8]);
    assert.ok(result.events.some((event) => event.type === "maneuver" && event.move === "SHADOW STEP"), JSON.stringify(result.events.slice(0, 24)));
    assert.ok(result.events.some((event) => event.type === "heal" || event.type === "shield"));
});

test("real terrain changes routes and wall cells remain empty", () => {
    assert.equal(WARFRONT_MAZE_WALLS.length, 2);
    const result = runPetSquadDuelCinematic(band("b"), band("r"), 5, false, true, false, [1, 4, 7, 8], [1, 4, 7, 8]);
    for (const snapshot of result.snapshots) for (const actor of snapshot.actors.filter((entry) => entry.hp > 0 && entry.state !== "dash")) {
        assert.ok(!(Math.abs(actor.x) < 0.2 && (Math.abs(actor.y - 3) < 0.2 || Math.abs(actor.y + 3) < 0.2)), "actor occupied a shoji wall cell");
    }
});

test("deployment changes the combat transcript", () => {
    const blue = band("b"), red = band("r");
    const compact = runPetSquadDuelCinematic(blue, red, 8080, false, true, false, [1, 3, 5, 7], [1, 3, 5, 7]);
    const split = runPetSquadDuelCinematic(blue, red, 8080, false, true, false, [0, 3, 6, 9], [1, 3, 5, 7]);
    assert.notDeepEqual(compact.events, split.events);
});

test("clashes resolve in a watchable tactical window", () => {
    for (const seed of [1, 7, 42, 2024]) {
        const clash = runWarfrontRite(band("b"), band("r"), seed, plan(), plan()).clashes[0];
        assert.ok(clash.ticks >= DUEL_TPS * 4, `seed ${seed} ended before the opening developed`);
        assert.ok(clash.ticks <= DUEL_TPS * 38 + 1, `seed ${seed} exceeded the tactical clock`);
    }
});

test("best of three stops when a side reaches two", () => {
    const result = runWarfrontRite(band("b"), band("r"), 27, plan(), plan());
    assert.ok(result.blueRounds <= RITE_CLASHES_TO_WIN && result.redRounds <= RITE_CLASHES_TO_WIN);
    assert.ok(result.clashes.length <= RITE_MAX_CLASHES);
});
