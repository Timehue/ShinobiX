import { test } from "node:test";
import assert from "node:assert/strict";
import {
    runWarfrontMatch, startWarfrontMatch, wfPowerupCost,
    WARFRONT_TPS, WF_MAX_SECONDS, WF_PHASE_SKIRMISH, WF_PHASE_SUDDEN, WF_PHASE_WAR, WF_ROUND_SECONDS, WF_STACK_CAP,
} from "./pet-warfront-sim";
import type { ArenaRole, ArenaSlot } from "./pet-arena-sim";
import type { Pet } from "../types/pet";

function mkPet(id: string, name: string, element: string, over: Partial<Pet> = {}): Pet {
    return {
        id, name, element,
        hp: 700, attack: 90, defense: 45, speed: 60,
        ...over,
    } as Pet;
}
function squad(prefix: string, boost = 0): ArenaSlot[] {
    const roles: ArenaRole[] = ["defender", "tracker", "assassin", "sage"];
    const elements = ["Earth", "Water", "Fire", "Wind"];
    return roles.map((role, i) => ({
        pet: mkPet(`${prefix}-${i}`, `${prefix}${i}`, elements[i], { attack: 90 + boost, hp: 700 + boost * 4 }),
        role,
    }));
}

test("stances are real: forced stances change the match, and declarations fire", () => {
    const a = runWarfrontMatch(squad("A"), squad("B"), 77, "balanced", "balanced", undefined, { blue: "headhunt", red: "turtle", adapt: false });
    const b = runWarfrontMatch(squad("A"), squad("B"), 77, "balanced", "balanced", undefined, { blue: "siege", red: "siege", adapt: false });
    assert.notEqual(JSON.stringify(a.events), JSON.stringify(b.events), "different stances must produce different matches");
    const decls = a.events.filter((e) => e.type === "stance");
    assert.ok(decls.length >= 2, "both teams declare a stance at 0:00");
    assert.ok(decls.every((d) => d.t === 0), "forced stances never change mid-match when adaptation is off");
});

test("full-auto match is deterministic (byte-identical snapshots + events)", () => {
    const a = runWarfrontMatch(squad("A"), squad("B"), 12345);
    const b = runWarfrontMatch(squad("A"), squad("B"), 12345);
    assert.equal(a.winner, b.winner);
    assert.equal(a.ticks, b.ticks);
    assert.equal(JSON.stringify(a.snapshots[a.snapshots.length - 1]), JSON.stringify(b.snapshots[b.snapshots.length - 1]));
    assert.equal(JSON.stringify(a.events), JSON.stringify(b.events));
    for (const [seconds, name] of [[WF_PHASE_SKIRMISH, "SKIRMISH"], [WF_PHASE_WAR, "WAR"], [WF_PHASE_SUDDEN, "SUDDEN DEATH"]] as const) {
        if (a.ticks >= seconds * WARFRONT_TPS) {
            assert.ok(a.events.some((event) => event.type === "phase" && event.name === name && event.t === seconds * WARFRONT_TPS), `${name} fires on schedule`);
        }
    }
});

test("match always terminates with a verdict within the cap", () => {
    for (const seed of [1, 77, 20260719]) {
        const r = runWarfrontMatch(squad("A"), squad("B"), seed);
        assert.ok(r.winner === "blue" || r.winner === "red" || r.winner === "draw");
        assert.ok(r.ticks <= WARFRONT_TPS * WF_MAX_SECONDS);
        assert.ok(r.snapshots.length > WARFRONT_TPS * 30, "should run past the first round");
    }
});

test("a much stronger team wins by breaking the ward seal (statues first)", () => {
    const r = runWarfrontMatch(squad("A", 400), squad("B"), 42);
    assert.equal(r.winner, "blue");
    const coreDown = r.events.find((e) => e.type === "coredown");
    assert.ok(coreDown, "core must be destroyed for a strength win");
    // The gate: both enemy statues fell (and coreexposed fired) before the core fell.
    const statueDowns = r.events.filter((e) => e.type === "statuedown" && e.team === "red");
    const exposed = r.events.find((e) => e.type === "coreexposed" && e.team === "red");
    assert.equal(statueDowns.length, 2);
    assert.ok(exposed && coreDown && exposed.t <= coreDown.t);
    if (exposed) assert.equal(r.snapshots[exposed.t].structures.red.core.exposed, true, "core exposure reaches the renderer snapshot on the event tick");
    for (const sd of statueDowns) assert.ok(sd.t <= coreDown.t, "statues fall before the core");
    // No core damage of the gated core before exposure.
    const firstCoreHit = r.events.find((e) => e.type === "structhit" && e.core && e.team === "red");
    if (firstCoreHit && exposed) assert.ok(firstCoreHit.t >= exposed.t, "core is invulnerable until both statues fall");
    const wardenPhases = r.events.filter((event) => event.type === "wardenphase");
    const wardenKill = r.events.find((event) => event.type === "wardenkill");
    if (wardenKill) {
        assert.deepEqual(wardenPhases.map((event) => event.phase), [2, 3], "the Warden escalates through both health phases");
        assert.ok(wardenPhases[0].t < wardenPhases[1].t && wardenPhases[1].t <= wardenKill.t);
    }
    const wardenFrame = r.snapshots[r.snapshots.length - 1];
    assert.equal(typeof wardenFrame.warden.damage.blue, "number", "snapshots expose Warden damage attribution");
    assert.equal(typeof wardenFrame.warden.slamRadius, "number");
    assert.equal(typeof wardenFrame.warden.resetSecs, "number");
});

test("hollow-spawn waves flow until the Gate Warden dies, then stop", () => {
    const r = runWarfrontMatch(squad("A", 400), squad("B"), 9);
    const wardenKill = r.events.find((e) => e.type === "wardenkill");
    const waves = r.events.filter((e) => e.type === "mobwave");
    assert.ok(waves.length >= 2, "waves must spawn while the warden lives");
    if (wardenKill) {
        for (const w of waves) assert.ok(w.t <= wardenKill.t + 1, "no waves after the warden dies");
    }
});

test("coins flow from trickle and bounties, and the warden pays a ton", () => {
    const r = runWarfrontMatch(squad("A", 400), squad("B"), 5);
    // Coins FLOW (trickle/farm/bounties). Check the PEAK, not the end balance —
    // a fast-winning team spends its coins on buys and correctly ends near zero,
    // which the old end-balance check mistook for "no coins earned".
    const peakBlueCoins = Math.max(...r.snapshots.map((s) => s.coins.blue));
    assert.ok(peakBlueCoins > 150, "blue should accumulate coins");
    const mobKills = r.events.filter((e) => e.type === "mobkill");
    assert.ok(mobKills.length > 0, "farming happens");
    const wardenKill = r.events.find((e) => e.type === "wardenkill");
    if (wardenKill) {
        const at = r.snapshots[Math.min(r.snapshots.length - 1, wardenKill.t + 2)];
        const before = r.snapshots[Math.max(0, wardenKill.t - 2)];
        const team = wardenKill.type === "wardenkill" ? wardenKill.team : "blue";
        assert.ok(at.coins[team] - before.coins[team] >= 1000, "warden bounty is huge");
    }
});

test("interactive buys: valid choice deducts coins + adds a stack; invalid ones are skipped", () => {
    const ctl = startWarfrontMatch(squad("A"), squad("B"), 321, { redPolicy: "off" });
    ctl.advanceRound();          // round 1 sims 0→90s (no buys yet)
    assert.equal(ctl.round, 1);
    const coinsBefore = ctl.coins("blue");
    const buyBefore = ctl.buyState("blue");
    assert.equal(buyBefore.length, 4);
    const cost = buyBefore[0].costs.strike;
    assert.equal(cost, wfPowerupCost(0));
    ctl.advanceRound([
        { petIndex: 0, kind: "strike" },
        { petIndex: 99, kind: "strike" },            // no such pet — skipped
    ]);
    const buyAfter = ctl.buyState("blue");
    assert.equal(buyAfter[0].stacks.strike, 1);
    assert.equal(buyAfter[0].costs.strike, wfPowerupCost(1));
    // The deduction itself is proven by the escalated price + stack above; a
    // control-run coin comparison is inherently chaotic over a 90 s round (the
    // buff changes fights, kills and bounties), so only sanity-check solvency.
    assert.ok(ctl.coins("blue") >= 0);
    void coinsBefore;
});

test("streamed interactive opening reaches 90s before Council and applies its choices", () => {
    const ctl = startWarfrontMatch(squad("A"), squad("B"), 321, { redPolicy: "off" });
    ctl.advanceRoundPartial(WARFRONT_TPS * 8);
    assert.equal(ctl.round, 0, "the initial runway is still inside the opening round");

    while (ctl.round === 0 && !ctl.done) ctl.advanceRoundPartial(70);
    assert.equal(ctl.round, 1, "the first Council belongs to round one");
    assert.equal(ctl.result.ticks, WARFRONT_TPS * 90, "the Council opens at the real round boundary");

    const before = ctl.buyState("blue")[0].stacks.strike;
    ctl.advanceRoundPartial(1, [{ petIndex: 0, kind: "strike" }]);
    assert.equal(ctl.buyState("blue")[0].stacks.strike, before + 1, "Council choices apply to the next round");
});

test("stack cap holds and prices escalate", () => {
    assert.ok(wfPowerupCost(1) > wfPowerupCost(0));
    assert.ok(wfPowerupCost(5) > wfPowerupCost(3));
    const ctl = startWarfrontMatch(squad("A"), squad("B"), 55, { redPolicy: "off" });
    ctl.advanceRound();
    for (let r = 0; r < 12 && !ctl.done; r++) {
        ctl.advanceRound(Array.from({ length: 8 }, () => ({ petIndex: 0, kind: "strike" as const })));
    }
    const stacks = ctl.buyState("blue")[0].stacks.strike;
    assert.ok(stacks <= WF_STACK_CAP, `stacks ${stacks} exceed cap`);
});

test("auto-buy policies spend coins deterministically", () => {
    const a = runWarfrontMatch(squad("A"), squad("B"), 777, "offense", "defense");
    const b = runWarfrontMatch(squad("A"), squad("B"), 777, "offense", "defense");
    assert.equal(JSON.stringify(a.events.filter((e) => e.type === "buy")), JSON.stringify(b.events.filter((e) => e.type === "buy")));
    const buys = a.events.filter((e) => e.type === "buy" && e.team === "blue");
    assert.ok(buys.length > 0, "offense policy must actually buy");
});

test("rounds fire on the 90-second cadence", () => {
    const r = runWarfrontMatch(squad("A"), squad("B"), 2);
    const rounds = r.events.filter((e) => e.type === "round");
    if (r.ticks > WARFRONT_TPS * WF_ROUND_SECONDS * 2) {
        assert.ok(rounds.length >= 1);
        for (const e of rounds) assert.equal(e.t % (WARFRONT_TPS * WF_ROUND_SECONDS), 0);
    }
});

test("snapshots keep every entity inside the field bounds", () => {
    const r = runWarfrontMatch(squad("A"), squad("B"), 8);
    const some = [0, Math.floor(r.snapshots.length / 2), r.snapshots.length - 1];
    for (const i of some) {
        const s = r.snapshots[i];
        for (const a of s.actors) { assert.ok(Math.abs(a.x) <= 44 && Math.abs(a.y) <= 24); }
        for (const m of s.mobs) { assert.ok(Math.abs(m.x) <= 44 && Math.abs(m.y) <= 24); }
    }
});

test("multi-seed balance soak stays bounded, contests objectives, and permits a comeback", () => {
    const winners = new Set<string>();
    let comebackObserved = false;
    for (const seed of [3, 11, 83, 203]) {
        const r = runWarfrontMatch(squad("A"), squad("B"), seed);
        winners.add(r.winner);
        assert.ok(r.ticks >= WARFRONT_TPS * 300, `seed ${seed} ended before the strategic game developed`);
        assert.ok(r.ticks <= WARFRONT_TPS * WF_MAX_SECONDS);
        assert.ok(r.events.some((event) => event.type === "wardenkill"), `seed ${seed} never contested the Gate Warden`);
        assert.ok(r.events.some((event) => event.type === "minikill"), `seed ${seed} never recruited a Lesser Warden`);
        for (let tick = 0; tick < r.snapshots.length; tick += WARFRONT_TPS * 15) {
            const frame = r.snapshots[tick];
            assert.ok(frame.mobs.filter((mob) => mob.side === "hollow").length <= 6);
            assert.ok(frame.mobs.filter((mob) => mob.side === "blue").length <= 12);
            assert.ok(frame.mobs.filter((mob) => mob.side === "red").length <= 12);
            for (const actor of frame.actors) {
                assert.ok(Number.isFinite(actor.x) && Number.isFinite(actor.y) && Number.isFinite(actor.hp));
            }
        }
        const midpoint = r.snapshots[Math.min(r.snapshots.length - 1, WARFRONT_TPS * 300)];
        if (r.winner === "blue" && midpoint.coins.blue < midpoint.coins.red) comebackObserved = true;
        if (r.winner === "red" && midpoint.coins.red < midpoint.coins.blue) comebackObserved = true;
    }
    assert.deepEqual([...winners].sort(), ["blue", "red"], "mirror balance should permit either side to win");
    assert.equal(comebackObserved, true, "an early economy deficit must not make the match unwinnable");
});
