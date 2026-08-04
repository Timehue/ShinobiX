import { test } from "node:test";
import assert from "node:assert/strict";
import { DUEL_COVER_NODES, petCinematicTraitCombat, runPetDuelCinematic, runPetPartyDuelCinematic } from "./pet-duel-cinematic";
import { DUEL_TPS } from "./pet-duel-sim";
import { balanceBuiltInPetTemplate } from "./pet-balance";
import { rawPetPool } from "../data/pet-pool";
import type { Pet, PetJutsu } from "../types/pet";

const j = (o: Partial<PetJutsu>): PetJutsu => ({ name: "m", power: 90, cooldown: 2, currentCooldown: 0, kind: "damage", ...o } as PetJutsu);
const mk = (o: Partial<Pet>): Pet => ({
    id: "x", name: "x", rarity: "rare", level: 20, xp: 0, maxLevel: 100,
    hp: 1000, attack: 100, defense: 50, speed: 90, element: "None",
    jutsus: [j({ name: "Strike", kind: "damage", power: 100 }), j({ name: "Bolt", kind: "burn", power: 90 })],
    ...o,
} as Pet);

const SEEDS = [1, 7, 42, 2024, 99999];

test("cinematic Coliseum exposes the exact Shrine apex combat packages", () => {
    assert.deepEqual(petCinematicTraitCombat("Fateweaver"), {
        critBonus: 0.16, dodgeChance: 0.18, damageMult: 1, drainPct: 0, immuneFreezeConfuse: true,
    });
    assert.deepEqual(petCinematicTraitCombat("Hollowborn"), {
        critBonus: 0.16, dodgeChance: 0, damageMult: 1.12, drainPct: 0.12, immuneFreezeConfuse: false,
    });
    assert.deepEqual(petCinematicTraitCombat("Boonbringer"), {
        critBonus: 0, dodgeChance: 0, damageMult: 1, drainPct: 0, immuneFreezeConfuse: false,
    });
    assert.deepEqual(petCinematicTraitCombat("Lucky"), {
        critBonus: 0, dodgeChance: 0, damageMult: 1, drainPct: 0, immuneFreezeConfuse: false,
    });
});

test("cinematic 1v1 is deterministic — same pets + seed → byte-identical result", () => {
    for (const seed of SEEDS) {
        const a = runPetDuelCinematic(mk({ id: "a", element: "Fire" }), mk({ id: "b", element: "Water", speed: 120 }), seed);
        const b = runPetDuelCinematic(mk({ id: "a", element: "Fire" }), mk({ id: "b", element: "Water", speed: 120 }), seed);
        assert.deepEqual(a, b, `seed ${seed} diverged`);
    }
});

test("cinematic 2v2 is deterministic", () => {
    for (const seed of SEEDS) {
        const run = () => runPetPartyDuelCinematic(
            mk({ id: "pl", element: "Fire" }), mk({ id: "pr", element: "Water", subRole: "kite" }),
            mk({ id: "el", element: "Wind" }), mk({ id: "er", element: "Earth" }), seed);
        assert.deepEqual(run(), run(), `2v2 seed ${seed} diverged`);
    }
});

test("cinematic fights are valid, finite, terminating, and mostly decisive KOs", () => {
    let ko = 0, n = 0;
    for (const seed of SEEDS) {
        const r = runPetDuelCinematic(mk({ id: "a", attack: 110 }), mk({ id: "b", element: "Wind" }), seed);
        n++;
        assert.ok(["win", "loss", "draw"].includes(r.result));
        assert.ok(r.ticks >= 1 && r.ticks <= DUEL_TPS * 75, `ticks out of range ${r.ticks}`);
        assert.ok(r.snapshots.length === r.ticks, "one snapshot per tick");
        for (const s of r.snapshots) for (const ac of s.actors) {
            assert.ok(Number.isFinite(ac.x) && Number.isFinite(ac.y), "non-finite position");
            assert.ok(ac.hp >= 0 && ac.hp <= ac.maxHp + 1, "hp out of range");
        }
        if (r.events.some((e) => e.type === "ko")) ko++;
    }
    assert.ok(ko >= n - 1, `expected nearly all fights to KO (${ko}/${n})`);
});

test("cinematic — a clearly stronger pet wins from either side", () => {
    const strong = mk({ id: "s", hp: 1400, attack: 170, defense: 90, speed: 120 });
    const weak = mk({ id: "w", hp: 480, attack: 45, defense: 25, speed: 55 });
    for (const seed of SEEDS) {
        assert.equal(runPetDuelCinematic(strong, weak, seed).result, "win", `strong should win as player (seed ${seed})`);
        assert.equal(runPetDuelCinematic(weak, strong, seed).result, "loss", `strong should win as enemy (seed ${seed})`);
    }
});

test("cinematic — the type-advantaged element wins more (elements matter)", () => {
    // Fire beats Wind; identical stats otherwise → the countering side should win a
    // clear majority (advantage is meaningful; the exact rate is a tunable knob).
    let fireWins = 0, total = 0;
    for (const seed of SEEDS) {
        if (runPetDuelCinematic(mk({ id: "a", element: "Fire" }), mk({ id: "b", element: "Wind" }), seed).result === "win") fireWins++;
        total++;
    }
    assert.ok(fireWins > total / 2, `Fire (beats Wind) should win the majority — got ${fireWins}/${total}`);
});

test("cinematic choreography uses open-field range shifts, self buffs, and no attack-dash train", () => {
    const ember = mk({
        id: "starter-fire", name: "Ember Wolf", element: "Fire", hp: 540, attack: 145, speed: 95,
        jutsus: [
            j({ name: "Cinder Volley", kind: "burn", power: 86, cooldown: 2 }),
            j({ name: "Flame Burst", kind: "push", power: 112, cooldown: 4, signature: true }),
            j({ name: "Blazing Focus", kind: "buff", power: 58, cooldown: 5 }),
            j({ name: "Cinder Flash", kind: "move", power: 1, cooldown: 3 }),
        ],
    });
    const selkie = mk({
        id: "starter-water", name: "Tidal Selkie", element: "Water", hp: 580, attack: 140, speed: 80,
        jutsus: [
            j({ name: "Tidal Crash", kind: "push", power: 106, cooldown: 3, signature: true }),
            j({ name: "Tide Ward", kind: "barrier", power: 58, cooldown: 4 }),
            j({ name: "Flow State", kind: "haste", power: 54, cooldown: 5 }),
            j({ name: "Riptide Shift", kind: "move", power: 1, cooldown: 3 }),
        ],
    });
    const duel = runPetDuelCinematic(ember, selkie, 20260601);
    const distances = duel.snapshots.map((snapshot) => {
        const a = snapshot.actors.find((actor) => actor.id === "player-0")!;
        const b = snapshot.actors.find((actor) => actor.id === "enemy-0")!;
        return Math.hypot(a.x - b.x, a.y - b.y);
    });
    const distanceSpan = Math.max(...distances) - Math.min(...distances);
    let closeRun = 0, longestCloseRun = 0, breakaways = 0, breakawayArmed = false;
    for (const distance of distances) {
        closeRun = distance < 2.5 ? closeRun + 1 : 0;
        longestCloseRun = Math.max(longestCloseRun, closeRun);
        if (distance < 3) breakawayArmed = true;
        else if (breakawayArmed && distance > 5.5) { breakaways += 1; breakawayArmed = false; }
    }
    const ys = duel.snapshots.flatMap((snapshot) => snapshot.actors.map((actor) => actor.y));
    const xs = duel.snapshots.flatMap((snapshot) => snapshot.actors.map((actor) => actor.x));
    const lateralSpan = Math.max(...ys) - Math.min(...ys);
    const crossfieldSpan = Math.max(...xs) - Math.min(...xs);
    const evades = duel.events.filter((event) => event.type === "dodge" && event.move === "Evade").length;
    const mobilityMoves = duel.events.filter((event) => event.type === "maneuver" && event.kind === "move");
    const selfBuffs = duel.events.filter((event) => event.type === "buff" && event.actorId === event.targetId);
    const dodgeBuffChains = duel.events.filter((event) => event.type === "dodge" && event.move === "Evade").flatMap((dodge) => {
        const buff = selfBuffs.find((candidate) => candidate.actorId === dodge.actorId
            && candidate.t > dodge.t && candidate.t - dodge.t <= Math.round(DUEL_TPS * 1.5));
        return buff ? [{ dodge, buff }] : [];
    });
    const ultimates = duel.events.filter((event) => event.type === "ultimate");
    const dashIns = duel.events.filter((event) => event.type === "dash");
    const shiftDeltas = mobilityMoves.map((event) => {
        const before = distances[Math.min(distances.length - 1, event.t)];
        const after = distances[Math.min(distances.length - 1, event.t + Math.round(DUEL_TPS * 0.72))];
        return after - before;
    });
    const buffDistances = selfBuffs.map((event) => distances[Math.min(distances.length - 1, event.t)]);
    let tailRun = 0, longestTailRun = 0;
    let activeMovementTicks = 0, simultaneousMovementTicks = 0, dualMovementRun = 0, longestDualMovementRun = 0;
    for (let tick = 1; tick < duel.snapshots.length; tick++) {
        const prevA = duel.snapshots[tick - 1].actors.find((actor) => actor.id === "player-0")!;
        const prevB = duel.snapshots[tick - 1].actors.find((actor) => actor.id === "enemy-0")!;
        const currA = duel.snapshots[tick].actors.find((actor) => actor.id === "player-0")!;
        const currB = duel.snapshots[tick].actors.find((actor) => actor.id === "enemy-0")!;
        const avx = currA.x - prevA.x, avy = currA.y - prevA.y;
        const bvx = currB.x - prevB.x, bvy = currB.y - prevB.y;
        const aSpeed = Math.hypot(avx, avy), bSpeed = Math.hypot(bvx, bvy);
        if (aSpeed > 0.015 || bSpeed > 0.015) activeMovementTicks++;
        if (aSpeed > 0.015 && bSpeed > 0.015) {
            simultaneousMovementTicks++;
            longestDualMovementRun = Math.max(longestDualMovementRun, ++dualMovementRun);
        } else dualMovementRun = 0;
        const separation = Math.hypot(currB.x - currA.x, currB.y - currA.y);
        let train = false;
        if (aSpeed > 0.015 && bSpeed > 0.015 && separation > 2.5) {
            const alignment = (avx * bvx + avy * bvy) / (aSpeed * bSpeed);
            const averageX = avx / aSpeed + bvx / bSpeed;
            const averageY = avy / aSpeed + bvy / bSpeed;
            const averageLength = Math.max(1e-4, Math.hypot(averageX, averageY));
            const lineAlignment = Math.abs(((currB.x - currA.x) * averageX + (currB.y - currA.y) * averageY)
                / (separation * averageLength));
            train = alignment > 0.88 && lineAlignment > 0.78;
        }
        tailRun = train ? tailRun + 1 : 0;
        longestTailRun = Math.max(longestTailRun, tailRun);
    }
    const movementCadence = ["player-0", "enemy-0"].map((id) => {
        let movingTicks = 0, plantedRun = 0, longestPlantedRun = 0;
        for (let tick = 1; tick < duel.snapshots.length; tick++) {
            const prev = duel.snapshots[tick - 1].actors.find((actor) => actor.id === id)!;
            const curr = duel.snapshots[tick].actors.find((actor) => actor.id === id)!;
            if (Math.hypot(curr.x - prev.x, curr.y - prev.y) > 0.015) {
                movingTicks++;
                plantedRun = 0;
            } else {
                longestPlantedRun = Math.max(longestPlantedRun, ++plantedRun);
            }
        }
        const visitedZones = new Set(duel.snapshots.map((snapshot) => {
            const actor = snapshot.actors.find((candidate) => candidate.id === id)!;
            return `${Math.floor((actor.x + 14) / 4)}/${Math.floor((actor.y + 7.5) / 3)}`;
        })).size;
        const actorPath = duel.snapshots.map((snapshot) => snapshot.actors.find((candidate) => candidate.id === id)!);
        const outerLaneTicks = actorPath.filter((actor) => Math.abs(actor.x) >= 9 || Math.abs(actor.y) >= 5.2).length;
        return { movingRatio: movingTicks / Math.max(1, duel.snapshots.length - 1), longestPlantedRun, visitedZones, outerLaneTicks };
    });

    assert.ok(longestCloseRun < DUEL_TPS * 1.5, `fighters stayed crowded for ${longestCloseRun} ticks`);
    assert.ok(breakaways >= 1, `expected at least one decisive wide exchange exit, got ${breakaways}`);
    assert.ok(distanceSpan >= 4.5, `expected attack distance to expand and contract, got a ${distanceSpan} span`);
    assert.ok(lateralSpan >= 7, `expected broad lateral repositioning, got ${lateralSpan}`);
    assert.ok(crossfieldSpan >= 10, `expected corner-to-corner arena use, got ${crossfieldSpan}`);
    assert.ok(evades >= 1 && evades <= 12, `expected readable but fallible dodges, got ${evades}`);
    assert.ok(dodgeBuffChains.some(({ dodge, buff }) => distances[buff.t] - distances[dodge.t] >= 2),
        `expected dodge -> retreat -> buff to open at least 2 units of space, got ${dodgeBuffChains.map(({ dodge, buff }) => distances[buff.t] - distances[dodge.t]).join(", ")}`);
    assert.equal(dashIns.length, 0, `expected dash-in choreography removed, got ${dashIns.length} dash events`);
    assert.ok(mobilityMoves.length >= 4, `expected repeated tactical range-shift bursts, got ${mobilityMoves.length}`);
    assert.ok(shiftDeltas.some((delta) => delta > 0.8) && shiftDeltas.some((delta) => delta < -0.8), `expected both outward and inward bursts, got ${shiftDeltas.join(", ")}`);
    assert.ok(new Set(selfBuffs.map((event) => event.actorId)).size === 2, `expected both pets to disengage and self-buff, got ${selfBuffs.length} buff events`);
    assert.ok(buffDistances.every((distance) => distance >= 5), `expected buffs outside the threat pocket, got distances ${buffDistances.join(", ")}`);
    assert.ok(ultimates.length >= 2, `expected both sides to unleash big signature VFX, got ${ultimates.length} ultimates`);
    assert.equal(DUEL_COVER_NODES.length, 0, "cinematic floor should have no permanent collision props");
    assert.ok(longestTailRun < DUEL_TPS * 1.5, `fighters formed a leader/follower train for ${longestTailRun} ticks`);
    assert.ok(movementCadence.every(({ movingRatio }) => movingRatio >= 0.25 && movingRatio <= 0.55), `expected movement to come in committed 25-55% bursts, got ${movementCadence.map((it) => it.movingRatio).join(", ")}`);
    assert.ok(simultaneousMovementTicks / Math.max(1, activeMovementTicks) <= 0.35, `expected alternating pressure instead of mirrored movement, got ${simultaneousMovementTicks}/${activeMovementTicks} active ticks moving together`);
    assert.ok(longestDualMovementRun < DUEL_TPS * 1.1, `expected a defender to plant instead of following; both moved for ${longestDualMovementRun} consecutive ticks`);
    assert.ok(movementCadence.every(({ longestPlantedRun }) => longestPlantedRun >= DUEL_TPS * 0.3), `expected deliberate planted guard beats, got ${movementCadence.map((it) => it.longestPlantedRun).join(", ")} ticks`);
    assert.ok(movementCadence.every(({ visitedZones }) => visitedZones >= 10), `expected both pets to use at least 10 arena zones, got ${movementCadence.map((it) => it.visitedZones).join(", ")}`);
    assert.ok(movementCadence.every(({ outerLaneTicks }) => outerLaneTicks >= DUEL_TPS * 2), `expected sustained outer-ring runs, got ${movementCadence.map((it) => it.outerLaneTicks).join(", ")} ticks`);
});

test("Eclipse Kitsune alternates pressure beats instead of orbiting or following", () => {
    const rawKitsune = rawPetPool.find((pet) => pet.id === "mythic-0");
    assert.ok(rawKitsune, "Eclipse Kitsune must exist in the production roster");
    const base = balanceBuiltInPetTemplate(rawKitsune);
    const kitsune = {
        ...base,
        hp: 520,
        attack: Math.max(150, base.attack ?? 0),
        speed: Math.max(88, base.speed ?? 0),
        jutsus: base.jutsus.map((move) => ({ ...move, currentCooldown: 0 })),
    };
    const selkie = mk({
        id: "starter-water", name: "Tidal Selkie", element: "Water", hp: 520, attack: 160, speed: 84,
        jutsus: [
            j({ name: "Riptide Fang", kind: "damage", power: 82, cooldown: 1 }),
            j({ name: "Tidal Crash", kind: "push", power: 106, cooldown: 3, signature: true }),
            j({ name: "Flow State", kind: "haste", power: 54, cooldown: 5 }),
            j({ name: "Riptide Shift", kind: "move", power: 1, cooldown: 3 }),
        ],
    });
    const duel = runPetDuelCinematic(kitsune, selkie, 20260601);
    let activeTicks = 0, simultaneousTicks = 0, followRun = 0, longestFollowRun = 0;
    let orbitRun = 0, longestOrbitRun = 0;
    const moving = new Map<string, number>([["player-0", 0], ["enemy-0", 0]]);
    for (let tick = 1; tick < duel.snapshots.length; tick++) {
        const prev = duel.snapshots[tick - 1].actors;
        const curr = duel.snapshots[tick].actors;
        const pa = prev.find((actor) => actor.id === "player-0")!;
        const pb = prev.find((actor) => actor.id === "enemy-0")!;
        const a = curr.find((actor) => actor.id === "player-0")!;
        const b = curr.find((actor) => actor.id === "enemy-0")!;
        const avx = a.x - pa.x, avy = a.y - pa.y, bvx = b.x - pb.x, bvy = b.y - pb.y;
        const as = Math.hypot(avx, avy), bs = Math.hypot(bvx, bvy);
        if (as > 0.015) moving.set("player-0", moving.get("player-0")! + 1);
        if (bs > 0.015) moving.set("enemy-0", moving.get("enemy-0")! + 1);
        if (as > 0.015 || bs > 0.015) activeTicks++;
        if (as <= 0.015 || bs <= 0.015) { followRun = 0; orbitRun = 0; continue; }
        simultaneousTicks++;
        const alignment = (avx * bvx + avy * bvy) / (as * bs);
        const oldGap = Math.hypot(pa.x - pb.x, pa.y - pb.y);
        const newGap = Math.hypot(a.x - b.x, a.y - b.y);
        followRun = alignment > 0.78 && Math.abs(newGap - oldGap) < 0.1 ? followRun + 1 : 0;
        longestFollowRun = Math.max(longestFollowRun, followRun);
        const oldRx = pa.x - pb.x, oldRy = pa.y - pb.y, newRx = a.x - b.x, newRy = a.y - b.y;
        const angularStep = Math.abs(oldRx * newRy - oldRy * newRx) / Math.max(0.001, oldGap * newGap);
        orbitRun = Math.abs(newGap - oldGap) < 0.1 && angularStep > 0.006 ? orbitRun + 1 : 0;
        longestOrbitRun = Math.max(longestOrbitRun, orbitRun);
    }
    const total = Math.max(1, duel.snapshots.length - 1);
    assert.ok([...moving.values()].every((ticks) => ticks / total >= 0.17 && ticks / total <= 0.58), `expected committed movement bursts, got ${[...moving.values()].map((ticks) => ticks / total).join(", ")}`);
    assert.ok(simultaneousTicks / Math.max(1, activeTicks) <= 0.35, `expected one pressure runner at a time, got ${simultaneousTicks}/${activeTicks} simultaneous active ticks`);
    assert.ok(longestFollowRun < DUEL_TPS * 0.8, `Kitsune formed a follow train for ${longestFollowRun} ticks`);
    assert.ok(longestOrbitRun < DUEL_TPS * 0.8, `Kitsune orbited at a stable radius for ${longestOrbitRun} ticks`);
    const kitsuneHits = duel.events.filter((event) => event.type === "hit" && event.actorId === "player-0");
    assert.ok(kitsuneHits.length > 0, `Kitsune should visibly engage, not only disengage; events=${JSON.stringify(Object.fromEntries([...new Set(duel.events.map((event) => event.type))].map((type) => [type, { player: duel.events.filter((event) => event.type === type && event.actorId === "player-0").length, enemy: duel.events.filter((event) => event.type === type && event.actorId === "enemy-0").length }])))}`);
});

test("single-life 1v1 restores the full durability bar and ends on one knockout", () => {
    const strong = mk({ id: "strong", hp: 1400, attack: 170, defense: 90, speed: 120, element: "Fire" });
    const weak = mk({ id: "weak", hp: 480, attack: 45, defense: 25, speed: 55, element: "Wind" });
    const duel = runPetDuelCinematic(strong, weak, 1, 1, 1, false, false);
    const kos = duel.events.filter((event) => event.type === "ko" && event.actorId === "enemy-0");

    assert.equal(duel.result, "win");
    assert.equal(kos.length, 1, "the first KO must decide a 1v1");
    assert.equal(duel.snapshots[0].actors.find((actor) => actor.id === "enemy-0")!.maxHp, weak.hp * 3, "single-life HP should use the restored 3x cinematic durability budget");
    assert.ok(!duel.events.map((event) => String(event.type)).includes("respawn"));
    const final = duel.snapshots.at(-1)!.actors.find((candidate) => candidate.id === "enemy-0")!;
    assert.equal(final.hp, 0);
    assert.equal(final.state, "dead");
});

test("single-life 2v2 ends after each opposing pet is knocked out once", () => {
    const strong = (id: string) => mk({ id, hp: 1200, attack: 150, defense: 80, speed: 110 });
    const weak = (id: string) => mk({ id, hp: 420, attack: 42, defense: 20, speed: 50 });
    const duel = runPetPartyDuelCinematic(strong("p0"), strong("p1"), weak("e0"), weak("e1"), 77);
    assert.equal(duel.result, "win");
    for (const id of ["enemy-0", "enemy-1"]) {
        assert.equal(duel.events.filter((event) => event.type === "ko" && event.actorId === id).length, 1);
        assert.equal(duel.snapshots.at(-1)!.actors.find((actor) => actor.id === id)!.hp, 0);
    }
    assert.ok(duel.snapshots.at(-1)!.actors.some((actor) => actor.team === "player" && actor.hp > 0));
});

test("developer AI trace explains intent without bloating normal replay snapshots", () => {
    const player = mk({ id: "trace-fire", element: "Fire", role: "assassin" });
    const enemy = mk({ id: "trace-water", element: "Water", role: "defender", jutsus: [j({ name: "Ward", kind: "barrier", power: 70 }), j({ name: "Tide", kind: "slow", power: 85 })] });
    const normal = runPetDuelCinematic(player, enemy, 42);
    const traced = runPetDuelCinematic(player, enemy, 42, 1, 1, false, true, undefined, null, true);
    assert.ok(normal.snapshots.every((snapshot) => snapshot.actors.every((actor) => actor.ai == null)));
    assert.deepEqual(
        normal.snapshots.map((snapshot) => snapshot.actors.map(({ ai: _ai, ...actor }) => actor)),
        traced.snapshots.map((snapshot) => snapshot.actors.map(({ ai: _ai, ...actor }) => actor)),
        "debug observability must never alter combat",
    );
    const trace = traced.snapshots.flatMap((snapshot) => snapshot.actors.map((actor) => actor.ai!));
    assert.ok(trace.every((ai) => ai.state && ai.plan && ai.reason && Number.isFinite(ai.desiredRange)));
    assert.ok(trace.some((ai) => ai.path && ai.path.length > 1), "trace exposes committed movement paths");
    assert.ok(trace.some((ai) => ai.cooldownPriorities?.length), "trace exposes cooldown priorities");
    assert.ok(trace.some((ai) => ai.elementalSetup?.toLowerCase().includes("burn")), "trace explains elemental setup state");
    assert.ok(new Set(trace.map((ai) => ai.state)).size >= 4, "fight should expose several distinct decision states");
});

test("2v2 target decisions use commitment windows instead of switching every tick", () => {
    const support = mk({ id: "support", role: "sage", subRole: "support", jutsus: [j({ name: "Mend", kind: "heal", power: 100 }), j({ name: "Pulse", kind: "damage", power: 80 })] });
    const duel = runPetPartyDuelCinematic(
        mk({ id: "assassin", role: "assassin" }), support,
        mk({ id: "defender", role: "defender" }), mk({ id: "tracker", role: "tracker" }),
        42, 1, 1, false, true, undefined, true,
    );
    for (const actorId of ["player-0", "player-1", "enemy-0", "enemy-1"]) {
        let previous: string | null = null;
        let lastLiveSwitch = -Infinity;
        for (const snapshot of duel.snapshots) {
            const actor = snapshot.actors.find((candidate) => candidate.id === actorId)!;
            const target = actor.ai?.targetId ?? null;
            if (previous && target && target !== previous) {
                const oldTarget = snapshot.actors.find((candidate) => candidate.id === previous);
                if (oldTarget && oldTarget.hp > 0) {
                    assert.ok(snapshot.t - lastLiveSwitch >= Math.round(DUEL_TPS * 1.3), `${actorId} changed live targets too quickly`);
                    lastLiveSwitch = snapshot.t;
                }
            }
            if (target) {
                const actorSlot = Number(actorId.split("-").at(-1));
                const laneRival = snapshot.actors.find((candidate) => candidate.team !== actor.team
                    && Number(candidate.id.split("-").at(-1)) === actorSlot);
                if (laneRival && laneRival.hp > 0) {
                    assert.equal(target, laneRival.id, `${actorId} should finish its readable lane matchup before rotating`);
                }
            }
            previous = target;
        }
    }
    let allyPairTicks = 0, clumpedTicks = 0, livingActorTicks = 0, routeTicks = 0;
    for (const snapshot of duel.snapshots) {
        const living = snapshot.actors.filter((actor) => actor.hp > 0);
        for (const actor of living) {
            livingActorTicks++;
            if (actor.ai?.state === "reposition") routeTicks++;
        }
        for (const side of ["player", "enemy"] as const) {
            const allies = living.filter((actor) => actor.team === side);
            if (allies.length < 2) continue;
            allyPairTicks++;
            if (Math.hypot(allies[0].x - allies[1].x, allies[0].y - allies[1].y) < 4) clumpedTicks++;
        }
    }
    assert.ok(clumpedTicks / Math.max(1, allyPairTicks) < 0.1, `allies shared one unreadable pocket for ${clumpedTicks}/${allyPairTicks} paired ticks`);
    assert.ok(routeTicks / Math.max(1, livingActorTicks) < 0.3, `party pets spent ${routeTicks}/${livingActorTicks} living actor-ticks on full routes`);
});

test("a knocked-out pet never re-enters the fight", () => {
    const duel = runPetPartyDuelCinematic(
        mk({ id: "lead", hp: 1300, attack: 150, speed: 110 }), mk({ id: "ally", hp: 1200, attack: 135 }),
        mk({ id: "fragile", hp: 360, attack: 45, speed: 55 }), mk({ id: "anchor", hp: 1200, defense: 75 }),
        9, 1, 1, false, true, undefined, true,
    );
    const firstKo = duel.events.find((event) => event.type === "ko");
    assert.ok(firstKo, "fixture should produce a knockout");
    const later = duel.snapshots.slice(firstKo.t).map((snapshot) => snapshot.actors.find((actor) => actor.id === firstKo.actorId)!);
    assert.ok(later.every((actor) => actor.hp === 0 && actor.state === "dead"), "a knockout must remain terminal");
    assert.ok(!duel.events.map((event) => String(event.type)).includes("respawn"));
});

test("elemental self-payoffs and 2v2 cross-element chains resolve as explicit readable events", () => {
    const fireSolo = mk({
        id: "fire-solo", element: "Fire", attack: 140,
        jutsus: [j({ name: "Ignite", kind: "burn", power: 120, cooldown: 1 }), j({ name: "Burst", kind: "push", power: 100, cooldown: 1 })],
    });
    const solo = runPetDuelCinematic(fireSolo, mk({ id: "solo-target", element: "Earth", hp: 720 }), 13);
    assert.ok(solo.events.some((event) => event.combo === "Inferno Pressure"), "Fire should pay off its own Burn setup");

    const fire = mk({ id: "fire", element: "Fire", attack: 140, speed: 100, jutsus: [j({ name: "Ignite Field", kind: "burn", power: 120, cooldown: 1, aoe: true })] });
    const wind = mk({ id: "wind", element: "Wind", attack: 140, speed: 100, jutsus: [j({ name: "Gale Burst", kind: "push", power: 115, cooldown: 1, aoe: true })] });
    const party = runPetPartyDuelCinematic(fire, wind, mk({ id: "earth", element: "Earth", hp: 700 }), mk({ id: "water", element: "Water", hp: 700 }), 17);
    assert.ok(party.events.some((event) => event.actorId === "player-1" && event.combo === "Firestorm Chain"), "Wind should extend its ally's Fire setup");
});

test("a solo Support remains a complete 1v1 fighter", () => {
    const support = mk({
        id: "support", role: "sage", subRole: "support", element: "Water", hp: 850, attack: 105, defense: 65,
        jutsus: [
            j({ name: "Mend", kind: "heal", power: 110, cooldown: 4 }),
            j({ name: "Ward", kind: "shield", power: 75, cooldown: 4 }),
            j({ name: "Undertow", kind: "slow", power: 110, cooldown: 2 }),
        ],
    });
    const foe = mk({ id: "foe", element: "Fire", hp: 650, attack: 75, defense: 40, speed: 80 });
    for (const seed of [1, 7, 42]) {
        const duel = runPetDuelCinematic(support, foe, seed);
        assert.equal(duel.result, "win", `solo support should remain viable at seed ${seed}`);
        assert.ok(duel.events.some((event) => event.actorId === "player-0" && ["shield", "hit", "cast"].includes(event.type)), "support must create its own combat flow");
    }
});

test("temporary barrier obstacles cause a route change without trapping either fighter", () => {
    const earth = mk({
        id: "earth-wall", element: "Earth", role: "defender", hp: 900, defense: 80,
        jutsus: [j({ name: "Wall", kind: "barrier", power: 90, cooldown: 2 }), j({ name: "Crush", kind: "crush", power: 100, cooldown: 2 }), j({ name: "Pivot", kind: "move", power: 1, cooldown: 3 })],
    });
    const duel = runPetDuelCinematic(earth, mk({ id: "fire", element: "Fire", attack: 130 }), 12, 1, 1, false, true, undefined, null, true);
    const barrier = duel.events.find((event) => event.type === "shield" && event.kind === "barrier");
    assert.ok(barrier, "fixture must raise a temporary line-of-sight wall");
    const start = duel.snapshots[barrier.t].actors.find((actor) => actor.id === "enemy-0")!;
    const end = Math.min(duel.snapshots.length - 1, barrier.t + DUEL_TPS * 4);
    const moved = duel.snapshots.slice(barrier.t + 1, end + 1).some((snapshot) => {
        const actor = snapshot.actors.find((candidate) => candidate.id === "enemy-0")!;
        return Math.hypot(actor.x - start.x, actor.y - start.y) > 2.5;
    });
    assert.ok(moved, "opponent should wrap or change lanes around the barrier");
    assert.ok(duel.events.some((event) => event.type === "hit" && event.t > barrier.t && event.t <= barrier.t + DUEL_TPS * 6), "combat should resume after pathing around the wall");
});

test("ranged and melee roles use distinct spacing, while melee can close and land", () => {
    const kiter = mk({
        id: "kiter", role: "tracker", subRole: "kite", element: "Wind",
        jutsus: [j({ name: "Gale", kind: "push", power: 105, cooldown: 2 }), j({ name: "Slow", kind: "slow", power: 90, cooldown: 3 }), j({ name: "Shift", kind: "move", power: 1, cooldown: 3 })],
    });
    const melee = mk({
        id: "melee", role: "assassin", subRole: "assassin", element: "Fire", speed: 110, attack: 125,
        jutsus: [j({ name: "Crush", kind: "crush", power: 110, cooldown: 2 }), j({ name: "Flash", kind: "move", power: 1, cooldown: 3 })],
    });
    const duel = runPetDuelCinematic(kiter, melee, 91, 1, 1, false, true, undefined, null, true);
    const meanRange = (id: string) => duel.snapshots.reduce((sum, snapshot) => sum + (snapshot.actors.find((actor) => actor.id === id)?.ai?.desiredRange ?? 0), 0) / duel.snapshots.length;
    const meleeHits = duel.events.filter((event) => event.actorId === "enemy-0" && event.type === "hit");
    assert.ok(meanRange("player-0") - meanRange("enemy-0") > 3, "kiter must hold a visibly wider preferred range");
    assert.ok(meleeHits.length >= 3, `melee pet must bridge spacing repeatedly; got ${meleeHits.length} hits at ticks ${meleeHits.map((event) => event.t).join(", ")}`);
    assert.ok(duel.snapshots.some((snapshot) => snapshot.actors.find((actor) => actor.id === "player-0")?.ai?.state === "kite" || (snapshot.actors.find((actor) => actor.id === "player-0")?.ai?.desiredRange ?? 0) > 6));
});

test("disadvantaged AI retreats and the advantaged pursuer recognizes burst windows", () => {
    const strong = mk({ id: "strong", hp: 1100, attack: 140, speed: 105, element: "Fire", role: "assassin" });
    const weak = mk({ id: "weak", hp: 650, attack: 75, speed: 75, element: "Wind", role: "sage", subRole: "support", jutsus: [j({ name: "Mend", kind: "heal", power: 100, cooldown: 4 }), j({ name: "Slow", kind: "slow", power: 90, cooldown: 2 })] });
    const duel = runPetDuelCinematic(strong, weak, 55, 1, 1, false, true, undefined, null, true);
    assert.ok(duel.snapshots.some((snapshot) => snapshot.actors.find((actor) => actor.id === "enemy-0")?.ai?.state === "retreat"));
    assert.ok(duel.snapshots.some((snapshot) => snapshot.actors.find((actor) => actor.id === "player-0")?.ai?.state === "burst"));
});

test("cooldowns prevent random ability spam and replay consumption is frame-rate independent", () => {
    const duel = runPetDuelCinematic(mk({ id: "a", element: "Lightning" }), mk({ id: "b", element: "Water" }), 2026);
    const lastByMove = new Map<string, number>();
    for (const event of duel.events) {
        // Count the start of each action. Offensive `cast` is the projectile-release
        // half of a preceding windup/ultimate, while support `cast` is its start.
        const supportCast = event.type === "cast" && ["heal", "buff", "shield", "barrier", "absorb", "haste"].includes(event.kind ?? "");
        if (!event.move || !["windup", "ultimate"].includes(event.type) && !supportCast) continue;
        const key = `${event.actorId}/${event.move}`;
        const previous = lastByMove.get(key);
        if (previous != null) assert.ok(event.t - previous >= Math.round(DUEL_TPS * 0.75), `${key} repeated too quickly`);
        lastByMove.set(key, event.t);
    }
    assert.ok(duel.events.filter((event) => event.type === "ultimate").length / (duel.ticks / DUEL_TPS) < 0.3, "marquee effects should remain special rather than continuous");

    const consumeAt = (fps: number) => {
        let terminal = duel.snapshots[0];
        for (let frame = 0; frame / fps <= duel.ticks / DUEL_TPS + 1 / fps; frame++) {
            terminal = duel.snapshots[Math.min(duel.snapshots.length - 1, Math.floor((frame / fps) * DUEL_TPS))];
        }
        return terminal.actors.map(({ id, hp, state }) => ({ id, hp, state }));
    };
    assert.deepEqual(consumeAt(30), consumeAt(60));
    assert.deepEqual(consumeAt(60), consumeAt(144));
});
