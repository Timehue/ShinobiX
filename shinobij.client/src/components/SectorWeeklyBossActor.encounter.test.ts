import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * The roaming Weekly Boss's in-sector encounter, pinned at the source (it is a
 * timer/RAF loop over live DOM, so it is read rather than executed — the same
 * shape SectorWanderer.encounter.test.ts uses for the road wanderers).
 */
const source = readFileSync(new URL("./SectorWeeklyBossActor.tsx", import.meta.url), "utf8");

function constant(name: string): number {
    const match = source.match(new RegExp(`const ${name} = ([0-9.]+)`));
    assert.ok(match, `${name} must exist in SectorWeeklyBossActor.tsx`);
    return Number(match![1]);
}

test("reduced motion drops the animation, not the boss encounter", () => {
    // The actor used to return early — `if (prefersReducedMotion()) { paint(); return; }`
    // — leaving the boss frozen on its home tile in the top row, which a phone's
    // board edge mostly clips. Reduced-motion players never met the roaming boss
    // unless they found and tapped a sliver of it. SectorWanderer made this exact
    // fix earlier; the boss had been forked from it before, and kept the bug.
    assert.doesNotMatch(source, /prefersReducedMotion\(\)\) \{ paint\(\); return; \}/u,
        "reduced motion must not skip the stalk loop outright");
    assert.match(source, /const reduced = prefersReducedMotion\(\)/u);
    assert.match(source, /stepTimerRef\.current = window\.setTimeout\(\(\) => tick\(performance\.now\(\)\), REDUCED_STEP_MS\)/u,
        "reduced motion must still advance the boss, in discrete steps");
    assert.match(source, /else rafRef\.current = requestAnimationFrame\(tick\)/u);
    assert.match(source, /cancelAnimationFrame\(rafRef\.current\)/u);
    assert.match(source, /window\.clearTimeout\(stepTimerRef\.current\)/u,
        "the reduced-motion timer is torn down with the sector");
    assert.match(source, /const maxDt = reduced \? REDUCED_STEP_MS \/ 1000 : SMOOTH_MAX_DT/u);
});

test("a reduced-motion step keeps the stalk speed but never teleports", () => {
    const tilesPerStep = (constant("WALK_TILES_PER_SEC") * constant("REDUCED_STEP_MS")) / 1000;
    assert.ok(tilesPerStep <= 1.0 + 1e-9, `a step moves ${tilesPerStep.toFixed(2)} tiles at once; keep it to one tile or less`);
    assert.ok(tilesPerStep >= 0.5, `a step of ${tilesPerStep.toFixed(2)} tiles means a needlessly busy timer`);
    // Contact still engages at any step size: within one step the boss snaps onto
    // the player's tile, which is inside its engage radius.
    assert.match(source, /if \(dist <= step \|\| dist < 0\.02\) \{\s*posRef\.current = \{ col: tCol, row: tRow \};/u);
});
