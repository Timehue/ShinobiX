import { test } from "node:test";
import assert from "node:assert/strict";
import { COMBAT_MISSIONS, combatMissionByKey, missionAiLevelAndBonus } from "./combat-missions";
import { builtinAis, relevelBuiltinAi } from "../lib/combat-ai";

// ── Item 2: mission AI aligns to the player's level, floored at the rank min ──
test("missionAiLevelAndBonus tracks the player's level above the rank floor", () => {
    const dRank = combatMissionByKey("combat-d-errand")!; // min 1, rank D
    assert.deepEqual(missionAiLevelAndBonus(dRank, 3), { level: 3, statBonus: 0 }, "D-rank at lvl 3 = a level-3 unboosted foe (was level-8 +30)");
    assert.deepEqual(missionAiLevelAndBonus(dRank, 1), { level: 1, statBonus: 0 });
    assert.equal(missionAiLevelAndBonus(dRank, 40).level, 40, "a higher-level player faces a level-40 D-rank, not a trivial level-8");
});

test("mission AI level never drops below the rank's min, and bonus scales by rank", () => {
    const bRank = combatMissionByKey("combat-b-escort")!; // min 30, rank B
    assert.equal(missionAiLevelAndBonus(bRank, 5).level, 30, "floored at the rank min");
    assert.equal(missionAiLevelAndBonus(bRank, 45).level, 45);
    // Rank-scaled stat bonus: D unboosted, escalating up to S.
    assert.equal(missionAiLevelAndBonus(combatMissionByKey("combat-d-errand")!, 50).statBonus, 0);
    assert.equal(missionAiLevelAndBonus(combatMissionByKey("combat-c-patrol")!, 50).statBonus, 6);
    assert.equal(missionAiLevelAndBonus(bRank, 50).statBonus, 12);
    assert.equal(missionAiLevelAndBonus(combatMissionByKey("combat-s-crisis")!, 80).statBonus, 24);
});

test("every combat mission's AI id resolves to a real builtin", () => {
    for (const m of COMBAT_MISSIONS) {
        assert.ok(builtinAis.some((ai) => ai.id === m.aiProfileId), `${m.key} -> ${m.aiProfileId} must exist`);
    }
});

// ── relevelBuiltinAi rebuilds a foe at the target level, preserving identity ─
test("relevelBuiltinAi lowers a builtin to the player's level without mutating the catalog", () => {
    const sentinel = builtinAis.find((ai) => ai.id === "builtin-ai-mist-sentinel")!;
    const originalLevel = sentinel.level;   // 8
    const originalHp = sentinel.hp;
    const originalJutsuIds = [...sentinel.jutsuIds];

    const releveled = relevelBuiltinAi(sentinel, 3, 0);
    assert.equal(releveled.id, sentinel.id, "identity (id) preserved");
    assert.equal(releveled.name, sentinel.name);
    assert.equal(releveled.level, 3, "re-leveled to the player's level");
    assert.ok(releveled.hp < originalHp, "a level-3 foe has less HP than the level-8 original");
    assert.deepEqual(releveled.jutsuIds, originalJutsuIds, "loadout preserved");

    // The shared catalog builtin is untouched.
    assert.equal(sentinel.level, originalLevel);
    assert.equal(sentinel.hp, originalHp);
});

test("relevelBuiltinAi clamps junk levels into range", () => {
    const sentinel = builtinAis.find((ai) => ai.id === "builtin-ai-mist-sentinel")!;
    assert.equal(relevelBuiltinAi(sentinel, 0, 0).level, 1);
    assert.equal(relevelBuiltinAi(sentinel, Number.NaN, 0).level, 1);
    assert.equal(relevelBuiltinAi(sentinel, 9999, 0).level <= 100, true);
});
