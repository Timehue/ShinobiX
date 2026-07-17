/*
 * Parity guard for the entry-chunk story-boss split.
 *
 * lib/combat-ai builds storyBossAis from data/story-boss-meta (compact facts)
 * so the boot-critical entry chunk never carries data/storylines' story prose.
 * The cost of that split is one deliberate duplication: boss names/icons/levels
 * are authored BOTH in the milestone(...) calls in storylines.ts AND in
 * VILLAGE_BOSSES in story-boss-meta.ts. This suite is what makes the
 * duplication safe — any rename, reorder, added or removed chapter on either
 * side fails here with the exact mismatch.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { storylines } from "./storylines";
import { storyBossMeta, bossScaleByLevel, storyAiId } from "./story-boss-meta";

test("story-boss-meta mirrors the storylines chapter meta exactly, in order", () => {
    const derived = Object.entries(storylines).flatMap(([village, steps]) => steps.map((step) => ({
        village,
        levelReq: step.levelReq,
        bossName: step.bossName,
        bossIcon: step.bossIcon,
        bossHp: step.bossHp,
        bossDamage: step.bossDamage,
        aiProfileId: step.aiProfileId,
    })));
    const meta = storyBossMeta.map((m) => ({
        village: m.village,
        levelReq: m.levelReq,
        bossName: m.bossName,
        bossIcon: m.bossIcon,
        bossHp: m.bossHp,
        bossDamage: m.bossDamage,
        aiProfileId: m.aiProfileId,
    }));
    assert.deepEqual(meta, derived);
});

test("every storylines chapter reward matches the shared scale table", () => {
    // storylines imports bossScaleByLevel from story-boss-meta, so this can
    // only fail if a milestone stops deriving from the table (a fork risk the
    // split must never reintroduce).
    for (const [village, steps] of Object.entries(storylines)) {
        for (const step of steps) {
            const scale = bossScaleByLevel[step.levelReq];
            assert.ok(scale, `${village} L${step.levelReq}: no scale-table entry`);
            assert.equal(step.bossHp, scale.hp, `${village} L${step.levelReq} bossHp`);
            assert.equal(step.bossDamage, scale.damage, `${village} L${step.levelReq} bossDamage`);
            assert.equal(step.rewardXp, scale.xp, `${village} L${step.levelReq} rewardXp`);
            assert.equal(step.rewardRyo, scale.ryo, `${village} L${step.levelReq} rewardRyo`);
            assert.equal(step.aiProfileId, storyAiId(village, step.levelReq), `${village} L${step.levelReq} aiProfileId`);
        }
    }
});
