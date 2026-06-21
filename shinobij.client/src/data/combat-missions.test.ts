import { test } from "node:test";
import assert from "node:assert/strict";
import { COMBAT_MISSIONS, combatMissionByKey, missionAiLevelAndBonus } from "./combat-missions";
import { builtinAis, relevelBuiltinAi } from "../lib/combat-ai";
import { starterJutsus } from "./jutsu";
import { isSelfSupportJutsu } from "../lib/jutsu";

// ── Item 2: mission AI aligns to the player's level, floored at the rank min ──
test("missionAiLevelAndBonus tracks the player's level above the rank floor", () => {
    const eRank = combatMissionByKey("combat-e-drill")!; // min 1, rank E
    assert.equal(missionAiLevelAndBonus(eRank, 3).level, 3, "E-rank at lvl 3 = a level-3 foe");
    assert.equal(missionAiLevelAndBonus(eRank, 1).level, 1);
    const dRank = combatMissionByKey("combat-d-errand")!; // min 5, rank D
    assert.equal(missionAiLevelAndBonus(dRank, 3).level, 5, "below the D-rank min (5) floors at 5");
    assert.equal(missionAiLevelAndBonus(dRank, 40).level, 40, "a higher-level player faces a level-40 D-rank, not a trivial fixed foe");
});

test("mission AI level never drops below the rank's min, and bonus scales by rank", () => {
    const bRank = combatMissionByKey("combat-b-escort")!; // min 30, rank B
    assert.equal(missionAiLevelAndBonus(bRank, 5).level, 30, "floored at the rank min");
    assert.equal(missionAiLevelAndBonus(bRank, 45).level, 45);
    // Rank-scaled stat bonus: 0 for the E-Rank trainer, escalating D -> S so the
    // foe is a real fight.
    assert.equal(missionAiLevelAndBonus(combatMissionByKey("combat-e-drill")!, 50).statBonus, 0);
    assert.equal(missionAiLevelAndBonus(combatMissionByKey("combat-d-errand")!, 50).statBonus, 20);
    assert.equal(missionAiLevelAndBonus(combatMissionByKey("combat-c-patrol")!, 50).statBonus, 35);
    assert.equal(missionAiLevelAndBonus(bRank, 50).statBonus, 55);
    assert.equal(missionAiLevelAndBonus(combatMissionByKey("combat-s-crisis")!, 80).statBonus, 90);
});

test("mission AI carries an HP floor so low-level foes aren't one-tapped", () => {
    const dRank = combatMissionByKey("combat-d-errand")!;
    // A D-rank at the level-5 floor has a healthy HP floor so the foe survives a
    // couple of hits instead of being one-tapped by the flat low-level damage.
    assert.ok(missionAiLevelAndBonus(dRank, 3).hp >= 1000, "low-level mission foe has a healthy HP floor");
});

// ── E-Rank Drill: the onboarding "guaranteed win" for level 1-5 players ──────
test("E-Rank Drill is the gentlest mission: min 1, no stat bonus, low HP floor, no-sustain AI", () => {
    const eRank = combatMissionByKey("combat-e-drill")!;
    assert.equal(eRank.min, 1, "available from level 1");
    const e1 = missionAiLevelAndBonus(eRank, 1);
    assert.equal(e1.level, 1);
    assert.equal(e1.statBonus, 0, "weakest possible — no rank stat bonus");
    assert.equal(e1.hp, 600, "low HP floor so the foe dies fast");
    // Squishier than the D-Rank (1400 floor) so it can't out-last a learner.
    const dRank = combatMissionByKey("combat-d-errand")!;
    assert.ok(missionAiLevelAndBonus(eRank, 5).hp < missionAiLevelAndBonus(dRank, 5).hp);
    // Resolves to a real builtin AI whose loadout carries NO self-support move
    // (no heal/shield/etc.), so the foe can't sustain through a weak player.
    const ai = builtinAis.find((a) => a.id === eRank.aiProfileId);
    assert.ok(ai, "E-Rank AI resolves to a real builtin");
    const aiJutsus = ai!.jutsuIds.map((id) => starterJutsus.find((j) => j.id === id)).filter((j): j is NonNullable<typeof j> => Boolean(j));
    assert.ok(aiJutsus.length > 0, "E-Rank AI has a loadout");
    assert.ok(!aiJutsus.some(isSelfSupportJutsu), "E-Rank AI has no self-heal/shield move");
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
    assert.ok(releveled.hp < originalHp, "a level-3 foe's natural HP is below the level-8 original");
    assert.deepEqual(releveled.jutsuIds, originalJutsuIds, "loadout preserved");

    // The shared catalog builtin is untouched.
    assert.equal(sentinel.level, originalLevel);
    assert.equal(sentinel.hp, originalHp);
});

test("relevelBuiltinAi HP floor lifts low-level foes but is a no-op when natural HP is higher", () => {
    const sentinel = builtinAis.find((ai) => ai.id === "builtin-ai-mist-sentinel")!;
    // Floor binds at low level (natural ~340 < 1400).
    assert.equal(relevelBuiltinAi(sentinel, 3, 0, 1400).hp, 1400, "floor lifts a one-tappable low-level foe");
    // Floor is a no-op at higher levels where natural HP already exceeds it.
    const high = relevelBuiltinAi(sentinel, 60, 0, 1400);
    assert.ok(high.hp > 1400, "high-level natural HP is kept (floor doesn't cap)");
});

test("relevelBuiltinAi clamps junk levels into range", () => {
    const sentinel = builtinAis.find((ai) => ai.id === "builtin-ai-mist-sentinel")!;
    assert.equal(relevelBuiltinAi(sentinel, 0, 0).level, 1);
    assert.equal(relevelBuiltinAi(sentinel, Number.NaN, 0).level, 1);
    assert.equal(relevelBuiltinAi(sentinel, 9999, 0).level <= 100, true);
});
