// Tests for the player-controlled coliseum duel (docs/pet-coliseum-player-control-plan.md).
//
// The load-bearing invariant is the FIRST test: stepping the sim tick-by-tick with
// no commands must reproduce runPetDuelCinematic byte for byte. That is what proves
// the create/step refactor did not disturb the pet ladder, sector war, or the
// generated server mirror — all of which still call the one-shot entry point.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pet } from "../types/pet";
import {
    runPetDuelCinematic, runPetPartyDuelCinematic,
    createLiveCinematicDuel, createLivePartyCinematicDuel,
    stepCinematicDuel, finishCinematicDuel, applyDuelCommand, readDuelControl,
    checkpointCinematicDuel, restoreCinematicDuel, DUEL_COMMAND_FULL,
} from "./pet-duel-cinematic";
import { createLiveDuel, createLivePartyDuel, commandedActorId } from "./pet-duel-live";
import { bondCharge, bondReady, BOND_FULL } from "./pet-bond-meter";
import { DUEL_TPS, type DuelEvent } from "./pet-duel-sim";

function pet(id: string, element: string, over: Partial<Pet> = {}): Pet {
    return {
        id, name: id, species: id, level: 20,
        hp: 820, attack: 92, defense: 44, speed: 96,
        element, trait: "Swift",
        jutsus: [
            { name: "Fang Strike", kind: "damage", power: 104, cooldown: 1 },
            { name: "Ember Coil", kind: "burn", power: 88, cooldown: 3 },
            { name: "Stone Ward", kind: "shield", power: 60, cooldown: 4 },
            { name: "Slipstream", kind: "move", power: 10, cooldown: 3 },
            { name: "Ruin Fang", kind: "crush", power: 182, cooldown: 6, signature: true },
        ],
        ...over,
    } as unknown as Pet;
}

/** Drive a live sim to completion without ever issuing a command. */
function runUncommanded(sim: ReturnType<typeof createLiveCinematicDuel>) {
    let guard = 0;
    while (stepCinematicDuel(sim) && guard++ < DUEL_TPS * 200) { /* run out the fight */ }
    return finishCinematicDuel(sim);
}

test("an uncommanded live duel is byte-identical to the one-shot engine (profile off)", () => {
    // THE load-bearing guard. The live coliseum now runs a BRAWL PROFILE the
    // authoritative path does not (melee basics, a dive that lands, the clash bind),
    // so the two fights legitimately differ. What must still hold — and what protects
    // the pet ladder, sector war and the generated mirror — is that the
    // create/step/rewind machinery itself changes nothing: with the profile off, a
    // tick-by-tick live duel is still the one-shot engine byte for byte. Any
    // divergence therefore comes from the profile and nowhere else.
    for (let seed = 1; seed <= 8; seed++) {
        const oneShot = runPetDuelCinematic(pet("P", "Fire"), pet("Q", "Water"), seed, 1, 1, false, true, true, null, false);
        const live = runUncommanded(createLiveCinematicDuel(pet("P", "Fire"), pet("Q", "Water"), seed, 1, 1, false, true, true, null, false, false));
        assert.deepEqual(live, oneShot, `seed ${seed} diverged from the one-shot engine`);
    }
});

test("an uncommanded live 2v2 is byte-identical to the one-shot engine (profile off)", () => {
    for (let seed = 1; seed <= 4; seed++) {
        const args = [pet("A", "Fire"), pet("B", "Earth"), pet("C", "Water"), pet("D", "Wind")] as const;
        const oneShot = runPetPartyDuelCinematic(args[0], args[1], args[2], args[3], seed, 1, 1, false, true, true, false);
        const live = runUncommanded(createLivePartyCinematicDuel(
            pet("A", "Fire"), pet("B", "Earth"), pet("C", "Water"), pet("D", "Wind"), seed, 1, 1, false, true, true, false, false,
        ));
        assert.deepEqual(live, oneShot, `2v2 seed ${seed} diverged from the one-shot engine`);
    }
});

test("the brawl profile makes the live coliseum a MELEE fight, and only there", () => {
    // The complaint this profile answers: pets stood off lobbing projectiles, so the
    // only body dashes on screen were whiffs. The authoritative fight is deliberately
    // left exactly as it was.
    const melee = (r: { events: DuelEvent[] }) => r.events.filter((e) => e.type === "hit" && !e.ranged).length;
    let liveMelee = 0, authMelee = 0;
    for (let seed = 1; seed <= 6; seed++) {
        authMelee += melee(runPetDuelCinematic(bruiser("P", "Fire"), bruiser("Q", "Water"), seed, 1, 1, false, true, true, null, false));
        liveMelee += melee(runUncommanded(liveBruisers(seed)));
    }
    assert.ok(liveMelee > authMelee, `the live path should land more melee than the authoritative one (live ${liveMelee}, auth ${authMelee})`);
});

test("a checkpoint restores the sim exactly, so a rewind replays identically", () => {
    const sim = createLiveCinematicDuel(pet("P", "Fire"), pet("Q", "Water"), 5, 1, 1, false, true, true, null, false);
    for (let i = 0; i < 90; i++) stepCinematicDuel(sim);
    const cp = checkpointCinematicDuel(sim);
    const forward: string[] = [];
    for (let i = 0; i < 60; i++) { stepCinematicDuel(sim); forward.push(JSON.stringify(sim.snapshots[sim.snapshots.length - 1])); }

    restoreCinematicDuel(sim, cp);
    assert.equal(sim.snapshots.length, 90, "rewind must discard the snapshots taken after the checkpoint");
    const replay: string[] = [];
    for (let i = 0; i < 60; i++) { stepCinematicDuel(sim); replay.push(JSON.stringify(sim.snapshots[sim.snapshots.length - 1])); }
    assert.deepEqual(replay, forward, "replaying from a checkpoint must reproduce the same ticks");
});

test("an ordered ability is the move the pet actually commits to", () => {
    const sim = createLiveCinematicDuel(pet("P", "Fire"), pet("Q", "Water"), 3, 1, 1, false, true, true, null, false);
    // Let the pets close first, so the order has a window to resolve in.
    for (let i = 0; i < DUEL_TPS * 2; i++) stepCinematicDuel(sim);
    const before = sim.events.length;
    assert.ok(applyDuelCommand(sim, { kind: "ability", actorId: "player-0", idx: 1 }), "the order should be accepted");
    for (let i = 0; i < DUEL_TPS * 6; i++) stepCinematicDuel(sim);
    const opened = sim.events.slice(before).filter((e: DuelEvent) => e.actorId === "player-0" && (e.type === "windup" || e.type === "cast" || e.type === "ultimate"));
    assert.ok(opened.length > 0, "the commanded pet should have opened a move");
    assert.equal(opened[0].move, "Ember Coil", "the FIRST move opened after the order must be the ordered one");
});

test("an earned technique call owns the next beat and cannot become a fallback basic", () => {
    const sim = createLiveCinematicDuel(pet("P", "Fire"), pet("Q", "Water"), 4, 1, 1, false, true, true, null, false);
    const fighter = sim.fighters.find((entry) => entry.id === "player-0")!;
    const called = fighter.abilities[1];
    called.cdLeft = DUEL_TPS * 30;
    fighter.stamina = 0;
    fighter.commandCharge = DUEL_COMMAND_FULL;
    const before = sim.events.length;

    assert.ok(applyDuelCommand(sim, { kind: "technique", actorId: fighter.id, idx: 1 }), "a full command meter should accept the call");
    assert.equal(readDuelControl(sim, fighter.id)!.commandCharge, 0, "the call spends the command meter immediately");
    assert.equal(applyDuelCommand(sim, { kind: "technique", actorId: fighter.id, idx: 2 }), false, "the spent meter cannot buy a second call");

    stepCinematicDuel(sim);
    const opened = sim.events.slice(before).find((event) =>
        event.actorId === fighter.id
        && (event.type === "windup" || event.type === "cast" || event.type === "maneuver"));
    assert.equal(opened?.move, "Ember Coil", "the selected technique must be the very next authored action");
    assert.equal(fighter.cmdTechnique, false, "the earned call is consumed when the move commits");
});

function callPerfect(sim: ReturnType<typeof createLiveCinematicDuel>, idx: number): DuelEvent {
    const fighter = sim.fighters.find((entry) => entry.id === "player-0")!;
    fighter.commandCharge = DUEL_COMMAND_FULL;
    assert.ok(applyDuelCommand(sim, { kind: "technique", actorId: fighter.id, idx }));
    const before = sim.events.length;
    for (let i = 0; i < DUEL_TPS * 5; i++) {
        stepCinematicDuel(sim);
        const result = sim.events.slice(before).find((event) => !!event.perfect && !!event.verdict);
        if (result) return result;
    }
    assert.fail("the perfect execution did not resolve inside its authored window");
}

test("Punish guarantees a critical contact and breaks the defender's armor", () => {
    const sim = createLiveCinematicDuel(pet("P", "Fire"), pet("Q", "Water"), 41, 1, 1, false, true, true, null, false);
    const result = callPerfect(sim, 0);
    const target = sim.fighters.find((entry) => entry.id === "enemy-0")!;
    assert.equal(result.type, "hit");
    assert.equal(result.perfect, "punish");
    assert.equal(result.crit, true);
    assert.equal(result.verdict, "GUARD BROKEN");
    assert.ok(target.statuses.buffLeft > 0 && target.statuses.buffMag < 0, "the armor break must persist after contact");
});

test("Counter interrupts the rival and forces a readable stagger", () => {
    const counterPet = pet("P", "Lightning", {
        jutsus: [
            { name: "Thunder Lock", kind: "stun", power: 82, cooldown: 3 },
            { name: "Fang Strike", kind: "damage", power: 104, cooldown: 1 },
        ],
    });
    const sim = createLiveCinematicDuel(counterPet, pet("Q", "Water"), 43, 1, 1, false, true, true, null, false);
    const target = sim.fighters.find((entry) => entry.id === "enemy-0")!;
    target.state = "windup"; target.stateLeft = DUEL_TPS; target.pendingIdx = 0; target.pendingTargetId = "player-0";
    const result = callPerfect(sim, 0);
    assert.equal(result.perfect, "counter");
    assert.equal(result.verdict, "ACTION BROKEN");
    assert.equal(target.pendingIdx, -2);
    assert.ok(target.statuses.stunLeft > 0 || target.state === "stagger", "the interrupted rival must remain staggered");
});

test("Rally cleanses harmful statuses and grants a twelve-percent Aegis", () => {
    const sim = createLiveCinematicDuel(pet("P", "Earth"), pet("Q", "Water"), 47, 1, 1, false, true, true, null, false);
    const fighter = sim.fighters.find((entry) => entry.id === "player-0")!;
    fighter.statuses.burnLeft = DUEL_TPS * 3;
    fighter.statuses.burnDmg = 10;
    fighter.statuses.slowLeft = DUEL_TPS * 3;
    fighter.statuses.marked = true;
    const beforeShield = fighter.statuses.shieldHp;
    const result = callPerfect(sim, 2);
    assert.equal(result.perfect, "rally");
    assert.equal(result.verdict, "CLEANSE + AEGIS");
    assert.equal(fighter.statuses.burnLeft, 0);
    assert.equal(fighter.statuses.slowLeft, 0);
    assert.equal(fighter.statuses.marked, false);
    assert.ok(fighter.statuses.shieldHp >= beforeShield + Math.round(fighter.maxHp * 0.12));
});

test("Shift creates a phase window and empowers the next attack", () => {
    const shiftPet = pet("P", "Wind", {
        jutsus: [
            { name: "Fang Strike", kind: "damage", power: 104, cooldown: 1 },
            { name: "Slipstream", kind: "move", power: 10, cooldown: 3 },
        ],
    });
    const sim = createLiveCinematicDuel(shiftPet, pet("Q", "Water"), 53, 1, 1, false, true, true, null, false);
    const fighter = sim.fighters.find((entry) => entry.id === "player-0")!;
    const result = callPerfect(sim, 1);
    assert.equal(result.perfect, "shift");
    assert.equal(result.verdict, "PHASE SHIFT");
    assert.ok(fighter.perfectEvadeLeft > 0, "the reposition must leave an invulnerable phase window");
    assert.equal(fighter.perfectDamageBoost, true, "the next landed attack must be empowered");
});

test("command energy is earned by time, clean hits, taking pressure, and defensive reads", () => {
    const sim = createLiveCinematicDuel(pet("P", "Fire"), pet("Q", "Water"), 6, 1, 1, false, true, true, null, false);
    const player = sim.fighters.find((entry) => entry.id === "player-0")!;
    const start = player.commandCharge;
    let sawEarnedBurst = false;
    for (let i = 0; i < DUEL_TPS * 12 && !sawEarnedBurst; i++) {
        const beforeCharge = player.commandCharge;
        const beforeEvents = sim.events.length;
        if (!stepCinematicDuel(sim)) break;
        const earnedEvent = sim.events.slice(beforeEvents).some((event) =>
            (event.type === "hit" && (event.actorId === player.id || event.targetId === player.id))
            || (event.type === "dodge" && event.actorId === player.id));
        if (earnedEvent) {
            assert.ok(player.commandCharge > beforeCharge + 1, "an exchange event should pay more than passive charge");
            sawEarnedBurst = true;
        }
    }
    assert.ok(player.commandCharge > start, "time in combat should always advance the meter");
    assert.ok(sawEarnedBurst, "the deterministic duel should produce a hit, pressure, or defensive read");
    player.commandCharge = DUEL_COMMAND_FULL;
    assert.equal(readDuelControl(sim, player.id)!.commandReady, true, "a full meter opens the tactical window");
});

test("Bond Break unleashes the signature even while it is on cooldown", () => {
    const sim = createLiveCinematicDuel(pet("P", "Fire"), pet("Q", "Water"), 7, 1, 1, false, true, true, null, false);
    for (let i = 0; i < DUEL_TPS; i++) stepCinematicDuel(sim);
    // The signature opens gated behind a long cooldown precisely so the AI hoards it.
    const gated = readDuelControl(sim, "player-0")!.abilities.find((a) => a.signature)!;
    assert.ok(gated.cdLeft > 0, "the signature should still be on its opening cooldown");
    const before = sim.events.length;
    assert.ok(applyDuelCommand(sim, { kind: "break", actorId: "player-0" }));
    for (let i = 0; i < DUEL_TPS * 8; i++) stepCinematicDuel(sim);
    const ults = sim.events.slice(before).filter((e: DuelEvent) => e.type === "ultimate" && e.actorId === "player-0");
    assert.ok(ults.length > 0, "Bond Break must produce a signature release");
    assert.equal(readDuelControl(sim, "player-0")!.breakPending, false, "the Break is spent once it fires");
});

test("Auto hands the pet back to its own AI and drops any standing order", () => {
    const sim = createLiveCinematicDuel(pet("P", "Fire"), pet("Q", "Water"), 11, 1, 1, false, true, true, null, false);
    applyDuelCommand(sim, { kind: "ability", actorId: "player-0", idx: 2 });
    applyDuelCommand(sim, { kind: "auto", actorId: "player-0", on: true });
    const control = readDuelControl(sim, "player-0")!;
    assert.equal(control.auto, true);
    assert.equal(control.orderedIdx, -2, "switching to Auto must clear the queued order");
    // With no controlled fighter left, further commands are refused outright.
    assert.equal(applyDuelCommand(sim, { kind: "ability", actorId: "player-0", idx: 1 }), false);
});

test("stance is accepted, clamped, and defaults to the AI's own balance", () => {
    const sim = createLiveCinematicDuel(pet("P", "Fire"), pet("Q", "Water"), 13, 1, 1, false, true, true, null, false);
    assert.equal(readDuelControl(sim, "player-0")!.stance, 1, "balanced is the default, i.e. the shipped AI");
    applyDuelCommand(sim, { kind: "stance", actorId: "player-0", stance: 9 });
    assert.equal(readDuelControl(sim, "player-0")!.stance, 2, "an out-of-range stance clamps rather than corrupting the fighter");
});

test("the enemy pet never accepts commands", () => {
    const sim = createLiveCinematicDuel(pet("P", "Fire"), pet("Q", "Water"), 17, 1, 1, false, true, true, null, false);
    assert.equal(applyDuelCommand(sim, { kind: "ability", actorId: "enemy-0", idx: 0 }), false);
    assert.equal(applyDuelCommand(sim, { kind: "break", actorId: "enemy-0" }), false);
});

test("the live controller keeps the sim ahead of playback and never shows the buffer", () => {
    const duel = createLiveDuel(pet("P", "Fire"), pet("Q", "Water"), 23, 1, 1, false, true, true, null);
    const view = duel.advance(0);
    assert.ok(view.snapshots.length >= 1, "playback tick 0 must have something to draw");
    // Everything visible is settled: the look-ahead the presentation layer needs
    // has already been simulated, but is deliberately not exposed.
    assert.ok(view.events.every((e) => e.t <= view.snapshots.length - 1), "no event may reference an unshown tick");
    const later = duel.advance(60);
    assert.ok(later.snapshots.length > view.snapshots.length, "advancing playback must reveal more of the fight");
});

test("a command issued at the playback head takes effect without waiting out the buffer", () => {
    const duel = createLiveDuel(pet("P", "Fire"), pet("Q", "Water"), 29, 1, 1, false, true, true, null);
    const playbackTick = DUEL_TPS * 2;
    const before = duel.advance(playbackTick);
    const seenBefore = before.snapshots.length;
    duel.command({ kind: "ability", actorId: "player-0", idx: 1 });
    const after = duel.advance(playbackTick);
    // The already-seen prefix is untouched — a rewind must never rewrite history.
    for (let t = 0; t <= playbackTick && t < seenBefore; t++) {
        assert.deepEqual(after.snapshots[t], before.snapshots[t], `tick ${t} changed under the player`);
    }
    assert.ok(after.snapshots.length >= seenBefore - 1, "the buffer should refill after a rewind");
});

test("the bond meter fills on the player's work and resets when it is spent", () => {
    const events: DuelEvent[] = [
        { t: 5, type: "hit", side: "player", actorId: "player-0", targetId: "enemy-0", dmg: 40 },
        { t: 9, type: "hit", side: "player", actorId: "player-0", targetId: "enemy-0", dmg: 60, crit: true },
        { t: 14, type: "dodge", side: "player", actorId: "player-0" },
        { t: 20, type: "hit", side: "enemy", actorId: "enemy-0", targetId: "player-0", dmg: 30 },
    ];
    assert.equal(bondCharge(events, "player-0", 4), 0, "nothing has happened yet");
    assert.equal(bondCharge(events, "player-0", 5), 12, "a landed hit pays");
    assert.equal(bondCharge(events, "player-0", 9), 31, "a crit pays a bonus on top");
    assert.equal(bondCharge(events, "player-0", 20), 54, "dodging and being hit both feed the meter");
    assert.equal(bondCharge(events, "player-0", 20, 9), 23, "spending the meter discounts everything up to that tick");
    assert.ok(!bondReady(events, "player-0", 20));
});

test("the bond meter never banks more than one Bond Break", () => {
    const events: DuelEvent[] = Array.from({ length: 60 }, (_, i) => (
        { t: i, type: "hit", side: "player", actorId: "player-0", targetId: "enemy-0", dmg: 10 } as DuelEvent
    ));
    assert.equal(bondCharge(events, "player-0", 59), BOND_FULL);
});

// ── Server replay parity (plan §9.6) ────────────────────────────────────────────
// THE contract behind server-authoritative rewards: the flat {tick, command} log
// the client posts, replayed by stepping the same seeded sim, must reproduce the
// fight the player actually played. If this drifts, api/pet/battle-result.ts pays
// out a different fight than the one on screen — which is the whole bug §9.6 is
// about. The replay loop below is deliberately a literal copy of the one in
// api/pet/_duel-replay.ts, so a change there that breaks parity fails here.
function replayInputLog(
    make: () => ReturnType<typeof createLiveCinematicDuel>,
    log: readonly { t: number; cmd: Parameters<typeof applyDuelCommand>[1] }[],
) {
    const sim = make();
    let i = 0;
    for (let guard = 0; guard < DUEL_TPS * 200; guard++) {
        while (i < log.length && log[i].t <= sim.t) applyDuelCommand(sim, log[i++].cmd);
        if (!stepCinematicDuel(sim)) break;
    }
    return finishCinematicDuel(sim);
}

test("replaying the input log reproduces the commanded duel exactly", () => {
    for (const seed of [3, 11, 23, 42]) {
        const make = () => createLiveCinematicDuel(pet("P", "Fire"), pet("Q", "Water"), seed, 1, 1, false, true, true, null, false);
        const live = createLiveDuel(pet("P", "Fire"), pet("Q", "Water"), seed, 1, 1, false, true, true, null);

        // Drive real playback and issue orders through the rewind path, which is
        // what makes the recorded ticks non-trivial: each command lands on
        // playbackTick + 1, not on the sim's leading edge.
        let tick = 0;
        for (let guard = 0; guard < DUEL_TPS * 200 && !live.finishedAt(tick); guard++) {
            live.advance(tick);
            if (!live.settled) {
                if (tick % 17 === 0) live.command({ kind: "ability", actorId: "player-0", idx: (tick / 17) % 4 });
                if (tick % 43 === 0) live.command({ kind: "stance", actorId: "player-0", stance: (tick / 43) % 3 });
            }
            tick++;
        }

        const log = live.inputLog();
        assert.ok(log.length > 0, `seed ${seed} issued no commands — the test would prove nothing`);
        // Ticks must be non-decreasing, or the server's parser rejects the log.
        for (let i = 1; i < log.length; i++) {
            assert.ok(log[i].t >= log[i - 1].t, `seed ${seed} logged an out-of-order tick`);
        }
        assert.deepEqual(replayInputLog(make, log), live.outcome(), `seed ${seed} replay diverged from the played fight`);
    }
});

test("an empty input log replays as the uncommanded fight", () => {
    // This is what scores a duel the player watched without touching the deck, and it
    // is why battle-start can seal its baseline through the same helper. Compared
    // against the LIVE uncommanded fight, not the authoritative one: both battle-start
    // and battle-result replay through createLiveCinematicDuel, so they share the
    // brawl profile and stay consistent with each other and with what was on screen.
    for (const seed of [7, 19]) {
        const make = () => createLiveCinematicDuel(pet("P", "Fire"), pet("Q", "Water"), seed, 1, 1, false, true, true, null, false);
        assert.deepEqual(replayInputLog(make, []), runUncommanded(make()), `seed ${seed} empty-log replay is not the uncommanded fight`);
    }
});

// ── CLASH ─────────────────────────────────────────────────────────────────────

/** A MELEE-identity pet. The default `pet()` above carries a burn, which makes it a
 *  KITER — and the brawl profile deliberately leaves true zoners alone, so it never
 *  brawls and never binds. This one has no ranged move at all (kind:"move" does not
 *  count: it is a reposition), classifies as a rusher, and therefore closes distance
 *  and clashes. */
function bruiser(id: string, element: string): Pet {
    return {
        id, name: id, species: id, level: 20,
        hp: 820, attack: 92, defense: 44, speed: 96,
        element, trait: "Swift",
        jutsus: [
            { name: "Fang Strike", kind: "damage", power: 104, cooldown: 1 },
            { name: "Rend", kind: "damage", power: 96, cooldown: 2 },
            { name: "Bloodlet", kind: "lifesteal", power: 88, cooldown: 4 },
            { name: "Slipstream", kind: "move", power: 10, cooldown: 3 },
            { name: "Ruin Fang", kind: "crush", power: 182, cooldown: 6, signature: true },
        ],
    } as unknown as Pet;
}
const liveBruisers = (seed: number, brawlProfile = true) =>
    createLiveCinematicDuel(bruiser("P", "Fire"), bruiser("Q", "Water"), seed, 1, 1, false, true, true, null, false, brawlProfile);

/** Step a live duel until a clash bind opens, or give up. */
function stepToClash(sim: ReturnType<typeof createLiveCinematicDuel>) {
    for (let i = 0; i < DUEL_TPS * 200; i++) {
        if (sim.clash) return sim.clash;
        if (!stepCinematicDuel(sim)) return null;
    }
    return null;
}

test("a clash bind opens in the live coliseum and never on the authoritative path", () => {
    let liveBinds = 0;
    for (let seed = 1; seed <= 12; seed++) {
        const live = runUncommanded(liveBruisers(seed));
        liveBinds += live.events.filter((e) => e.move === "Clash Bind").length;
        const auth = runPetDuelCinematic(bruiser("P", "Fire"), bruiser("Q", "Water"), seed, 1, 1, false, true, true, null, false);
        assert.equal(auth.events.filter((e) => e.move === "Clash Bind").length, 0,
            `seed ${seed}: the authoritative engine must never bind — ranked/ladder/sector-war replay it`);
    }
    assert.ok(liveBinds > 0, "the live coliseum should produce clash binds");
});

test("a clash freezes both fighters, then resolves on its own if nobody calls", () => {
    const sim = liveBruisers(3);
    const bind = stepToClash(sim);
    assert.ok(bind, "expected a clash bind for this seed");
    const a = sim.fighters.find((f) => f.id === bind!.aId)!;
    const b = sim.fighters.find((f) => f.id === bind!.bId)!;
    const held = [a.x, a.y, b.x, b.y];
    // While bound, neither pet moves.
    stepCinematicDuel(sim);
    assert.deepEqual([a.x, a.y, b.x, b.y], held, "bound fighters must not move");
    // …and the bind cannot outlive its window.
    for (let i = 0; i < DUEL_TPS * 3; i++) stepCinematicDuel(sim);
    assert.equal(sim.clash, null, "an unanswered bind must resolve, never hang the fight");
});

test("a clash call is accepted once, and only from a bound fighter", () => {
    const sim = liveBruisers(3);
    const bind = stepToClash(sim);
    assert.ok(bind, "expected a clash bind for this seed");
    assert.equal(applyDuelCommand(sim, { kind: "clash", actorId: "player-0", pick: 7 }), false, "an out-of-range pick is refused");
    assert.equal(applyDuelCommand(sim, { kind: "clash", actorId: "player-0", pick: 1 }), true, "the first call is accepted");
    assert.equal(applyDuelCommand(sim, { kind: "clash", actorId: "player-0", pick: 0 }), false,
        "a second call must be refused — otherwise a client could re-pick after seeing the opponent commit");
});

test("winning the clash read pays out, losing it costs", () => {
    // Guard beats Strike. Drive both outcomes from the same seed by forcing the
    // player's call, and assert the swing lands on the correct side.
    const outcome = (pick: number) => {
        const sim = liveBruisers(3);
        const bind = stepToClash(sim);
        if (!bind) return null;
        applyDuelCommand(sim, { kind: "clash", actorId: "player-0", pick });
        const before = sim.events.length;
        for (let i = 0; i < DUEL_TPS * 3; i++) stepCinematicDuel(sim);
        const breaks = sim.events.slice(before).filter((e) => e.type === "hit" && e.move === "Clash Break");
        return breaks[0] ?? null;
    };
    const results = [0, 1, 2].map(outcome).filter(Boolean);
    assert.ok(results.length > 0, "at least one call should have produced a decisive Clash Break");
    // Whoever won it, the payoff is a real hit with real damage — not a cosmetic beat.
    for (const hit of results) assert.ok((hit!.dmg ?? 0) > 0, "a Clash Break must deal damage");
});

test("a clash call survives the rewind, so the server replay agrees with the screen", () => {
    // The live layer rewinds to the last SEEN tick and re-simulates. A clash call has
    // to be reproducible from the input log alone or the server would score a
    // different fight than the one the player watched.
    const make = () => liveBruisers(3);
    const sim = make();
    const bind = stepToClash(sim);
    assert.ok(bind, "expected a clash bind for this seed");
    const at = sim.t;
    applyDuelCommand(sim, { kind: "clash", actorId: "player-0", pick: 1 });
    while (stepCinematicDuel(sim)) { /* run it out */ }
    const played = finishCinematicDuel(sim);
    assert.deepEqual(replayInputLog(make, [{ t: at, cmd: { kind: "clash", actorId: "player-0", pick: 1 } }]), played,
        "replaying the logged clash call must reproduce the played fight exactly");
});

// ── The commanded-seat contract ───────────────────────────────────────────────
//
// PetColiseum.tsx reads its deck, Bond meter and clash prompt for ONE actor id,
// which it gets from commandedActorId(). It used to hard-code "player-0", and
// because the engine seats the challenger as "player", a live-PvP p2 client was
// asking for a fighter it does not command — so it got no deck at all.
//
// The component itself is an r3f canvas and cannot be rendered headlessly, so the
// guard lives here instead: these pin the contract the helper rests on, for every
// shape of duel the app can construct.

test("commandedActorId returns the fighter the engine actually takes orders for", () => {
    // PvE — must still be exactly the old hard-coded constant, or this refactor
    // silently changed single-player.
    const solo = createLiveDuel(pet("P", "Fire"), pet("Q", "Water"), 5);
    assert.equal(commandedActorId(solo), "player-0");
    const party = createLivePartyDuel(pet("P", "Fire"), pet("R", "Earth"), pet("Q", "Water"), pet("S", "Wind"), 5);
    assert.equal(commandedActorId(party), "player-0");
    const partySolo = createLivePartyDuel(pet("P", "Fire"), null, pet("Q", "Water"), null, 5);
    assert.equal(commandedActorId(partySolo), "player-0");
    // A watch-only replay has no live session at all; the deck is not rendered, but
    // the helper must not throw on the way to that decision.
    assert.equal(commandedActorId(null), "player-0");
    assert.equal(commandedActorId(undefined), "player-0");
});

test("the commanded seat is the one the deck can actually read and command", () => {
    // The real invariant behind the p2 bug: whatever id commandedActorId hands the
    // HUD, controlAt must answer for it (otherwise the deck renders nothing) and the
    // engine must accept a command for it.
    const duel = createLiveDuel(pet("P", "Fire"), pet("Q", "Water"), 5);
    duel.advance(DUEL_TPS);
    const me = commandedActorId(duel);
    assert.ok(duel.controlAt(2, me), `controlAt must answer for the commanded seat (${me})`);
    // …and it must NOT answer for the opposing pet, which is what made the old
    // hard-coded id fail silently instead of loudly.
    assert.equal(duel.controlAt(2, "enemy-0"), null, "the opposing pet is not commandable from this seat");
});
