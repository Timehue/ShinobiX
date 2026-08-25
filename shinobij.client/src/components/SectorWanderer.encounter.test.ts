import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * Road-encounter rules, pinned at the source.
 *
 * SectorWanderer drives a requestAnimationFrame loop over live DOM, so these
 * are read off the module rather than executed — the same shape the WorldMap
 * projection contract uses. What matters here is not the exact numbers but the
 * RELATIONSHIPS between them, which is what makes an ambush an ambush.
 *
 * ⚖ OWNER RULING (2026-08-25): wanderers are SUPPOSED to approach you and
 * ambushes are SUPPOSED to happen. The rate must come from logic, not from a
 * toggle and not from a flat roll — so the encounter rules live or die on
 * whether a hunter has to actually find the player.
 */
const source = readFileSync(new URL("./SectorWanderer.tsx", import.meta.url), "utf8");

function constant(name: string): number {
    const match = source.match(new RegExp(`const ${name} = ([0-9.]+)`));
    assert.ok(match, `${name} must exist in SectorWanderer.tsx`);
    return Number(match![1]);
}

test("a hunter has to find the player, and commits once it has", () => {
    const spot = constant("HUNT_SPOT_TILES");
    const leash = constant("HUNT_LEASH_TILES");

    // The bug this replaced: `if (armed && (isHunter || distPlayer <= NOTICE_TILES))`
    // pathed a bandit to the player from ANYWHERE on the board, so every sector
    // holding one was a guaranteed forced modal within seconds of arrival.
    assert.doesNotMatch(source, /armed && \(isHunter \|\|/u,
        "a hunter must not target the player from anywhere on the board");
    assert.match(source, /if \(armed && closing\)/u);
    assert.match(source, /distPlayer <= HUNT_SPOT_TILES\) huntingRef\.current = true/u);
    assert.match(source, /distPlayer > HUNT_LEASH_TILES\) huntingRef\.current = false/u);

    // Hysteresis: giving up at the same distance it spots you would make a
    // hunter yo-yo on the edge of its own circle instead of chasing.
    assert.ok(leash > spot, `leash ${leash} must be wider than the spot radius ${spot}`);

    // A hunter notices further than a passive wanderer greets — it is looking
    // for you — but not so far that the whole 12x12 board is one trigger.
    const notice = constant("NOTICE_TILES");
    assert.ok(spot > notice, `hunters (${spot}) must notice further than greeters (${notice})`);
    assert.ok(spot < 12, `a spot radius of ${spot} covers the whole board — that is not an ambush`);
});

test("arriving in a sector leaves time to read it before anyone closes in", () => {
    const arm = constant("ARM_DELAY_MS");
    assert.ok(arm >= 2_000, `${arm}ms is not long enough to read the sector panel before an encounter`);
});

test("reduced motion drops the animation, not the encounter", () => {
    // This used to be `if (prefersReducedMotion()) { paint(); return; }`, which
    // exempted those players from every road ambush in the game. Motion
    // preference is about tweening, not about which world you are playing in.
    assert.doesNotMatch(source, /prefersReducedMotion\(\)\) \{ paint\(\); return; \}/u,
        "reduced motion must not skip the encounter loop outright");
    assert.match(source, /const reduced = prefersReducedMotion\(\)/u);
    assert.match(source, /stepTimerRef\.current = window\.setTimeout\(\(\) => tick\(performance\.now\(\)\), REDUCED_STEP_MS\)/u,
        "reduced motion must still advance the wanderer, in discrete steps");
    assert.match(source, /else rafRef\.current = requestAnimationFrame\(tick\)/u);

    // Both schedulers must be torn down, or a reduced-motion timer outlives the
    // sector and keeps stalking a player who has already travelled on.
    assert.match(source, /cancelAnimationFrame\(rafRef\.current\)/u);
    assert.match(source, /window\.clearTimeout\(stepTimerRef\.current\)/u);

    // The per-frame clamp must scale with the step, or a slow tick would move
    // the wanderer the same distance a 16ms frame does and it would crawl.
    assert.match(source, /const maxDt = reduced \? REDUCED_STEP_MS \/ 1000 : SMOOTH_MAX_DT/u);
    assert.match(source, /Math\.min\(maxDt,/u);
});

test("the reduced-motion step keeps the speed but never makes a big jump", () => {
    // Two things have to hold at once, and they pull against each other.
    const stepMs = constant("REDUCED_STEP_MS");
    const tilesPerSec = constant("WALK_TILES_PER_SEC");
    const tilesPerStep = (tilesPerSec * stepMs) / 1000;

    // 1. SPEED PARITY. Ground covered per second is identical to the animated
    //    path (it falls out of dt scaling), so a hunter closes in over the same
    //    number of seconds and the encounter is the same encounter.
    // 2. NO LARGE JUMPS. A coarser timer would also preserve the speed — by
    //    teleporting the wanderer several tiles at a time, which is worse for a
    //    reduced-motion player than the tween they asked to avoid.
    assert.ok(tilesPerStep <= 1.0 + 1e-9,
        `a reduced-motion step moves ${tilesPerStep.toFixed(2)} tiles at once; keep it to one tile or less`);
    assert.ok(tilesPerStep >= 0.5,
        `a reduced-motion step of ${tilesPerStep.toFixed(2)} tiles means a needlessly busy timer`);
});
