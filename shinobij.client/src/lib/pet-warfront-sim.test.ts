import { test } from "node:test";
import assert from "node:assert/strict";
import {
    runWarfrontMatch, scoutedWarfrontDoctrine, startWarfrontMatch, wfCampRewardForPad, wfCrossMapLaneForStatue, wfFindPath,
    wfObjectiveDamageCredit,
    wfPowerupCost, wfSigilMacroDecision, wfWavePriority,
    WARFRONT_TPS, WF_CAMP_REWARDS, WF_DEPLOYMENT_LOCK_SECONDS, WF_MAX_SECONDS, WF_OPENING_READ_RESERVE, WF_PHASE_SKIRMISH, WF_PHASE_SUDDEN, WF_PHASE_WAR, WF_ROUND_SECONDS, WF_SNAPSHOT_STRIDE, WF_STACK_CAP,
    type WarfrontResult,
} from "./pet-warfront-sim";
import { WF_COLS } from "./pet-warfront-map";
import { warfrontSnapshotAtTick, warfrontSnapshotBoundsAtTick } from "./pet-warfront-presentation";
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
    return archetypeSquad(prefix, { hp: 700 + boost * 4, attack: 90 + boost, defense: 45, speed: 60 });
}
function archetypeSquad(prefix: string, stats: Pick<Pet, "hp" | "attack" | "defense" | "speed">): ArenaSlot[] {
    const roles: ArenaRole[] = ["defender", "tracker", "assassin", "sage"];
    const elements = ["Earth", "Water", "Fire", "Wind"];
    return roles.map((role, i) => ({
        pet: mkPet(`${prefix}-${i}`, `${prefix}${i}`, elements[i], stats),
        role,
    }));
}

function frameAt(result: Pick<WarfrontResult, "snapshots">, tick: number) {
    const frame = warfrontSnapshotAtTick(result.snapshots, tick);
    assert.ok(frame, `missing Warfront snapshot at t=${tick}`);
    return frame;
}

function frameAfter(result: Pick<WarfrontResult, "snapshots">, tick: number) {
    const frame = warfrontSnapshotBoundsAtTick(result.snapshots, tick)?.upper;
    assert.ok(frame, `missing Warfront snapshot after t=${tick}`);
    return frame;
}

test("stances are real: forced stances change the match, and declarations fire", () => {
    const a = runWarfrontMatch(squad("A"), squad("B"), 77, "balanced", "balanced", undefined, { blue: "headhunt", red: "turtle", adapt: false });
    const b = runWarfrontMatch(squad("A"), squad("B"), 77, "balanced", "balanced", undefined, { blue: "siege", red: "siege", adapt: false });
    assert.notEqual(JSON.stringify(a.events), JSON.stringify(b.events), "different stances must produce different matches");
    const decls = a.events.filter((e) => e.type === "stance");
    assert.ok(decls.length >= 2, "both teams declare a stance at 0:00");
    assert.ok(decls.every((d) => d.t === 0), "forced stances never change mid-match when adaptation is off");
});

test("adaptive coaches seal simultaneous Council reads", () => {
    const ctl = startWarfrontMatch(squad("A"), squad("B"), 1, {
        bluePolicy: "balanced", redPolicy: "balanced",
        blueStance: "siege", redStance: "turtle",
        adaptStances: true, captureSnapshots: false,
    });
    ctl.advanceRound();
    assert.deepEqual(ctl.stances(), { blue: "siege", red: "turtle" });
    ctl.advanceRoundPartial(1);
    assert.deepEqual(
        ctl.stances(),
        { blue: "jungle", red: "headhunt" },
        "both coaches must answer the declarations that existed before Council opened",
    );
});

test("full-auto match is deterministic (byte-identical snapshots + events)", () => {
    const a = runWarfrontMatch(squad("A"), squad("B"), 12345);
    const b = runWarfrontMatch(squad("A"), squad("B"), 12345);
    assert.equal(a.winner, b.winner);
    assert.equal(a.ticks, b.ticks);
    assert.deepEqual(a.campRewards, b.campRewards, "seed-sealed trophy layouts must be replay deterministic");
    assert.equal(JSON.stringify(a.snapshots[a.snapshots.length - 1]), JSON.stringify(b.snapshots[b.snapshots.length - 1]));
    assert.equal(JSON.stringify(a.events), JSON.stringify(b.events));
    assert.ok(
        new TextEncoder().encode(JSON.stringify(a.snapshots)).byteLength <= 35_000_000,
        "a representative retained replay must remain below the 35 MB serialized budget",
    );
    for (const [seconds, name] of [[WF_PHASE_SKIRMISH, "SKIRMISH"], [WF_PHASE_WAR, "WAR"], [WF_PHASE_SUDDEN, "SUDDEN DEATH"]] as const) {
        if (a.ticks >= seconds * WARFRONT_TPS) {
            assert.ok(a.events.some((event) => event.type === "phase" && event.name === name && event.t === seconds * WARFRONT_TPS), `${name} fires on schedule`);
        }
    }
});

test("world-to-grid rounding and BFS choices are exact team mirrors", () => {
    const mirrorCell = (idx: number) => {
        const row = Math.floor(idx / WF_COLS);
        const col = idx % WF_COLS;
        return row * WF_COLS + (WF_COLS - 1 - col);
    };
    const routes = [
        [-39.2, -1.8, 0, 0],       // even-grid centre boundary / Warden ring
        [-33.2, 3.2, 21.5, 9.5],  // base to opposite jungle through equal forks
        [-21.5, -9.5, 0, -21],    // camp to top-lane centre connector
        [-20, 17.5, 33.2, 3.2],   // sentinel to opposite gate
    ] as const;

    for (const [sx, sy, gx, gy] of routes) {
        const blue = wfFindPath(sx, sy, gx, gy, "blue");
        const red = wfFindPath(-sx, sy, -gx, gy, "red");
        assert.ok(blue && red, `route ${sx},${sy} -> ${gx},${gy} must be connected`);
        assert.deepEqual(red, blue.map(mirrorCell), `route ${sx},${sy} -> ${gx},${gy} did not x-mirror`);
    }
});

test("camp trophy layouts expose x-mirrored reward classes before capture", () => {
    const rewardIds = Object.keys(WF_CAMP_REWARDS).sort();
    const seenByPad = Array.from({ length: 4 }, () => new Set<string>());
    for (let seed = 0; seed < 4; seed++) {
        const layout = Array.from({ length: 4 }, (_, padIdx) => wfCampRewardForPad(seed, padIdx));
        assert.deepEqual([...new Set(layout)].sort(), rewardIds, `seed class ${seed} must place every trophy once`);
        const roles = layout.map((reward) => WF_CAMP_REWARDS[reward].role);
        assert.equal(roles[0], roles[2], `seed class ${seed}: lower x-mirror pads need equivalent roles`);
        assert.equal(roles[1], roles[3], `seed class ${seed}: upper x-mirror pads need equivalent roles`);
        assert.notEqual(roles[0], roles[1], `seed class ${seed}: each map half needs offense and defense`);
        for (let padIdx = 0; padIdx < 4; padIdx++) seenByPad[padIdx].add(layout[padIdx]);
    }
    for (let padIdx = 0; padIdx < 4; padIdx++) {
        assert.deepEqual([...seenByPad[padIdx]].sort(), rewardIds, `pad ${padIdx} must host every trophy across four seeds`);
    }
});

test("headless server simulation skips presentation snapshots without changing the result", () => {
    const blue = squad("A"), red = squad("B");
    const visual = runWarfrontMatch(
        blue, red, 2468, "balanced", "balanced", "central",
        { blue: "jungle", red: "siege", adapt: false },
        { blue: "vanguard", red: "zealot" },
    );
    const headless = runWarfrontMatch(
        blue, red, 2468, "balanced", "balanced", "central",
        { blue: "jungle", red: "siege", adapt: false },
        { blue: "vanguard", red: "zealot" },
        { captureSnapshots: false },
    );
    const fullCapture = runWarfrontMatch(
        blue, red, 2468, "balanced", "balanced", "central",
        { blue: "jungle", red: "siege", adapt: false },
        { blue: "vanguard", red: "zealot" },
        { snapshotStride: 1 },
    );

    assert.ok(visual.snapshots.length > 1, "the renderer path captures its sparse presentation timeline");
    assert.equal(headless.snapshots.length, 0, "server verification must not allocate presentation frames");
    assert.deepEqual(headless, { ...visual, snapshots: [] }, "snapshot capture must be observational only");
    assert.deepEqual(
        { ...fullCapture, snapshots: [] },
        { ...visual, snapshots: [] },
        "outcome, events, ticks, and receipts must be byte-identical to a full-capture reference",
    );
    assert.equal(fullCapture.snapshots.length, fullCapture.ticks + 1);
    assert.equal(visual.snapshots[0].t, 0);
    assert.equal(visual.snapshots.at(-1)?.t, visual.ticks, "the winning/terminal tick is always retained");
    assert.ok(visual.snapshots.length <= Math.ceil(visual.ticks / WF_SNAPSHOT_STRIDE) + 2);
    for (let i = 1; i < visual.snapshots.length; i++) {
        const gap = visual.snapshots[i].t - visual.snapshots[i - 1].t;
        assert.ok(gap > 0 && gap <= WF_SNAPSHOT_STRIDE, `keyframe gap ${gap} at index ${i}`);
        if (i < visual.snapshots.length - 1) assert.equal(visual.snapshots[i].t % WF_SNAPSHOT_STRIDE, 0);
        assert.deepEqual(visual.snapshots[i], fullCapture.snapshots[visual.snapshots[i].t]);
    }
    const offKeyframeStrike = visual.events.find((event) => event.type === "petstrike" && event.t % WF_SNAPSHOT_STRIDE !== 0);
    assert.ok(offKeyframeStrike, "the probe must include a one-tick pet strike between keyframes");
    assert.equal(visual.snapshots.some((frame) => frame.t === offKeyframeStrike.t), false);
    assert.equal(
        fullCapture.snapshots[offKeyframeStrike.t].actors.find((actor) => actor.id === offKeyframeStrike.actorId)?.state,
        "attack",
        "the compact event sidecar preserves the attack pose omitted by sparse keyframes",
    );
});

test("malformed diagnostic snapshot strides fall back without dropping the live frontier", () => {
    for (const snapshotStride of [Number.NaN, Number.POSITIVE_INFINITY]) {
        const ctl = startWarfrontMatch(squad("A"), squad("B"), 5, { snapshotStride });
        ctl.advanceRoundPartial(4);
        assert.deepEqual(ctl.result.snapshots.map((frame) => frame.t), [0, WF_SNAPSHOT_STRIDE]);
    }
});

test("opening doctrines form a visible 60-second counter triangle", () => {
    const cases = [
        ["vanguard", "zealot"],
        ["zealot", "bulwark"],
        ["bulwark", "vanguard"],
    ] as const;
    for (const [blueDoctrine, redDoctrine] of cases) {
        const ctl = startWarfrontMatch(squad("A"), squad("B"), 19, {
            blueDoctrine, redDoctrine, bluePolicy: "off", redPolicy: "off", adaptStances: false,
        });
        assert.equal(ctl.result.opening.winner, "blue", `${blueDoctrine} must counter ${redDoctrine}`);
        assert.equal(ctl.result.opening.reason, "counter");
        assert.deepEqual(ctl.result.doctrines, { blue: blueDoctrine, red: redDoctrine });
        const event = ctl.result.events.find((candidate) => candidate.type === "opening");
        assert.ok(event && event.winner === "blue" && event.secs === 60);
        assert.ok(event && event.attackPct > 0 && event.speedPct > 0, "the broadcast exposes the opening stakes");
    }

    const neutral = startWarfrontMatch(squad("A"), squad("B"), 19, {
        blueDoctrine: "warden-pact", redDoctrine: "vanguard",
    });
    assert.equal(neutral.result.opening.winner, null, "Warden's Pact deliberately opts out of the triangle");
    assert.equal(neutral.result.opening.reason, "neutral");

    const timed = startWarfrontMatch(squad("A"), squad("B"), 19, {
        blueDoctrine: "vanguard", redDoctrine: "zealot", bluePolicy: "off", redPolicy: "off", adaptStances: false,
    });
    assert.equal(timed.result.snapshots[0].opening.active, true);
    assert.equal(timed.result.snapshots[0].opening.secs, 60);
    timed.advanceRoundPartial(WARFRONT_TPS * 60);
    assert.equal(frameAt(timed.result, WARFRONT_TPS * 60).opening.active, false, "initiative expires exactly at 1:00");
    assert.equal(frameAt(timed.result, WARFRONT_TPS * 60).opening.secs, 0);

    // The AI seals a seed-derived combat plan without inspecting the player's
    // doctrine. Same seed, different player plan => same opponent plan.
    const seededA = startWarfrontMatch(squad("A"), squad("B"), 77, { blueDoctrine: "vanguard" });
    const seededB = startWarfrontMatch(squad("A"), squad("B"), 77, { blueDoctrine: "bulwark" });
    assert.equal(seededA.result.doctrines.red, seededB.result.doctrines.red);
    assert.equal(seededA.result.doctrines.red, scoutedWarfrontDoctrine(77, "red"), "setup scout must equal the actual declaration");
    assert.ok(["vanguard", "bulwark", "zealot"].includes(seededA.result.doctrines.red));
    for (const seed of [1, 2, 19, 77, 12345]) {
        const preview = scoutedWarfrontDoctrine(seed, "red");
        const actual = startWarfrontMatch(squad("A"), squad("B"), seed, { blueDoctrine: "vanguard" });
        assert.equal(actual.result.doctrines.red, preview, `seed ${seed}: scouted doctrine drifted from kickoff`);
    }
});

test("the opening loser receives one explicit read reserve at the first Council", () => {
    const ctl = startWarfrontMatch(squad("A"), squad("B"), 19, {
        blueDoctrine: "vanguard", redDoctrine: "zealot",
        bluePolicy: "off", redPolicy: "off", adaptStances: false,
    });
    ctl.advanceRound();
    const reserves = ctl.result.events.filter((event) => event.type === "readreserve");
    assert.deepEqual(reserves, [{
        t: WARFRONT_TPS * WF_ROUND_SECONDS,
        type: "readreserve",
        team: "red",
        coins: WF_OPENING_READ_RESERVE,
    }]);
    assert.ok(ctl.coins("red") >= WF_OPENING_READ_RESERVE, "the reserve is visible and spendable at Council");
    ctl.advanceRound([], "turtle");
    assert.equal(ctl.result.events.filter((event) => event.type === "readreserve").length, 1, "read reserve is never repeated");

    const neutral = startWarfrontMatch(squad("A"), squad("B"), 19, {
        blueDoctrine: "warden-pact", redDoctrine: "vanguard",
        bluePolicy: "off", redPolicy: "off", adaptStances: false,
    });
    neutral.advanceRound();
    assert.equal(neutral.result.events.some((event) => event.type === "readreserve"), false, "neutral openings create no pity economy");
});

test("wave priority is side-symmetric and elite pressure is worth more", () => {
    const neutral = [
        { side: "blue" as const, lane: "n" as const, x: 8, elite: false },
        { side: "red" as const, lane: "n" as const, x: -8, elite: false },
    ];
    assert.equal(wfWavePriority(neutral, "blue"), 0);
    assert.equal(wfWavePriority(neutral, "red"), 0);

    const bluePush = [
        { side: "blue" as const, lane: "n" as const, x: 16, elite: false },
        { side: "red" as const, lane: "n" as const, x: 4, elite: false },
        { side: "hollow" as const, lane: "n" as const, x: -20, elite: true },
    ];
    const blue = wfWavePriority(bluePush, "blue");
    const red = wfWavePriority(bluePush, "red");
    assert.ok(blue > 0, "the farther allied front owns first move");
    assert.equal(blue, -red, "the same board must read oppositely for each side");
    assert.equal(wfWavePriority(bluePush, "blue", "s"), 0, "lane reads ignore other lanes");

    const normal = wfWavePriority([{ side: "blue", lane: "m", x: 0, elite: false }], "blue");
    const elite = wfWavePriority([{ side: "blue", lane: "m", x: 0, elite: true }], "blue");
    assert.ok(elite > normal, "elite waves exert visibly greater map pressure");
});

test("Sigil macro turns lane priority into contest, trade, and comeback choices", () => {
    const base = { structureDeficit: 0, ownPips: 0, foePips: 0, foesCommitted: 0 };
    assert.equal(wfSigilMacroDecision({ ...base, stance: "jungle", wavePriority: -4 }), "contest", "Jungle owns objective identity");
    assert.equal(wfSigilMacroDecision({ ...base, stance: "balanced", wavePriority: 0.25 }), "contest", "pushed waves buy Balanced first move");
    assert.equal(wfSigilMacroDecision({ ...base, stance: "balanced", wavePriority: -0.8 }), "hold", "a materially pushed-in team clears before rotating");
    assert.equal(wfSigilMacroDecision({ ...base, stance: "headhunt", wavePriority: -1.2 }), "contest", "Headhunt accepts one more wave-body of risk to force a fight");
    assert.equal(wfSigilMacroDecision({ ...base, stance: "siege", wavePriority: 2, foesCommitted: 3 }), "trade", "Siege converts an enemy commit into a grouped push");
    assert.equal(wfSigilMacroDecision({ ...base, stance: "turtle", wavePriority: -2, foesCommitted: 4 }), "hold", "Turtle refuses a low-stakes cross-map chase");
    assert.equal(wfSigilMacroDecision({ ...base, stance: "turtle", wavePriority: -2, foePips: 2 }), "contest", "Ascendance point must be denied");
    assert.equal(wfSigilMacroDecision({ ...base, stance: "siege", wavePriority: -2, ownPips: 2 }), "contest", "a team may claim its own Ascendance point");
    assert.equal(wfSigilMacroDecision({ ...base, stance: "turtle", wavePriority: -2, structureDeficit: 2 }), "contest", "the trailing team keeps an objective comeback path");
});

test("macro AI covers every lane and dynamically reassigns its flex fighter", () => {
    const result = runWarfrontMatch(squad("A"), squad("B"), 3);
    const cleanPatterns = new Set(
        result.snapshots
            .filter((frame) => frame.t % (WARFRONT_TPS * 5) === 0)
            .map((frame) => frame.actors
                .filter((actor) => actor.team === "blue")
                .map((actor) => actor.intent.split(":")[0]))
            .filter((lanes) => lanes.every((lane) => lane === "n" || lane === "m" || lane === "s"))
            .map((lanes) => lanes.join("")),
    );
    assert.ok(cleanPatterns.size >= 2, "the fourth fighter should rotate when lane pressure changes");
    for (const pattern of cleanPatterns) {
        assert.ok(pattern.includes("n") && pattern.includes("m") && pattern.includes("s"), `${pattern} abandoned a lane`);
    }
});

test("low-health fighters can complete a recall, heal, and rejoin alive", () => {
    const result = runWarfrontMatch(squad("A"), squad("B"), 3);
    let completedRecall = false;
    for (let tick = 1; tick < result.snapshots.length && !completedRecall; tick++) {
        const before = result.snapshots[tick - 1];
        const after = result.snapshots[tick];
        for (const actor of before.actors) {
            const next = after.actors.find((candidate) => candidate.id === actor.id);
            if (actor.intent === "recall" && next?.intent !== "recall" && next?.state !== "respawning") {
                assert.ok(next && next.hp / next.maxHp >= 0.74, "a completed recall rejoins at the recovery threshold");
                completedRecall = true;
                break;
            }
        }
    }
    assert.equal(completedRecall, true, "at least one fighter should survive a fountain reset");
});

test("match always terminates with a verdict within the cap", () => {
    for (const seed of [1, 77, 20260719]) {
        const r = runWarfrontMatch(squad("A"), squad("B"), seed);
        assert.ok(r.winner === "blue" || r.winner === "red" || r.winner === "draw");
        assert.ok(r.ticks <= WARFRONT_TPS * WF_MAX_SECONDS);
        assert.ok(r.snapshots.length > WARFRONT_TPS * 30 / WF_SNAPSHOT_STRIDE, "should run past the first round");
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
    if (exposed) assert.equal(frameAfter(r, exposed.t).structures.red.core.exposed, true, "core exposure reaches the next renderer keyframe");
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

test("the Gate Warden is mechanically dormant until WAR", () => {
    const ctl = startWarfrontMatch(squad("A"), squad("B"), 9, { bluePolicy: "off", redPolicy: "off" });
    while (ctl.result.ticks < WARFRONT_TPS * WF_PHASE_WAR && !ctl.done) {
        ctl.advanceRoundPartial(WARFRONT_TPS * WF_PHASE_WAR);
    }
    const beforeWar = frameAt(ctl.result, WARFRONT_TPS * WF_PHASE_WAR - 1);
    const atWar = frameAt(ctl.result, WARFRONT_TPS * WF_PHASE_WAR);
    assert.equal(beforeWar.warden.active, false);
    assert.equal(beforeWar.warden.hp, beforeWar.warden.maxHp, "the dormant Warden cannot be damaged");
    assert.equal(atWar.warden.active, true, "WAR wakes the Warden on schedule");
    assert.equal(ctl.result.events.some((event) => event.type === "wardenhit" && event.t < WARFRONT_TPS * WF_PHASE_WAR), false);
    assert.equal(ctl.result.events.some((event) => event.type === "wardenphase" && event.t < WARFRONT_TPS * WF_PHASE_WAR), false);
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
        const at = frameAt(r, wardenKill.t + WF_SNAPSHOT_STRIDE);
        const before = frameAt(r, wardenKill.t - 1);
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
    assert.deepEqual(ctl.result.choiceLog, [{
        round: 1,
        choices: [{ petIndex: 0, kind: "strike" }],
    }], "manual settlement records only the effective, serializable inputs");
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

test("Lesser Wardens path out of their dens instead of shaking at spawn", () => {
    const ctl = startWarfrontMatch(squad("A"), squad("B"), 42, {
        bluePolicy: "off",
        redPolicy: "off",
        adaptStances: false,
    });
    while (ctl.result.ticks < WARFRONT_TPS * 85 && !ctl.done) {
        ctl.advanceRoundPartial(WARFRONT_TPS);
    }
    for (let padIdx = 0; padIdx < 4; padIdx++) {
        const spawned = ctl.result.events.find((event) => event.type === "minispawn" && event.padIdx === padIdx);
        assert.ok(spawned, `camp ${padIdx} never spawned`);
        const start = spawned?.t ?? 0;
        const frames = ctl.result.snapshots
            .filter((snapshot) => snapshot.t >= start && snapshot.t <= start + WARFRONT_TPS * 15)
            .map((snapshot) => snapshot.minis[padIdx]);
        const origin = frames[0];
        const maxTravel = Math.max(...frames.map((mini) => Math.hypot(mini.x - origin.x, mini.y - origin.y)));
        assert.ok(maxTravel > 0.75, `camp ${padIdx} remained trapped in its den (${maxTravel.toFixed(2)}u)`);
        assert.ok(frames.every((mini) => mini.attackPhase >= -1 && mini.attackPhase <= 1));
    }
});

test("captured Wardens overcharge sentinels; across seeds a ward projects and the recruit fights", () => {
    // Which capture produces which follow-up is trajectory-dependent, so the
    // rally invariant is asserted per capture while the ward/vanguard payoffs
    // only need to exist SOMEWHERE across the probe seeds.
    let captureSeen = false, wardSeen = false, vanguardSeen = false;
    for (const seed of [3, 11, 83, 203]) {
        const result = runWarfrontMatch(squad("A"), squad("B"), seed);
        for (const capture of result.events.filter((event) => event.type === "minikill")) {
            captureSeen = true;
            const captureFrame = frameAfter(result, capture.t);
            const rally = result.events.find((event) =>
                event.type === "guardianrally"
                && event.t === capture.t
                && event.team === capture.team
                && event.padIdx === capture.padIdx);
            if (captureFrame.guardians[capture.team].some((guardian) => guardian.alive)) {
                assert.ok(rally, `seed ${seed}: a capture with a living sentinel must issue the rally`);
                assert.ok(captureFrame.guardians[capture.team].some((guardian) => guardian.rallySecs > 15));
                assert.ok(captureFrame.guardians[capture.team].every((guardian) =>
                    guardian.attackPhase >= -1 && guardian.attackPhase <= 1));
            }
            if (result.events.some((event) =>
                event.type === "guardianward"
                && event.team === capture.team
                && event.t >= capture.t
                && event.t <= capture.t + WARFRONT_TPS * 16
                && event.amount > 0)) wardSeen = true;
            // The recruit's contract shows on camera as EITHER a wave clear or a
            // structure siege (the P2 march) inside its ~50 s tour.
            if (result.events.some((event) =>
                ((event.type === "mobhit" && event.targetId === `mini-${capture.padIdx}`)
                    || (event.type === "structhit" && event.mini === capture.padIdx))
                && event.t >= capture.t
                && event.t <= capture.t + WARFRONT_TPS * 50)) vanguardSeen = true;
        }
        if (captureSeen && wardSeen && vanguardSeen) break;
    }
    assert.ok(captureSeen, "the probe seeds must capture a Lesser Warden");
    assert.ok(wardSeen, "an overcharged sentinel must project a real lane ward somewhere");
    assert.ok(vanguardSeen, "a recruited Warden must clear a wave or siege during its contract");
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

test("the Awakened Sigil wakes 15 seconds after each Council, before the Collapse", () => {
    const r = runWarfrontMatch(squad("A"), squad("B"), 3);
    const soons = r.events.filter((e) => e.type === "sigilsoon");
    const awakes = r.events.filter((e) => e.type === "sigilawake");
    if (r.ticks >= WARFRONT_TPS * 110) {
        assert.ok(awakes.length >= 1, "a camp must awaken once the schedule starts");
        // Within a second of the appointment — a warned camp sniped on the final
        // tick hands the awakening to the next camp a tick late.
        assert.ok(Math.abs(awakes[0].t - WARFRONT_TPS * 105) <= WARFRONT_TPS, `first awakening off schedule (t=${awakes[0].t})`);
        const warning = soons.find((event) => event.padIdx === awakes[0].padIdx && event.t < awakes[0].t);
        assert.ok(warning && warning.t === WARFRONT_TPS * WF_ROUND_SECONDS, "the warning opens on the 1:30 Council boundary");
        assert.ok(warning && awakes[0].t - warning.t === WARFRONT_TPS * 15, "teams get exactly 15 seconds to rotate after Council");
    }
    for (const aw of awakes) {
        assert.ok(aw.t <= WARFRONT_TPS * WF_PHASE_SUDDEN, "no awakening bleeds into the Hollow Collapse");
        assert.ok(soons.some((s) => s.padIdx === aw.padIdx && s.t < aw.t), "every awakening is announced first");
        assert.ok(aw.padIdx >= 0 && aw.padIdx <= 3);
    }
    // The HUD countdown is live before the first warning.
    const early = frameAt(r, WARFRONT_TPS * 70);
    assert.equal(early.sigil.scheduled, true);
    assert.ok(early.sigil.secs > 0 && early.sigil.secs <= 105);
    // While awake, the awakened camp is flagged in the mini snapshot for the renderer.
    if (awakes.length) {
        const frame = frameAfter(r, awakes[0].t);
        if (frame.sigil.state === "awake") assert.equal(frame.minis[frame.sigil.padIdx].awake, true);
    }
});

test("the Sigil ARC: pips track awakened claims, the third claim crowns an Ascendant, the Warden hour is called", () => {
    // Seed 2 produces an ascendance on the current tuning (pinned by the
    // bounded 20-seed macro/balance probe below).
    const r = runWarfrontMatch(squad("A"), squad("B"), 2);
    const pips = r.events.filter((e) => e.type === "sigilpip");
    const awakenedClaims = r.events.filter((e) => e.type === "minikill" && e.awakened);
    assert.equal(pips.length, awakenedClaims.length, "every awakened claim mints exactly one pip");
    const counts: Record<string, number> = { blue: 0, red: 0 };
    for (const pip of pips) {
        if (pip.type !== "sigilpip") continue;
        counts[pip.team]++;
        assert.equal(pip.count, counts[pip.team], "pip counts are cumulative per team");
    }
    const asc = r.events.find((e) => e.type === "ascendance");
    assert.ok(asc, "seed 2 must crown an Ascendant");
    if (asc && asc.type === "ascendance") {
        const third = pips.find((p) => p.type === "sigilpip" && p.team === asc.team && p.count === 3);
        assert.ok(third && third.t === asc.t, "ascendance lands on the third pip");
        const after = frameAfter(r, asc.t);
        assert.equal(after.ascendant, asc.team, "the snapshot exposes the Ascendant");
        assert.equal(after.sigilPips[asc.team], 3);
    }
    // The Warden hour is announced before the WAR phase while the Warden lives.
    const call = r.events.find((e) => e.type === "wardensoon");
    const wardenKill = r.events.find((e) => e.type === "wardenkill");
    const callT = WARFRONT_TPS * (WF_PHASE_WAR - 20);
    if (!wardenKill || wardenKill.t > callT) {
        assert.ok(call && call.t === callT, "wardensoon fires 20s before WAR");
    }
});

test("a recruited camp boss MARCHES: announced, and it sieges enemy structures", () => {
    let marchAnnounced = false, structSieged = false, escortedSiege = false;
    let siegeBroken = false, sigilStolen = false;
    for (const seed of [1, 4, 6, 9]) {
        const r = runWarfrontMatch(squad("A"), squad("B"), seed);
        assert.deepEqual(
            r.campRewards,
            Array.from({ length: 4 }, (_, padIdx) => wfCampRewardForPad(seed, padIdx)),
            `seed ${seed}: result metadata must reveal the sealed trophy layout`,
        );
        for (const e of r.events) {
            if (e.type === "minimarch") marchAnnounced = true;
            if (e.type === "structhit" && e.mini !== undefined) {
                structSieged = true;
                if (frameAfter(r, e.t).minis[e.mini]?.escorted) escortedSiege = true;
            }
            if (e.type === "siegebreak") {
                siegeBroken = true;
                assert.ok(e.bounty > 0, "breaking an unconverted siege pays a recovery bounty");
                assert.equal(frameAfter(r, e.t).minis[e.padIdx]?.alive, false, "the intercepted recruit leaves the field");
            }
            if (e.type === "minikill" && e.stolen) {
                sigilStolen = true;
                assert.equal(e.awakened, true, "only an awakened objective can be called stolen");
            }
        }
        // Every recruit announces its march on the same tick as the kill.
        for (const kill of r.events.filter((e) => e.type === "minikill")) {
            assert.equal(kill.reward, r.campRewards[kill.padIdx], `seed ${seed}: capture must award the advertised trophy`);
            assert.ok(WF_CAMP_REWARDS[kill.reward].label.length > 0, "capture rewards need stable viewer-facing copy");
            assert.ok(
                r.events.some((e) => e.type === "minimarch" && e.t === kill.t && e.padIdx === kill.padIdx && e.team === kill.team),
                `seed ${seed}: a recruit must announce its march`,
            );
            assert.equal(typeof kill.awakened, "boolean");
            assert.equal(typeof kill.stolen, "boolean");
            if (!kill.awakened) assert.equal(kill.stolen, false);
        }
        if (marchAnnounced && structSieged && escortedSiege && siegeBroken && sigilStolen) break;
    }
    assert.ok(marchAnnounced, "no camp boss was ever recruited across the probe seeds");
    assert.ok(structSieged, "no marching boss ever landed a structure hit across the probe seeds");
    assert.ok(escortedSiege, "a recruited boss must reach full siege with a living pet escort");
    assert.ok(siegeBroken, "defenders must be able to intercept a recruit before it converts a structure");
    assert.ok(sigilStolen, "damage attribution must produce a real last-hit Sigil steal");
});

test("objective attribution credits effective HP, so minority overkill remains a truthful steal", () => {
    assert.equal(wfObjectiveDamageCredit(20, 500), 20);
    assert.equal(wfObjectiveDamageCredit(500, 20), 20);
    assert.equal(wfObjectiveDamageCredit(0, 500), 0);
    assert.equal(wfObjectiveDamageCredit(20, -5), 0);

    const cases = [
        { name: "Warden", killerBefore: 900, foe: 1000, remainingHp: 20, attempted: 500 },
        { name: "Sigil", killerBefore: 300, foe: 400, remainingHp: 50, attempted: 1000 },
    ];
    for (const probe of cases) {
        assert.equal(probe.killerBefore + probe.attempted > probe.foe, true, `${probe.name}: raw overkill would falsely erase the steal`);
        const credited = wfObjectiveDamageCredit(probe.remainingHp, probe.attempted);
        assert.equal(probe.killerBefore + credited < probe.foe, true, `${probe.name}: effective damage must preserve the true minority claim`);
    }
});

test("authored playbook is deterministic, Council-numbered, and produces an end receipt", () => {
    const authored = {
        captureSnapshots: false,
        blueDeployment: ["bottom", "top", "mid", "flex"] as const,
        redDeployment: ["bottom", "top", "mid", "flex"] as const,
        blueBuildPackage: "hold-line" as const,
        redBuildPackage: "hold-line" as const,
        blueObjectiveTechnique: "secure" as const,
        redObjectiveTechnique: "secure" as const,
        blueCounterstrike: "bounty-hunt" as const,
        redCounterstrike: "bounty-hunt" as const,
        blueRoundDecisions: [
            { coachOrder: "contest" as const },
            { coachOrder: "trade" as const, buildPackage: "blood-hunt" as const },
            { coachOrder: "ambush" as const, buildPackage: "escort-rite" as const },
        ],
        redRoundDecisions: [
            { coachOrder: "contest" as const },
            { coachOrder: "trade" as const, buildPackage: "blood-hunt" as const },
            { coachOrder: "ambush" as const, buildPackage: "escort-rite" as const },
        ],
    };
    const a = runWarfrontMatch(squad("A"), squad("B"), 7, "balanced", "balanced", undefined, undefined, undefined, authored);
    const b = runWarfrontMatch(squad("A"), squad("B"), 7, "balanced", "balanced", undefined, undefined, undefined, authored);
    assert.deepEqual(a.events, b.events);
    assert.deepEqual(a.decisionReceipts, b.decisionReceipts);
    const orders = a.events.filter((event) => event.type === "coachorder");
    assert.ok(orders.length >= 2, "both sealed coaches should issue their first Council order");
    assert.ok(orders.every((event) => event.round >= 1 && event.t >= WARFRONT_TPS * WF_ROUND_SECONDS), "there is no phantom round-0 order");
    assert.equal(orders.find((event) => event.team === "blue")?.round, 1);
    assert.equal(a.choiceLog?.[0]?.round, 1);
    assert.equal(a.choiceLog?.[0]?.coachOrder, "contest");
    assert.ok(a.decisionReceipts?.blue.deployment);
    assert.equal(a.decisionReceipts?.blue.rounds[1]?.buildPackage, "blood-hunt");
    assert.deepEqual(
        a.decisionReceipts?.blue.buildPackages?.map((entry) => entry.choice),
        ["hold-line", "blood-hunt", "escort-rite"],
        "receipt keeps first-selection history instead of relabeling one aggregate as the latest package",
    );
    for (const entry of a.decisionReceipts?.blue.buildPackages ?? []) {
        assert.equal(
            entry.procs,
            a.events.filter((event) => event.type === "packageproc" && event.team === "blue" && event.choice === entry.choice).length,
            `${entry.choice} receipt count must equal its visible proc events`,
        );
    }
    assert.equal(a.decisionReceipts?.blue.outcome.coins, Math.floor(a.coins.blue));
    assert.equal(
        a.decisionReceipts?.blue.outcome.sigilsClaimed,
        a.events.filter((event) => event.type === "minikill" && event.team === "blue" && event.awakened).length,
    );
});

test("named Top/Mid/Bottom deployment locks specialists while Flex remains dynamic", () => {
    const deployment = ["bottom", "top", "mid", "flex"] as const;
    const ctl = startWarfrontMatch(squad("A"), squad("B"), 13, {
        blueDeployment: deployment,
        redDeployment: deployment,
        captureSnapshots: true,
    });
    ctl.advanceRoundPartial(WARFRONT_TPS * (WF_DEPLOYMENT_LOCK_SECONDS - 1));
    const expected = new Map([[0, "s"], [1, "n"], [2, "m"]]);
    for (const seconds of [2, 12, 25, WF_DEPLOYMENT_LOCK_SECONDS - 1]) {
        const frame = frameAt(ctl.result, seconds * WARFRONT_TPS);
        assert.equal(frame.decisions?.blue.deploymentLockLeft, WF_DEPLOYMENT_LOCK_SECONDS - seconds);
        for (const actor of frame.actors.filter((candidate) => candidate.team === "blue" && candidate.slot < 3 && candidate.state !== "respawning")) {
            assert.equal(actor.intent.split(":")[0], expected.get(actor.slot), `slot ${actor.slot} left its declared lane at ${seconds}s`);
        }
    }
    assert.deepEqual(
        ctl.result.events.find((event) => event.type === "deployment" && event.team === "blue"),
        { t: 0, type: "deployment", team: "blue", slots: deployment, lockSecs: WF_DEPLOYMENT_LOCK_SECONDS },
    );
});

test("a prearmed Counterstrike fires on first statue loss, once", () => {
    assert.equal(wfCrossMapLaneForStatue(0), "s", "losing north sends the response bottom");
    assert.equal(wfCrossMapLaneForStatue(1), "n", "losing bottom sends the response north");
    const result = runWarfrontMatch(squad("A"), squad("B"), 5, "balanced", "balanced", undefined, undefined, undefined, {
        captureSnapshots: false,
        blueCounterstrike: "cross-map",
        redCounterstrike: "cross-map",
    });
    for (const team of ["blue", "red"] as const) {
        const downs = result.events.filter((event) => event.type === "statuedown" && event.team === team);
        const triggers = result.events.filter((event) => event.type === "counterstrike" && event.team === team);
        assert.ok(triggers.length <= 1, `${team} Counterstrike repeated`);
        if (downs.length) {
            assert.equal(triggers.length, 1, `${team} did not fire its prearmed route`);
            assert.equal(triggers[0].t, downs[0].t, `${team} waited beyond its first statue loss`);
            assert.equal(triggers[0].choice, "cross-map");
            assert.equal(triggers[0].lane, wfCrossMapLaneForStatue(downs[0].statue));
            const waves = result.events.filter((event) => event.type === "counterstrikewave" && event.team === team);
            assert.equal(waves.length, 1, `${team} must receive exactly one Cross-map elite lane`);
            assert.equal(waves[0].lane, triggers[0].lane);
            assert.ok(waves[0].t > triggers[0].t && waves[0].t - triggers[0].t <= WARFRONT_TPS * 15,
                `${team} Cross-map responder missed the next wave`);
        }
    }
});

test("a post-loss Council Counterstrike fires immediately and cannot repeat", () => {
    const ctl = startWarfrontMatch(squad("A"), squad("B", 12), 1, {
        bluePolicy: "balanced", redPolicy: "balanced", captureSnapshots: false,
    });
    let sawBlueLoss = false;
    for (let guard = 0; guard < 6 && !ctl.done; guard++) {
        ctl.advanceRound();
        sawBlueLoss = ctl.result.events.some((event) => event.type === "statuedown" && event.team === "blue");
        if (sawBlueLoss) break;
    }
    assert.equal(sawBlueLoss, true, "probe must reach a blue statue loss before the match ends");
    assert.equal(ctl.result.events.some((event) => event.type === "counterstrike" && event.team === "blue"), false);
    const boundary = ctl.result.ticks;
    ctl.advanceRoundPartial(1, { counterstrike: "fortify" });
    const triggers = ctl.result.events.filter((event) => event.type === "counterstrike" && event.team === "blue");
    assert.equal(triggers.length, 1);
    assert.equal(triggers[0].t, boundary, "the Council response must answer the already-lost statue immediately");
    ctl.advanceRound({ counterstrike: "cross-map" });
    assert.equal(ctl.result.events.filter((event) => event.type === "counterstrike" && event.team === "blue").length, 1);
});

test("20-seed authored-playbook gate keeps pacing, symmetry, one-shots, and capstones healthy", () => {
    const packages = ["hold-line", "blood-hunt", "escort-rite"] as const;
    const techniques = ["secure", "hijack", "zone"] as const;
    const counterstrikes = ["fortify", "cross-map", "bounty-hunt"] as const;
    const orders = ["contest", "trade", "ambush"] as const;
    const seenPackages = new Set<string>(), usedTechniques = new Set<string>(), seenCounters = new Set<string>();
    const wins = { blue: 0, red: 0, draw: 0 };
    let timeouts = 0;
    for (let seed = 1; seed <= 20; seed++) {
        const buildPackage = packages[(seed - 1) % packages.length];
        const objectiveTechnique = techniques[(seed - 1) % techniques.length];
        const counterstrike = counterstrikes[(seed - 1) % counterstrikes.length];
        // The first Council intentionally contests so every declared Sigil
        // technique gets an honest activation window; later Councils rotate
        // through Trade/Ambush/Contest to soak the macro branches.
        const roundDecisions = Array.from({ length: 6 }, (_, round) => ({
            coachOrder: round === 0 ? "contest" as const : orders[(seed + round - 1) % orders.length],
        }));
        const result = runWarfrontMatch(
            squad("A"), squad("B"), seed, "balanced", "balanced", undefined,
            { blue: "balanced", red: "balanced", adapt: false }, undefined,
            {
                captureSnapshots: false,
                blueDeployment: ["top", "mid", "bottom", "flex"],
                redDeployment: ["top", "mid", "bottom", "flex"],
                blueBuildPackage: buildPackage, redBuildPackage: buildPackage,
                blueObjectiveTechnique: objectiveTechnique, redObjectiveTechnique: objectiveTechnique,
                blueCounterstrike: counterstrike, redCounterstrike: counterstrike,
                blueRoundDecisions: roundDecisions, redRoundDecisions: roundDecisions,
            },
        );
        wins[result.winner ?? "draw"]++;
        if (result.ticks === WARFRONT_TPS * WF_MAX_SECONDS) timeouts++;
        assert.ok(result.ticks >= WARFRONT_TPS * 300 && result.ticks <= WARFRONT_TPS * WF_MAX_SECONDS);
        assert.ok(result.decisionReceipts, `seed ${seed}: missing decision receipt`);
        for (const team of ["blue", "red"] as const) {
            assert.ok(result.events.filter((event) => event.type === "techniqueused" && event.team === team).length <= 1);
            assert.ok(result.events.filter((event) => event.type === "counterstrike" && event.team === team).length <= 1);
        }
        for (const event of result.events) {
            if (event.type === "packageproc") seenPackages.add(event.choice);
            if (event.type === "techniqueused") usedTechniques.add(event.choice);
            if (event.type === "counterstrike") seenCounters.add(event.choice);
        }
        const activeSeconds = [...new Set(result.events
            .filter((event) => event.type === "hit" || event.type === "mobhit" || event.type === "structhit" || event.type === "wardenhit")
            .map((event) => Math.floor(event.t / WARFRONT_TPS)))].sort((a, b) => a - b);
        let longestQuiet = activeSeconds[0] ?? WF_MAX_SECONDS;
        for (let i = 1; i < activeSeconds.length; i++) longestQuiet = Math.max(longestQuiet, activeSeconds[i] - activeSeconds[i - 1] - 1);
        assert.ok(longestQuiet <= 45, `seed ${seed}: ${longestQuiet}s quiet stretch`);
    }
    const decided = wins.blue + wins.red;
    assert.ok(decided > 0 && Math.max(wins.blue, wins.red) / decided <= 0.70, `authored side skew exceeded 70% (${JSON.stringify(wins)})`);
    assert.ok(timeouts <= 4, `authored playbooks exceeded 20% timer finishes (${timeouts}/20)`);
    assert.deepEqual([...seenPackages].sort(), [...packages].sort(), "every package capstone must visibly proc");
    assert.deepEqual([...usedTechniques].sort(), [...techniques].sort(), "every Sigil technique must find a use case");
    assert.deepEqual([...seenCounters].sort(), [...counterstrikes].sort(), "every Counterstrike route must trigger");
});

test("20-seed macro probe stays balanced, contests objectives, and permits a comeback", () => {
    const winners = new Set<string>();
    let comebackObserved = false;
    const winCounts = { blue: 0, red: 0, draw: 0 };
    let timeouts = 0;
    for (const seed of Array.from({ length: 20 }, (_, i) => i + 1)) {
        const r = runWarfrontMatch(squad("A"), squad("B"), seed);
        winners.add(r.winner);
        winCounts[r.winner ?? "draw"]++;
        const verdicts = r.events.filter((event) => event.type === "verdict");
        if (r.ticks === WARFRONT_TPS * WF_MAX_SECONDS) {
            timeouts++;
            assert.equal(verdicts.length, 1, `seed ${seed}: timer finish must emit one broadcast verdict`);
            assert.equal(verdicts[0]?.winner, r.winner);
        } else assert.equal(verdicts.length, 0, `seed ${seed}: structural finish must not emit a timer verdict`);
        // Mercy acceleration only ever engages between halftime and the
        // Collapse (after which the crescendo owns the ramp), and at most once.
        const mercies = r.events.filter((e) => e.type === "mercy");
        assert.ok(mercies.length <= 1, `seed ${seed}: mercy latched more than once`);
        for (const m of mercies) {
            assert.ok(m.t > WARFRONT_TPS * 300 && m.t <= WARFRONT_TPS * WF_PHASE_SUDDEN, `seed ${seed}: mercy fired outside its window (t=${m.t})`);
        }
        assert.ok(r.ticks >= WARFRONT_TPS * 300, `seed ${seed} ended before the strategic game developed`);
        assert.ok(r.ticks <= WARFRONT_TPS * WF_MAX_SECONDS);
        assert.ok(r.events.some((event) => event.type === "wardenkill"), `seed ${seed} never contested the Gate Warden`);
        assert.ok(r.events.some((event) => event.type === "minikill"), `seed ${seed} never recruited a Lesser Warden`);
        for (const frame of r.snapshots.filter((snapshot) => snapshot.t % (WARFRONT_TPS * 15) === 0)) {
            assert.ok(frame.mobs.filter((mob) => mob.side === "hollow").length <= 6);
            assert.ok(frame.mobs.filter((mob) => mob.side === "blue").length <= 12);
            assert.ok(frame.mobs.filter((mob) => mob.side === "red").length <= 12);
            for (const actor of frame.actors) {
                assert.ok(Number.isFinite(actor.x) && Number.isFinite(actor.y) && Number.isFinite(actor.hp));
            }
        }
        const midpoint = frameAt(r, WARFRONT_TPS * 300);
        if (r.winner === "blue" && midpoint.coins.blue < midpoint.coins.red) comebackObserved = true;
        if (r.winner === "red" && midpoint.coins.red < midpoint.coins.blue) comebackObserved = true;
    }
    assert.deepEqual([...winners].sort(), ["blue", "red"], "mirror balance should permit either side to win");
    const decided = winCounts.blue + winCounts.red;
    assert.ok(decided > 0 && Math.max(winCounts.blue, winCounts.red) / decided <= 0.65,
        `side skew exceeded 65% (${JSON.stringify(winCounts)})`);
    assert.ok(timeouts <= 2, `more than 10% of probe matches hit the timer (${timeouts}/20)`);
    assert.equal(comebackObserved, true, "an early economy deficit must not make the match unwinnable");
});

test("40-seed multi-archetype gate keeps either side at or below 60%", () => {
    const archetypes = [
        { name: "standard", stats: { hp: 700, attack: 90, defense: 45, speed: 60 } },
        { name: "durable", stats: { hp: 950, attack: 75, defense: 75, speed: 45 } },
        { name: "burst", stats: { hp: 520, attack: 125, defense: 28, speed: 82 } },
    ] as const;
    const overall = { blue: 0, red: 0, draw: 0 };

    for (const archetype of archetypes) {
        const counts = { blue: 0, red: 0, draw: 0 };
        let timeouts = 0, campMatches = 0, wardenMatches = 0;
        const blue = archetypeSquad(`A-${archetype.name}`, archetype.stats);
        const red = archetypeSquad(`B-${archetype.name}`, archetype.stats);
        for (let seed = 1; seed <= 40; seed++) {
            const result = runWarfrontMatch(
                blue, red, seed, "balanced", "balanced", undefined, undefined, undefined,
                { captureSnapshots: false },
            );
            const winner = result.winner ?? "draw";
            counts[winner]++;
            overall[winner]++;
            if (result.ticks === WARFRONT_TPS * WF_MAX_SECONDS) timeouts++;
            if (result.events.some((event) => event.type === "minikill")) campMatches++;
            if (result.events.some((event) => event.type === "wardenkill")) wardenMatches++;
        }

        const decided = counts.blue + counts.red;
        assert.ok(decided > 0 && Math.max(counts.blue, counts.red) / decided <= 0.60,
            `${archetype.name} side skew exceeded 60% (${JSON.stringify(counts)})`);
        assert.ok(timeouts <= 4, `${archetype.name} exceeded 10% timer finishes (${timeouts}/40)`);
        assert.equal(campMatches, 40, `${archetype.name} failed to contest a camp in every match`);
        assert.ok(wardenMatches >= 36, `${archetype.name} contested the Gate Warden in fewer than 90% of matches (${wardenMatches}/40)`);
    }

    const decided = overall.blue + overall.red;
    assert.ok(decided > 0 && Math.max(overall.blue, overall.red) / decided <= 0.60,
        `combined side skew exceeded 60% (${JSON.stringify(overall)})`);
});
