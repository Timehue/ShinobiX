import { test } from "node:test";
import assert from "node:assert/strict";
import {
    pickShrineEncounter,
    scaleAffixStats,
    RIFT_MOB_SCALE,
    HOLLOW_GATE_FLOOR_HP_STEP,
    HOLLOW_GATE_FLOOR_STAT_STEP,
} from "./encounter";
import { aiHpForLevel, aiStatsForLevel } from "../../lib/ai-stats";
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

test("legacy encounter picker can never surface a shinobi identity or portrait", () => {
    const encounter = pickShrineEncounter({ ...base, floor: 1, maxFloor: 5, opts: {} });
    assert.ok(encounter);
    assert.equal(encounter.encounterName, "Hollow Hound");
    assert.equal(encounter.baseAi.name, "Hollow Hound");
    assert.equal(encounter.baseAi.icon, "🐺");
    assert.equal(encounter.baseAi.image, "/pet-poses/mythic-4-idle.webp");
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

test("gentleNonBoss rebuilds a non-boss ambush as a fair peer (rift tone-down)", () => {
    // A beefy above-player AI that would normally fight at its OWN monster HP.
    const beefy = fakeAi("mob-beefy", 52); // within player+15 band
    beefy.hp = 20_000;
    const pool = [beefy, fakeAi("boss-hollow-gate-warden", 45, true)];
    const args = { playableAis: pool, playerLevel: 40, bossDisplayName: "Warden", floor: 1, maxFloor: 1 };

    const normal = pickShrineEncounter({ ...args, opts: { isAmbush: true } });
    const gentle = pickShrineEncounter({ ...args, opts: { isAmbush: true }, gentleNonBoss: true });
    assert.ok(normal && gentle);
    // Normal keeps the AI's own monster HP + its above-player nameplate…
    assert.equal(normal.baseAi.hp, 20_000);
    assert.equal(normal.rebasedLevel, 52);
    // …gentle rebuilds it as a peer: player-level nameplate + far smaller HP + a
    // real distributed stat block (not the flat fixture stats).
    assert.equal(gentle.rebasedLevel, 40, "peer nameplate = player level");
    // Mob-scaled: 0.9× a peer stat/HP block at the player's level.
    assert.ok(RIFT_MOB_SCALE < 1, "mob scale is sub-peer");
    assert.equal(gentle.baseAi.hp, Math.max(1, Math.floor(aiHpForLevel(40) * RIFT_MOB_SCALE)), "0.9x peer HP");
    assert.deepEqual(gentle.baseAi.stats, scaleAffixStats(aiStatsForLevel(40), RIFT_MOB_SCALE), "0.9x peer stats");
    assert.ok(gentle.baseAi.hp < 20_000, "far below the monster pool HP");

    // The boss is never gentled — it keeps its own player+15 / 1.4× ramp.
    const boss = pickShrineEncounter({ ...args, opts: { isBoss: true }, gentleNonBoss: true });
    assert.ok(boss);
    assert.equal(boss.rebasedLevel, 55, "boss still player+15 on a 1-floor gate");
});

test("ramp is absolute-floor based: floor 3 identical across gate lengths", () => {
    const inNine = pickShrineEncounter({ ...base, floor: 3, maxFloor: 9, opts: {} });
    const inThree = pickShrineEncounter({ ...base, floor: 3, maxFloor: 3, opts: {} });
    assert.ok(inNine && inThree);
    assert.equal(inNine.floorHpMult, inThree.floorHpMult, "floor 3 is floor 3, whatever the gate length");
});
