import { test } from "node:test";
import assert from "node:assert/strict";
import type { Character } from "../types/character";
import {
    masteryLevel, masteryPointsSpent, masteryPointsAvailable, pointsInPath,
    canIncrement, incrementNode, sanitizeSpec, masteryBonus, masteryHasCapstone,
    MASTERY_MAX_LEVEL, MASTERY_XP_PER_LEVEL,
} from "./profession-mastery";

// Rank-10 XP wall (last finite threshold): baseline 32850, healer ×1.5 = 49275.
const VANGUARD_CAP = 32_850;
const HEALER_CAP = 49_275;

function char(profession: string, professionXp: number, masterySpec: Record<string, number> = {}): Character {
    return { profession, professionXp, masterySpec } as unknown as Character;
}

test("masteryLevel: 0 until past the rank-10 wall, then scales and caps at 10", () => {
    assert.equal(masteryLevel(char("vanguard", VANGUARD_CAP)), 0);
    assert.equal(masteryLevel(char("vanguard", VANGUARD_CAP + MASTERY_XP_PER_LEVEL - 1)), 0);
    assert.equal(masteryLevel(char("vanguard", VANGUARD_CAP + MASTERY_XP_PER_LEVEL)), 1);
    assert.equal(masteryLevel(char("vanguard", VANGUARD_CAP + 6 * MASTERY_XP_PER_LEVEL)), 6);
    assert.equal(masteryLevel(char("vanguard", VANGUARD_CAP + 999 * MASTERY_XP_PER_LEVEL)), MASTERY_MAX_LEVEL);
});

test("masteryLevel: healer uses the 1.5x XP wall", () => {
    assert.equal(masteryLevel(char("healer", HEALER_CAP)), 0);
    assert.equal(masteryLevel(char("healer", HEALER_CAP + MASTERY_XP_PER_LEVEL)), 1);
    // baseline-cap XP isn't enough for a healer (higher wall)
    assert.equal(masteryLevel(char("healer", VANGUARD_CAP + MASTERY_XP_PER_LEVEL)), 0);
});

test("points spent / available track the spec and the budget", () => {
    const c = char("vanguard", VANGUARD_CAP + 5 * MASTERY_XP_PER_LEVEL, { "seal-gap": 3, "seal-cap": 1 });
    assert.equal(masteryPointsSpent(c), 4);
    assert.equal(masteryPointsAvailable(c), 1); // level 5 - 4 spent
});

test("pointsInPath ignores capstones and other paths", () => {
    const c = char("healer", HEALER_CAP + 6 * MASTERY_XP_PER_LEVEL, { "heal-cooldown": 3, "heal-tireless": 2, "heal-xp": 1 });
    assert.equal(pointsInPath(c, "triage"), 5);       // cooldown 3 + tireless 2
    assert.equal(pointsInPath(c, "restoration"), 1);  // heal-xp 1
});

test("canIncrement enforces max rank, budget, and the capstone gate", () => {
    // maxed node
    assert.equal(canIncrement(char("healer", HEALER_CAP + 6 * MASTERY_XP_PER_LEVEL, { "heal-cooldown": 3 }), "heal-cooldown").ok, false);
    // no points left (level 1, already spent 1)
    assert.equal(canIncrement(char("healer", HEALER_CAP + MASTERY_XP_PER_LEVEL, { "heal-tireless": 1 }), "heal-xp").ok, false);
    // capstone gate not met (only 3 in path, need 4)
    assert.equal(canIncrement(char("healer", HEALER_CAP + 9 * MASTERY_XP_PER_LEVEL, { "heal-cooldown": 3 }), "chakra-conduit").ok, false);
    // capstone gate met (4 in path) + points available
    assert.equal(canIncrement(char("healer", HEALER_CAP + 9 * MASTERY_XP_PER_LEVEL, { "heal-cooldown": 3, "heal-tireless": 1 }), "chakra-conduit").ok, true);
});

test("incrementNode adds a legal rank, no-ops an illegal one", () => {
    const c = char("petTamer", VANGUARD_CAP + 3 * MASTERY_XP_PER_LEVEL, {});
    assert.deepEqual(incrementNode(c, "exp-rewards"), { "exp-rewards": 1 });
    // illegal (capstone gate) → unchanged
    assert.deepEqual(incrementNode(char("petTamer", VANGUARD_CAP + 3 * MASTERY_XP_PER_LEVEL, {}), "caravan-master"), {});
});

test("sanitizeSpec clamps to budget and drops ungated capstones (anti-tamper)", () => {
    // Forged spec: everything maxed + capstone, but budget is only 4.
    const forged = { "heal-cooldown": 3, "heal-tireless": 3, "chakra-conduit": 1, "heal-xp": 3 };
    const cleaned = sanitizeSpec("healer", forged, 4);
    assert.ok(masterySpecTotal("healer", cleaned) <= 4);
    assert.ok(!cleaned["chakra-conduit"]); // can't afford / gate after clamp

    // Legal full path within budget 8 keeps the capstone.
    const legal = sanitizeSpec("healer", { "heal-cooldown": 3, "heal-tireless": 3, "chakra-conduit": 1 }, 8);
    assert.equal(legal["chakra-conduit"], 1);
});

test("masteryBonus sums perRank × ranks; capstones are boolean", () => {
    const c = char("petTamer", VANGUARD_CAP + 8 * MASTERY_XP_PER_LEVEL, { "exp-rewards": 3, "exp-materials": 2, "caravan-master": 1 });
    assert.equal(masteryBonus(c, "expRewardPct"), 15); // 5 × 3
    assert.equal(masteryBonus(c, "expMaterialPct"), 10); // 5 × 2
    assert.equal(masteryHasCapstone(c, "caravan-master"), true);
    assert.equal(masteryHasCapstone(c, "alpha-bond"), false);
});

// tiny local re-implementation of "points spent" for an arbitrary spec, for the
// sanitize assertion above (avoids needing a Character wrapper).
function masterySpecTotal(profession: string, spec: Record<string, number>): number {
    // capstones cost 2, nodes cost 1
    let t = 0;
    for (const [id, ranks] of Object.entries(spec)) {
        t += (id.includes("master") || ["chakra-conduit", "full-recovery", "village-lifeline", "warmonger", "logistician", "ironclad", "caravan-master", "alpha-bond", "prodigy"].includes(id)) ? ranks * 2 : ranks * 1;
    }
    return t;
}
