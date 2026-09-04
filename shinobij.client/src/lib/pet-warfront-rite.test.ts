import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pet, PetJutsu } from "../types/pet";
import { DUEL_TPS } from "./pet-duel-sim";
import {
    RITE_ACTIVE_SIZE, RITE_BAND_SIZE, RITE_CLASHES_TO_WIN, RITE_MAX_CLASHES,
    RITE_LOSER_REGROUP, RITE_MIN_ENTRY_HP, RITE_REGROUP,
    deterministicRiteCounterMove, isValidRitePlan, runWarfrontRite, sanitizeRitePlan,
    tryMoveRitePet, type RitePlan,
} from "./pet-warfront-rite";
import { riteTacticalReport } from "./pet-warfront-rite-presentation";
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

test("Beastbound Warfront fields all four pets and never emits a reserve or relic objective", () => {
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

test("every pet can move to every legal open cell while occupied and invalid cells reject", () => {
    const deployment = [...WARFRONT_DEFAULT_DEPLOYMENT];
    const occupied = new Set(deployment);
    for (let slot = 0; slot < RITE_BAND_SIZE; slot++) {
        for (let node = 0; node < WARFRONT_DEPLOYMENT_NODES.length; node++) {
            const moved = tryMoveRitePet(deployment, slot, node);
            if (occupied.has(node)) {
                assert.equal(moved, null, `slot ${slot} must not displace the pet on occupied node ${node}`);
                continue;
            }
            assert.ok(moved, `slot ${slot} should reach open node ${node}`);
            assert.equal(moved[slot], node);
            for (let other = 0; other < RITE_BAND_SIZE; other++) {
                if (other !== slot) assert.equal(moved[other], deployment[other], "one placement action moved a second pet");
            }
            assert.ok(isValidRitePlan(plan(moved)));
        }
    }
    assert.equal(tryMoveRitePet(deployment, -1, 0), null);
    assert.equal(tryMoveRitePet(deployment, RITE_BAND_SIZE, 0), null);
    assert.equal(tryMoveRitePet(deployment, 0, -1), null);
    assert.equal(tryMoveRitePet(deployment, 0, WARFRONT_DEPLOYMENT_NODES.length), null);
    assert.equal(tryMoveRitePet([3, 3, 7, 8], 0, 0), null, "an already-illegal draft must fail closed");
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

test("all eight fighters enter at their exact committed cells before movement", () => {
    const blue = band("b"), red = band("r");
    const bluePlan: RitePlan = {
        ...plan([0, 2, 6, 9]),
        formation: [3, 0, 2, 1],
    };
    const redPlan: RitePlan = {
        ...plan([1, 4, 7, 8]),
        formation: [1, 3, 0, 2],
    };
    const clash = runWarfrontRite(blue, red, 2468, bluePlan, redPlan).clashes[0];
    const first = clash.result.snapshots[0];
    assert.equal(first.t, 0);
    assert.equal(first.actors.length, 8);

    for (const [team, combatants, roster, xSign] of [
        ["player", clash.blue, blue, -1],
        ["enemy", clash.red, red, 1],
    ] as const) {
        for (const combatant of combatants) {
            const actor = first.actors.find((candidate) => candidate.id === `${team}-${combatant.lane}`);
            const [nodeX, nodeY] = WARFRONT_DEPLOYMENT_NODES[combatant.node];
            assert.ok(actor, `${team}-${combatant.lane} is missing from the deployment tableau`);
            assert.equal(combatant.petId, String(roster[combatant.slot].id), "formation lane lost its roster identity");
            assert.ok(Math.abs(actor.x - nodeX * xSign) < 0.01, `${actor.id} did not begin at committed x`);
            assert.ok(Math.abs(actor.y - nodeY) < 0.01, `${actor.id} did not begin at committed y`);
        }
    }
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

test("exact cumulative exit health stays below the survivor floor until the next clash", () => {
    const result = runWarfrontRite(band("carry-blue"), band("carry-red"), 6, plan(), plan());
    assert.equal(result.clashes.length, 3, "carry-floor fixture must reach the deciding clash");
    const clash = result.clashes[1];
    const combatant = clash.blue.find((entry) => entry.slot === 1);
    assert.ok(combatant, "carry-floor fixture lost blue slot 1");
    const actor = clash.result.snapshots.at(-1)?.actors
        .find((entry) => entry.team === "player" && entry.slot === combatant.lane);
    assert.ok(actor, "carry-floor fixture lost blue slot 1's final actor");
    const localExitRatio = actor.maxHp > 0 ? actor.hp / actor.maxHp : 0;
    const expectedExitHp = combatant.entryHp * localExitRatio;
    assert.ok(Math.abs(combatant.exitHp - expectedExitHp) <= 1e-12);
    assert.ok(combatant.exitHp > 0 && combatant.exitHp < RITE_MIN_ENTRY_HP,
        "the exact exit transcript was incorrectly raised to the next-entry floor");

    const next = result.clashes[2].blue.find((entry) => entry.slot === combatant.slot);
    assert.ok(next, "carry-floor fixture lost blue slot 1 from the next clash");
    const share = clash.winner === null || clash.winner === "blue" ? RITE_REGROUP : RITE_LOSER_REGROUP;
    const expectedNextEntry = RITE_MIN_ENTRY_HP + (1 - RITE_MIN_ENTRY_HP) * share;
    assert.ok(Math.abs(next.entryHp - expectedNextEntry) <= 1e-12,
        `next-clash floor/regroup mismatch: expected ${expectedNextEntry}, got ${next.entryHp}`);
});

test("ordered re-form locks can change both rematches without rewriting a completed clash", () => {
    const blue = band("ordered-blue"), red = band("ordered-red");
    const hold = plan();
    const commanded: RitePlan = {
        ...hold,
        reforms: [
            { afterClash: 0, formation: [0, 1, 2, 3], deployment: [0, 4, 7, 8] },
            { afterClash: 1, formation: [0, 1, 2, 3], deployment: [0, 4, 6, 8] },
        ],
    };
    assert.ok(isValidRitePlan(commanded));

    let fixture: { seed: number; result: ReturnType<typeof runWarfrontRite> } | null = null;
    for (let seed = 1; seed <= 64; seed++) {
        const result = runWarfrontRite(blue, red, seed, commanded, hold);
        if (result.clashes.length === 3) { fixture = { seed, result }; break; }
    }
    assert.ok(fixture, "the fixed deterministic fixture needs a deciding clash");
    const nodesBySlot = (combatants: typeof fixture.result.clashes[number]["blue"]) =>
        Array.from({ length: RITE_BAND_SIZE }, (_, slot) => combatants.find((entry) => entry.slot === slot)?.node);
    assert.deepEqual(nodesBySlot(fixture.result.clashes[0].blue), [...WARFRONT_DEFAULT_DEPLOYMENT]);
    assert.deepEqual(nodesBySlot(fixture.result.clashes[1].blue), [0, 4, 7, 8]);
    assert.deepEqual(nodesBySlot(fixture.result.clashes[2].blue), [0, 4, 6, 8]);
    const opening = runWarfrontRite(blue, red, fixture.seed, hold, hold);
    assert.deepEqual(fixture.result.clashes[0], opening.clashes[0], "a later lock rewrote the public clash already shown");
});

test("enemy counter is frozen from public evidence and cannot read an unsealed player re-form", () => {
    const blue = band("peek-blue"), red = band("peek-red");
    const withMove = (deployment: number[]): RitePlan => ({
        ...plan(),
        reforms: [{ afterClash: 0, formation: [0, 1, 2, 3], deployment }],
    });
    const north = runWarfrontRite(blue, red, 909, withMove([0, 4, 7, 8]));
    const south = runWarfrontRite(blue, red, 909, withMove([3, 4, 7, 6]));
    assert.deepEqual(north.clashes[0], south.clashes[0]);
    const nodesBySlot = (side: "blue" | "red", result: typeof north, clashIndex: number) => {
        const combatants = result.clashes[clashIndex][side];
        return Array.from({ length: RITE_BAND_SIZE }, (_, slot) => combatants.find((entry) => entry.slot === slot)?.node);
    };
    assert.deepEqual(nodesBySlot("red", north, 1), nodesBySlot("red", south, 1), "enemy peeked at the player's unsealed cells");
    assert.notDeepEqual(nodesBySlot("blue", north, 1), nodesBySlot("blue", south, 1), "fixture did not vary the player decision");
    assert.deepEqual(north, runWarfrontRite(blue, red, 909, withMove([0, 4, 7, 8])), "counter replay is not deterministic");
});

test("tactical report facts exactly reduce the authoritative clash events", () => {
    const clash = runWarfrontRite(band("report-blue"), band("report-red"), 77, plan(), plan()).clashes[0];
    const report = riteTacticalReport(clash);
    assert.equal(report.winner, clash.winner === "blue" ? "player" : clash.winner === "red" ? "enemy" : null);

    const firstKo = clash.result.events.find((event) => event.type === "ko" && event.actorId);
    assert.ok(firstKo, "fixture needs an authoritative first knockout");
    const fallen = (firstKo.side === "player" ? clash.blue : clash.red)
        .find((combatant) => `${firstKo.side}-${combatant.lane}` === firstKo.actorId);
    assert.deepEqual(report.firstKo, fallen ? {
        team: firstKo.side,
        slot: fallen.slot,
        petId: fallen.petId,
        tick: firstKo.t,
    } : null);

    const enemyDamage = new Map<string, { damage: number; firstTick: number }>();
    for (const event of clash.result.events) {
        if (event.type !== "hit" || event.side !== "enemy" || !event.dmg || event.dmg <= 0) continue;
        const current = enemyDamage.get(event.actorId);
        if (current) current.damage += event.dmg;
        else enemyDamage.set(event.actorId, { damage: event.dmg, firstTick: event.t });
    }
    const top = [...enemyDamage.entries()]
        .sort((a, b) => b[1].damage - a[1].damage || a[1].firstTick - b[1].firstTick || a[0].localeCompare(b[0]))[0];
    const threat = top ? clash.red.find((combatant) => `enemy-${combatant.lane}` === top[0]) : null;
    assert.deepEqual(report.highestDamageThreat, top && threat ? {
        team: "enemy",
        slot: threat.slot,
        petId: threat.petId,
        damage: top[1].damage,
    } : null);
    assert.deepEqual(report.opponentFormation, clash.red.map(({ slot, petId, node }) => ({ slot, petId, node })));

    const counter = deterministicRiteCounterMove(clash, clash.winner === "blue" ? "red" : "blue");
    assert.ok(counter);
    assert.equal(counter.deployment.filter((node, slot) => node !== (counter.side === "blue" ? clash.blue : clash.red).find((entry) => entry.slot === slot)?.node).length, 1);
});
