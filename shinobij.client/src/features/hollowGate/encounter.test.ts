import { test } from "node:test";
import assert from "node:assert/strict";
import {
    pickShrineEncounter,
    HOLLOW_GATE_FLOOR_HP_STEP,
    HOLLOW_GATE_FLOOR_STAT_STEP,
} from "./encounter";
import type { CreatorAi } from "../types/creator-ai";

// Minimal AI fixtures — enough for the pick + scaling math.
function fakeAi(id: string, level: number, boss = false): CreatorAi {
    const stat = 50;
    return {
        id, name: id, icon: "", level, village: "leaf",
        hp: 1000, chakra: 100, stamina: 100,
        stats: {
            strength: stat, speed: stat, intelligence: stat, willpower: stat,
            bukijutsuOffense: stat, bukijutsuDefense: stat, taijutsuOffense: stat, taijutsuDefense: stat,
            genjutsuOffense: stat, genjutsuDefense: stat, ninjutsuOffense: stat, ninjutsuDefense: stat,
        } as CreatorAi["stats"],
        jutsuIds: [], rules: [], isBossAi: boss,
    };
}

const POOL: CreatorAi[] = [fakeAi("mob-a", 40), fakeAi("mob-b", 42), fakeAi("boss-hollow-gate-warden", 45, true)];
const base = { playableAis: POOL, playerLevel: 40, bossDisplayName: "Hollow Gate Warden" };

test("non-boss depth ramp: floor 1 is baseline, deeper floors stiffen", () => {
    const f1 = pickShrineEncounter({ ...base, floor: 1, maxFloor: 9, opts: {} });
    assert.ok(f1);
    assert.equal(f1.floorHpMult, 1, "floor 1 = baseline HP");
    assert.equal(f1.floorStatMult, 1, "floor 1 = baseline stats");

    const f9 = pickShrineEncounter({ ...base, floor: 9, maxFloor: 9, opts: {} });
    assert.ok(f9);
    // depth = 8 → 1 + 8*step
    assert.ok(Math.abs(f9.floorHpMult - (1 + 8 * HOLLOW_GATE_FLOOR_HP_STEP)) < 1e-9, "floor 9 HP ramp");
    assert.ok(Math.abs(f9.floorStatMult - (1 + 8 * HOLLOW_GATE_FLOOR_STAT_STEP)) < 1e-9, "floor 9 stat ramp");
    assert.ok(f9.floorHpMult > f1.floorHpMult, "deeper is strictly harder");
});

test("the boss is exempt from the depth ramp (it has its own stronger scaling)", () => {
    const boss = pickShrineEncounter({ ...base, floor: 9, maxFloor: 9, opts: { isBoss: true } });
    assert.ok(boss);
    assert.equal(boss.floorHpMult, 1, "boss floor HP mult stays 1 (no double-scaling)");
    assert.equal(boss.floorStatMult, 1, "boss floor stat mult stays 1");
    // The boss carries its own ramp instead: floor 9 of 9 → +15 levels, 1.4× HP.
    assert.equal(boss.rebasedLevel, 55, "boss at player+15");
    assert.ok(Math.abs(boss.bossHpMultiplier - 1.4) < 1e-9, "boss HP 1.4× on the final floor");
});

test("ramp is absolute-floor based: floor 3 identical across gate lengths", () => {
    const inNine = pickShrineEncounter({ ...base, floor: 3, maxFloor: 9, opts: {} });
    const inThree = pickShrineEncounter({ ...base, floor: 3, maxFloor: 3, opts: {} });
    assert.ok(inNine && inThree);
    assert.equal(inNine.floorHpMult, inThree.floorHpMult, "floor 3 is floor 3, whatever the gate length");
});
