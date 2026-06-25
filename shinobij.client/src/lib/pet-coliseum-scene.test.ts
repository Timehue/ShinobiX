import { test } from "node:test";
import assert from "node:assert/strict";
import {
    tileToWorld,
    poseMotion,
    shakeAmpForBeat,
    lerp,
    faceOffPositions,
    spreadPositions,
    lungeReach,
    beatTimeline,
    beatChoreoMs,
    LEAP_HEIGHT,
    arenaObstaclePlacements,
    cameraForCombatants,
    spriteBoundsFromAlpha,
    groundedSpriteLayout,
    formationSlots,
    formationAnchor,
    engagementAdvance,
    classifyMoveChoreo,
    moveChoreoMods,
    moveFxKey,
    meleeContactFx,
    meleeLungeReach,
    COLISEUM_COLS,
    COLISEUM_ROWS,
} from "./pet-coliseum-scene.ts";

// Build a flat RGBA buffer with an opaque rectangle [x0,x1)×[y0,y1) (px coords).
function rgbaWithRect(w: number, h: number, x0: number, y0: number, x1: number, y1: number): number[] {
    const buf = new Array(w * h * 4).fill(0);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) buf[(y * w + x) * 4 + 3] = 255;
    return buf;
}

test("tileToWorld centres the middle tile near origin", () => {
    const mid = ((COLISEUM_ROWS - 1) >> 1) * COLISEUM_COLS + ((COLISEUM_COLS - 1) >> 1);
    const { x, z } = tileToWorld(mid);
    assert.ok(Math.abs(x) < 0.6, `mid x ~0, got ${x}`);
    assert.ok(Math.abs(z) < 0.6, `mid z ~0, got ${z}`);
});

test("tileToWorld maps columns left→right and rows back→front", () => {
    const left = tileToWorld(0);                       // col 0, row 0
    const right = tileToWorld(COLISEUM_COLS - 1);       // last col, row 0
    assert.ok(left.x < right.x, "col 0 is left of last col");
    const back = tileToWorld(0);                        // row 0 (back)
    const front = tileToWorld((COLISEUM_ROWS - 1) * COLISEUM_COLS); // last row (front)
    assert.ok(back.z < front.z, "row 0 is farther (smaller z) than the last row");
});

test("tileToWorld never NaNs on out-of-range / non-finite input", () => {
    for (const t of [-5, 9999, NaN, Infinity]) {
        const { x, z } = tileToWorld(t);
        assert.ok(Number.isFinite(x) && Number.isFinite(z), `finite for ${t}`);
    }
});

test("poseMotion: lunge drives toward the foe, recoil away (per side)", () => {
    // Player faces +x.
    assert.ok(poseMotion("lunge", 1).dx > 0, "player lunge +x");
    assert.ok(poseMotion("recoil", 1).dx < 0, "player recoil -x");
    // Enemy faces -x → mirrored.
    assert.ok(poseMotion("lunge", -1).dx < 0, "enemy lunge -x");
    assert.ok(poseMotion("recoil", -1).dx > 0, "enemy recoil +x");
});

test("poseMotion: KO topples (non-zero tilt) and fades", () => {
    const ko = poseMotion("ko", 1);
    assert.notEqual(ko.rot, 0, "ko tilts");
    assert.ok(ko.opacity < 1, "ko fades");
});

test("poseMotion: hit flashes hurt, idle is neutral", () => {
    assert.equal(poseMotion("hit", 1).hurt, 1);
    const idle = poseMotion("idle", 1);
    assert.equal(idle.hurt, 0);
    assert.equal(idle.dx, 0);
    assert.equal(idle.sx, 1);
});

test("shakeAmpForBeat: KO > crit > heavy > none, and only on contact beats", () => {
    const base = { isKO: false, crit: false, signature: false, heavyHit: false };
    assert.ok(shakeAmpForBeat("ko", { ...base, isKO: true }) > shakeAmpForBeat("impact", { ...base, crit: true }));
    assert.ok(shakeAmpForBeat("impact", { ...base, crit: true }) > shakeAmpForBeat("impact", { ...base, heavyHit: true }));
    assert.equal(shakeAmpForBeat("lunge", { ...base, crit: true }), 0, "non-contact beat = no shake");
    // Every contact now shakes a little, but a routine hit < a heavy one.
    assert.ok(shakeAmpForBeat("impact", base) > 0, "routine impact still gets a small punch");
    assert.ok(shakeAmpForBeat("impact", base) < shakeAmpForBeat("impact", { ...base, heavyHit: true }), "routine < heavy");
});

test("lerp basics", () => {
    assert.equal(lerp(0, 10, 0), 0);
    assert.equal(lerp(0, 10, 1), 10);
    assert.equal(lerp(0, 10, 0.5), 5);
});

test("spriteBoundsFromAlpha: finds the opaque box, normalized", () => {
    // 10×10 image, opaque rect spanning px x∈[2,8) y∈[3,9).
    const b = spriteBoundsFromAlpha(rgbaWithRect(10, 10, 2, 3, 8, 9), 10, 10);
    assert.equal(b.left, 0.2);
    assert.equal(b.right, 0.8);   // (7+1)/10
    assert.equal(b.top, 0.3);
    assert.equal(b.bottom, 0.9);  // (8+1)/10
});

test("spriteBoundsFromAlpha: fully transparent → full frame", () => {
    const b = spriteBoundsFromAlpha(new Array(4 * 4 * 4).fill(0), 4, 4);
    assert.deepEqual(b, { left: 0, right: 1, top: 0, bottom: 1 });
});

test("spriteBoundsFromAlpha: respects the alpha threshold", () => {
    const buf = new Array(4 * 4 * 4).fill(0);
    buf[(1 * 4 + 1) * 4 + 3] = 5;   // below threshold → ignored
    buf[(2 * 4 + 2) * 4 + 3] = 200; // above → counts
    const b = spriteBoundsFromAlpha(buf, 4, 4, 12);
    assert.equal(b.left, 0.5);  // only px (2,2)
    assert.equal(b.top, 0.5);
});

test("groundedSpriteLayout: visible feet land at y=0", () => {
    // Subject occupies the middle vertically with padding above + below.
    const bounds = { left: 0.25, right: 0.75, top: 0.2, bottom: 0.8 };
    const L = groundedSpriteLayout(bounds, 1, 2.4, false);
    // Content height = targetH.
    assert.ok(Math.abs(L.contentWorldH - 2.4) < 1e-9, `content ~2.4, got ${L.contentWorldH}`);
    // The content's bottom edge sits at world y=0: planeBottomLocal + meshY.
    const contentBottomLocal = L.planeH * (0.5 - bounds.bottom); // plane-local y of content bottom
    assert.ok(Math.abs(contentBottomLocal + L.meshY) < 1e-9, "content bottom anchored to feet (y=0)");
});

test("groundedSpriteLayout: mirror flips the horizontal recenter", () => {
    // Subject pushed to the image's left → un-mirrored recenter pushes right (+x),
    // mirrored pushes the opposite way.
    const bounds = { left: 0.1, right: 0.5, top: 0.1, bottom: 0.9 };
    const a = groundedSpriteLayout(bounds, 1, 2.4, false);
    const m = groundedSpriteLayout(bounds, 1, 2.4, true);
    assert.ok(a.meshX > 0, "left-heavy art recenters to +x");
    assert.ok(Math.abs(a.meshX + m.meshX) < 1e-9, "mirror negates the x recenter");
});

test("formationSlots: 1v1 = centered face-off, sides split", () => {
    const [p, e] = formationSlots(["player", "enemy"]);
    assert.ok(p.x < 0 && e.x > 0, "player left, enemy right");
    assert.ok(Math.abs(p.x) === Math.abs(e.x), "symmetric");
    assert.ok(e.x - p.x >= 5, "wide central gap (no overlap)");
});

test("formationSlots: 2v2 — all four pairwise separated, lead≠reserve", () => {
    const slots = formationSlots(["player", "player", "enemy", "enemy"]);
    // Lead (idx 0) and reserve (idx 1) per side differ in x AND z (depth stagger).
    assert.notEqual(slots[0].x, slots[1].x);
    assert.notEqual(slots[0].z, slots[1].z);
    // Every pair is separated enough that sprites (≤2.3 wide) can't overlap when
    // they differ in x, or are depth-staggered when x is close.
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
        const dx = Math.abs(slots[i].x - slots[j].x);
        const dz = Math.abs(slots[i].z - slots[j].z);
        assert.ok(dx >= 1.4 || dz >= 2.0, `pair ${i},${j} separated (dx=${dx.toFixed(1)} dz=${dz.toFixed(1)})`);
    }
});

test("formationAnchor: lane 0 inner+front, lane 1 outer+back", () => {
    const lead = formationAnchor("player", 0);
    const res = formationAnchor("player", 1);
    assert.ok(Math.abs(res.x) > Math.abs(lead.x), "reserve is further out");
    assert.ok(res.z < lead.z, "reserve is further back");
});

test("engagementAdvance: close fights advance, far ones don't, always capped", () => {
    assert.ok(engagementAdvance(1) > engagementAdvance(5), "closer → more advance");
    assert.equal(engagementAdvance(8), 0, "far apart → no advance");
    assert.ok(engagementAdvance(0) <= 0.75 + 1e-9, "advance is capped");
    // Even at max advance from both sides, a 1v1 keeps a safe gap.
    const [p, e] = formationSlots(["player", "enemy"]);
    const adv = engagementAdvance(1);
    const gap = (e.x - adv) - (p.x + adv);
    assert.ok(gap >= 2.6, `melee gap stays > sprite width, got ${gap.toFixed(2)}`);
});

test("groundedSpriteLayout: plane width tracks image aspect", () => {
    const bounds = { left: 0.2, right: 0.8, top: 0.1, bottom: 0.9 };
    const sq = groundedSpriteLayout(bounds, 1, 2.4, false);
    const wide = groundedSpriteLayout(bounds, 1.5, 2.4, false);
    assert.ok(Math.abs(wide.planeW - sq.planeW * 1.5) < 1e-9, "planeW scales with aspect");
    assert.equal(wide.planeH, sq.planeH, "planeH independent of aspect");
});

test("faceOffPositions: adjacent tiles get pushed apart, far tiles untouched", () => {
    // Adjacent columns on the same row (~0.65 world units apart) must separate.
    const mid = 3 * COLISEUM_COLS + 6;
    const near = faceOffPositions(mid, mid + 1);
    const nearGap = Math.hypot(near.b.x - near.a.x, near.b.z - near.a.z);
    assert.ok(nearGap >= 1.69, `adjacent gap pushed to >= MIN_SEP, got ${nearGap}`);
    // Push is symmetric: midpoint preserved.
    const rawA = tileToWorld(mid), rawB = tileToWorld(mid + 1);
    assert.ok(Math.abs((near.a.x + near.b.x) / 2 - (rawA.x + rawB.x) / 2) < 1e-9, "midpoint preserved");
    // Far apart (start columns 1 vs 12) — unchanged.
    const far = faceOffPositions(3 * COLISEUM_COLS + 1, 3 * COLISEUM_COLS + 12);
    assert.deepEqual(far.a, tileToWorld(3 * COLISEUM_COLS + 1));
    assert.deepEqual(far.b, tileToWorld(3 * COLISEUM_COLS + 12));
});

test("faceOffPositions: same tile still separates (no NaN)", () => {
    const t = 3 * COLISEUM_COLS + 6;
    const { a, b } = faceOffPositions(t, t);
    const gap = Math.hypot(b.x - a.x, b.z - a.z);
    assert.ok(Number.isFinite(gap) && gap >= 1.69, `same-tile gap ${gap}`);
});

test("lungeReach: stops at contact, capped, never negative", () => {
    assert.ok(lungeReach(1.9) < 1.9, "melee lunge stops short of the target");
    assert.ok(lungeReach(1.9) > 0, "melee lunge still moves");
    assert.equal(lungeReach(10), 3.4, "long lunge capped at MAX_LUNGE");
    assert.equal(lungeReach(0.5), 0.25, "tiny gap still gives a minimal hop");
});

test("poseMotion: lunge honors the reach parameter", () => {
    assert.equal(poseMotion("lunge", 1, 0.8).dx, 0.8);
    assert.equal(poseMotion("lunge", -1, 0.8).dx, -0.8);
});

test("beatTimeline: lunge advances forward and arcs up then lands by contact", () => {
    // dx is monotonic forward across the leap; dy humps (off the ground mid-air,
    // planted at the start and the contact landing).
    const reach = 2.5;
    const start = beatTimeline("lunge", 1, reach, 0.0);
    const mid = beatTimeline("lunge", 1, reach, 0.35);
    const contact = beatTimeline("lunge", 1, reach, 0.55);
    assert.ok(start.dx < mid.dx && mid.dx < contact.dx, "dx ramps forward through the leap");
    assert.ok(Math.abs(contact.dx - reach) < 1e-6, "fully extended to reach at contact");
    assert.ok(mid.dy > 0.2, "airborne at mid-leap");
    assert.ok(contact.dy < mid.dy, "descending onto the target by contact");
    // Enemy side mirrors: forward is −x.
    assert.ok(beatTimeline("lunge", -1, reach, 0.55).dx < 0, "enemy lunge goes −x");
});

test("beatTimeline: hit is an INSTANT knockback that recovers, scaled by power", () => {
    // The reaction is at its peak on the FIRST frame (p≈0), not eased into.
    const hit0 = beatTimeline("recoil", 1, 1, 0, { power: 0.5 });
    const hitMid = beatTimeline("recoil", 1, 1, 0.5, { power: 0.5 });
    const hitEnd = beatTimeline("recoil", 1, 1, 1, { power: 0.5 });
    assert.ok(hit0.dx < 0, "knocked away from the foe (−x for player side)");
    assert.ok(Math.abs(hit0.dx) > Math.abs(hitMid.dx), "peak displacement is on the contact frame");
    assert.ok(Math.abs(hitEnd.dx) < 1e-6, "recovered to the lane by the end");
    assert.equal(hit0.hurt, 1, "full hurt tint on the contact frame");
    // Bigger hits knock back further.
    const weak = beatTimeline("recoil", 1, 1, 0, { power: 0 });
    const strong = beatTimeline("recoil", 1, 1, 0, { power: 1 });
    assert.ok(Math.abs(strong.dx) > Math.abs(weak.dx), "harder hits knock back further");
});

test("beatTimeline: windup leans back (away from the foe) and crouches", () => {
    const w = beatTimeline("windup", 1, 1, 1);
    assert.ok(w.dx < 0, "player winds up backward (−x)");
    assert.ok(w.sy < 1, "crouch squash (shorter)");
    assert.ok(beatTimeline("windup", -1, 1, 1).dx > 0, "enemy winds up backward (+x)");
});

test("beatTimeline: ranged cast recoils away on release", () => {
    const fire = beatTimeline("projectileFire", 1, 1, 0.75); // mid-release kick
    assert.ok(fire.dx < 0, "player caster kicks back away from the foe");
    assert.ok(beatTimeline("projectileFire", -1, 1, 0.75).dx > 0, "enemy caster kicks the other way");
});

test("beatTimeline: dodge fades and returns to its lane", () => {
    const mid = beatTimeline("dodge", 1, 1, 0.4);
    const end = beatTimeline("dodge", 1, 1, 1);
    assert.ok(mid.opacity < 1, "afterimage fade mid-dodge");
    assert.ok(Math.abs(mid.dz) > 0.1, "sidesteps toward the camera");
    assert.ok(Math.abs(end.dz) < 0.1, "settles back into its lane by the end");
});

test("beatTimeline: static poses match poseMotion exactly (idle/guard/victory/ko)", () => {
    for (const s of ["idle", "guard", "victory", "ko"] as const) {
        assert.deepEqual(beatTimeline(s, 1, 1.25, 0.5), poseMotion(s, 1, 1.25), `${s} delegates to poseMotion`);
    }
});

test("beatTimeline: progress clamps — out-of-range never NaNs or overshoots", () => {
    for (const s of ["windup", "lunge", "recoil", "charge", "projectileFire", "dodge"] as const) {
        for (const pr of [-1, 0, 0.5, 1, 2]) {
            const tf = beatTimeline(s, 1, 2.5, pr);
            for (const v of [tf.dx, tf.dy, tf.dz, tf.sx, tf.sy, tf.rot, tf.hurt, tf.opacity]) {
                assert.ok(Number.isFinite(v), `${s}@${pr} stays finite`);
            }
        }
    }
});

test("beatChoreoMs: action poses have a real span, static poses are instant", () => {
    assert.ok(beatChoreoMs("lunge") > 100 && beatChoreoMs("recoil") > 100, "action poses run a timeline");
    assert.equal(beatChoreoMs("idle"), 1, "idle is instant (progress irrelevant)");
    assert.ok(LEAP_HEIGHT > 0, "leap has height");
});

test("arenaObstaclePlacements: typed tiles map to world positions by kind, normal skipped", () => {
    const tiles = [
        { row: 3, col: 6, type: "blocked" as const },
        { row: 3, col: 7, type: "cover" as const },
        { row: 2, col: 5, type: "hazard" as const },
        { row: 4, col: 8, type: "healing" as const },
        { row: 1, col: 9, type: "slow" as const },
        { row: 0, col: 0, type: "normal" as const }, // skipped
    ];
    const out = arenaObstaclePlacements([], tiles);
    assert.equal(out.length, 5, "normal tile is not drawn");
    assert.deepEqual(out.map((p) => p.kind).sort(), ["blocked", "cover", "hazard", "healing", "slow"]);
    // World position must match the same tileToWorld the pets stand on.
    const blocked = out.find((p) => p.kind === "blocked")!;
    const w = tileToWorld(3 * COLISEUM_COLS + 6);
    assert.ok(Math.abs(blocked.x - w.x) < 1e-9 && Math.abs(blocked.z - w.z) < 1e-9, "blocked tile sits on its grid cell");
});

test("arenaObstaclePlacements: falls back to raw obstacles (all blocked) when no typed tiles", () => {
    const idx = 3 * COLISEUM_COLS + 6;
    const out = arenaObstaclePlacements([idx, idx + 1], []);
    assert.equal(out.length, 2);
    assert.ok(out.every((p) => p.kind === "blocked"), "raw obstacles render as blocked walls");
    assert.deepEqual(out[0], { ...tileToWorld(idx), kind: "blocked" });
});

test("arenaObstaclePlacements: empty inputs → no placements", () => {
    assert.deepEqual(arenaObstaclePlacements([], []), []);
    assert.deepEqual(arenaObstaclePlacements(undefined, undefined), []);
});

test("cameraForCombatants: pans to the midpoint and looks at it", () => {
    const cam = cameraForCombatants([{ x: 2, z: 1 }, { x: 6, z: 1 }]);
    assert.ok(Math.abs(cam.pos[0] - 4) < 1e-9, "camera x = midpoint x (pans)");
    assert.ok(Math.abs(cam.look[0] - 4) < 1e-9, "look x = midpoint x");
    assert.ok(cam.pos[2] > cam.look[2], "camera sits BEHIND its look point (+z)");
    assert.ok(cam.pos[1] > cam.look[1], "camera sits ABOVE the look point");
});

test("cameraForCombatants: a wider spread pulls the camera farther back", () => {
    const close = cameraForCombatants([{ x: -1, z: 0 }, { x: 1, z: 0 }]);
    const wide = cameraForCombatants([{ x: -6, z: 0 }, { x: 6, z: 0 }]);
    assert.ok(wide.pos[2] > close.pos[2], "wider spread → farther back");
    assert.ok(wide.pos[1] > close.pos[1], "wider spread → higher (more of the field)");
});

test("cameraForCombatants: clamps span + handles empty/finite", () => {
    const empty = cameraForCombatants([]);
    for (const v of [...empty.pos, ...empty.look]) assert.ok(Number.isFinite(v));
    // Beyond maxSpan is clamped (a huge spread doesn't fly the camera to infinity).
    const huge = cameraForCombatants([{ x: -100, z: 0 }, { x: 100, z: 0 }]);
    const max = cameraForCombatants([{ x: -9, z: 0 }, { x: 9, z: 0 }]); // span 18 = default max
    assert.ok(Math.abs(huge.pos[2] - max.pos[2]) < 1e-9, "span clamped at maxSpan");
});

test("spreadPositions: 4 clustered pets (2v2) all end pairwise separated", () => {
    // Four pets crammed into a 2×2 tile cluster — the worst 2v2 melee pile-up.
    const mid = 3 * COLISEUM_COLS + 6;
    const tiles = [mid, mid + 1, mid + COLISEUM_COLS, mid + COLISEUM_COLS + 1];
    const spread = spreadPositions(tiles.map(tileToWorld));
    for (let i = 0; i < spread.length; i++) {
        for (let j = i + 1; j < spread.length; j++) {
            const d = Math.hypot(spread[j].x - spread[i].x, spread[j].z - spread[i].z);
            assert.ok(d >= 1.55, `pair ${i},${j} separated (got ${d.toFixed(2)})`);
        }
    }
});

test("spreadPositions: depth-stacked pair gets a HORIZONTAL gap (screen visibility)", () => {
    // Same column, two rows apart — radially separated but aligned with the
    // camera axis, so one sprite would hide behind the other on screen.
    const mid = 2 * COLISEUM_COLS + 6;
    const spread = spreadPositions([tileToWorld(mid), tileToWorld(mid + 2 * COLISEUM_COLS)]);
    assert.ok(Math.abs(spread[1].x - spread[0].x) >= 1.35,
        `horizontal gap enforced, got ${Math.abs(spread[1].x - spread[0].x).toFixed(2)}`);
});

test("spreadPositions: well-spaced points are untouched and output is finite", () => {
    const pts = [tileToWorld(3 * COLISEUM_COLS + 1), tileToWorld(3 * COLISEUM_COLS + 12)];
    const spread = spreadPositions(pts);
    assert.deepEqual(spread, pts);
    const dup = spreadPositions([{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }]);
    for (const p of dup) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z), "finite on coincident input");
});

// ── Per-move choreography classification (render-only) ───────────────────────
test("classifyMoveChoreo: melee hits split light vs heavy slam vs drain", () => {
    assert.equal(classifyMoveChoreo("damage", false), "lightMelee");
    assert.equal(classifyMoveChoreo("wound", false), "lightMelee");
    assert.equal(classifyMoveChoreo("crush", false), "heavySlam");
    assert.equal(classifyMoveChoreo("push", false), "heavySlam");
    assert.equal(classifyMoveChoreo("lifesteal", false), "drain");
    assert.equal(classifyMoveChoreo(undefined, false), "lightMelee");
});

test("classifyMoveChoreo: casts split ranged vs control beam vs support", () => {
    assert.equal(classifyMoveChoreo("dot", true), "rangedCast");
    assert.equal(classifyMoveChoreo("burn", true), "rangedCast");
    assert.equal(classifyMoveChoreo("damage", true), "rangedCast");   // ranged basic poke
    assert.equal(classifyMoveChoreo("stun", true), "beam");
    assert.equal(classifyMoveChoreo("freeze", true), "beam");
    assert.equal(classifyMoveChoreo("pull", true), "beam");
    assert.equal(classifyMoveChoreo("heal", true), "support");
    assert.equal(classifyMoveChoreo("shield", true), "support");
    assert.equal(classifyMoveChoreo("buff", true), "support");
    // debuff/taunt are RANGED in the sim (abilityClass) — they fly a projectile, so they
    // must NOT classify as a stationary support gather.
    assert.equal(classifyMoveChoreo("debuff", true), "rangedCast");
    assert.equal(classifyMoveChoreo("taunt", true), "rangedCast");
});

test("meleeLungeReach: a single lunge NEVER overshoots the contact line (no overlap)", () => {
    const CONTACT = 1.7;
    for (const closeMul of [0.88, 1]) {
        for (const pw of [0, 0.4, 1]) {
            for (const crit of [false, true]) {
                for (const gap of [3.7, 4.5, 6, 8]) {
                    const reach = meleeLungeReach(gap, pw, crit, CONTACT, closeMul);
                    const remaining = gap - reach;  // sprite-origin distance left to the foe at peak
                    assert.ok(Number.isFinite(reach) && reach >= 0, `finite/non-negative reach (gap=${gap})`);
                    // Must stop AT or short of the contact line — never cross it.
                    assert.ok(remaining >= CONTACT * closeMul - 1e-9, `gap=${gap} pw=${pw} crit=${crit} closeMul=${closeMul}: remaining ${remaining.toFixed(3)} < contact ${(CONTACT * closeMul).toFixed(3)}`);
                }
            }
        }
    }
    // A heavy slam (closeMul 0.88) commits closer than a light strike at the same gap.
    assert.ok(meleeLungeReach(3.7, 1, false, 1.7, 0.88) > meleeLungeReach(3.7, 1, false, 1.7, 1), "slam reaches further than light");
});

test("moveChoreoMods: planted archetypes never gap-close; melee ones do", () => {
    // Ranged kicks away; control braces (no kick); support rises (no kick) — all planted.
    for (const k of ["rangedCast", "beam", "support"] as const) assert.equal(moveChoreoMods(k).plant, true, `${k} plants`);
    assert.equal(moveChoreoMods("rangedCast").kickAway, true);
    assert.equal(moveChoreoMods("beam").kickAway, false);
    assert.equal(moveChoreoMods("support").kickAway, false);
    assert.ok(moveChoreoMods("support").rise > 0, "support rises");
    // Melee archetypes close the gap and never plant.
    for (const k of ["lightMelee", "heavySlam", "drain"] as const) assert.equal(moveChoreoMods(k).plant, false, `${k} closes`);
    // A heavy slam commits closer + holds longer than a light strike.
    assert.ok(moveChoreoMods("heavySlam").closeMul < moveChoreoMods("lightMelee").closeMul, "slam closes nearer");
    assert.ok(moveChoreoMods("heavySlam").pulseMul > moveChoreoMods("lightMelee").pulseMul, "slam holds longer");
    assert.ok(moveChoreoMods("drain").drainBack > 0, "drain retracts");
    // The slam must never close PAST the contact gap (no sprite overlap by construction).
    assert.ok(moveChoreoMods("heavySlam").closeMul > 0.5, "slam still leaves a gap");
});

test("moveFxKey: status kinds get a themed sprite; plain damage keeps the element tint", () => {
    assert.equal(moveFxKey("lifesteal"), "blood");
    assert.equal(moveFxKey("mark"), "shadow");
    assert.equal(moveFxKey("dot"), "poison");
    assert.equal(moveFxKey("burn"), "burn");
    assert.equal(moveFxKey("stun"), "spark");
    assert.equal(moveFxKey("freeze"), "ice");
    assert.equal(moveFxKey("pull"), "vortex");
    // Plain damage / crush keep "" → caller uses the pet's element burst.
    assert.equal(moveFxKey("damage"), "");
    assert.equal(moveFxKey("crush"), "");
    assert.equal(moveFxKey(undefined), "");
});

test("classifyMoveChoreo: melee splits its swing by element; crush/lifesteal own their staging", () => {
    // Element-keyed melee silhouettes.
    assert.equal(classifyMoveChoreo("damage", false, "Wind"), "slash");
    assert.equal(classifyMoveChoreo("damage", false, "Water"), "slash");
    assert.equal(classifyMoveChoreo("damage", false, "Fire"), "pierce");
    assert.equal(classifyMoveChoreo("damage", false, "Lightning"), "pierce");
    assert.equal(classifyMoveChoreo("damage", false, "Earth"), "lightMelee");
    // crush/push/lifesteal classify by KIND regardless of element.
    assert.equal(classifyMoveChoreo("crush", false, "Wind"), "heavySlam");
    assert.equal(classifyMoveChoreo("push", false, "Fire"), "heavySlam");
    assert.equal(classifyMoveChoreo("lifesteal", false, "Wind"), "drain");
    // Back-compat: the legacy 2-arg call (no element) still falls to the standard lunge.
    assert.equal(classifyMoveChoreo("damage", false), "lightMelee");
    // Casts are unaffected by element (still split ranged/beam/support).
    assert.equal(classifyMoveChoreo("damage", true, "Fire"), "rangedCast");
    assert.equal(classifyMoveChoreo("stun", true, "Fire"), "beam");
});

test("moveChoreoMods: slash double-taps fast; pierce is a single deep thrust", () => {
    const slash = moveChoreoMods("slash");
    const pierce = moveChoreoMods("pierce");
    assert.equal(slash.plant, false);
    assert.equal(pierce.plant, false);
    // A slash is the only melee that flurries off-crit; a pierce commits as one blow.
    assert.equal(slash.doubleTap, true);
    assert.equal(pierce.doubleTap, false);
    assert.equal(moveChoreoMods("lightMelee").doubleTap, false);
    assert.equal(moveChoreoMods("heavySlam").doubleTap, false);
    // A slash snaps quicker than the baseline; a pierce holds longer + commits closer.
    assert.ok(slash.pulseMul < moveChoreoMods("lightMelee").pulseMul, "slash is faster");
    assert.ok(pierce.pulseMul > moveChoreoMods("lightMelee").pulseMul, "pierce holds longer");
    assert.ok(pierce.closeMul < moveChoreoMods("lightMelee").closeMul, "pierce commits closer");
    assert.ok(pierce.closeMul > 0.5, "pierce still leaves a gap (no overlap)");
});

test("meleeContactFx: ordered, element-flavored combo from real fx folders", () => {
    const FOLDERS = new Set(["", "slash", "spark", "bighit", "burn", "wind", "earth", "kaboom", "explosion"]);
    for (const [el, arche] of [["Fire", "pierce"], ["Lightning", "pierce"], ["Wind", "slash"], ["Earth", "lightMelee"], ["Water", "slash"]] as const) {
        for (const crit of [false, true]) {
            for (const heavy of [false, true]) {
                const beats = meleeContactFx(el, arche, crit, heavy);
                assert.ok(beats.length >= 2, `${el}/${arche}: at least a lead + element bloom`);
                // Monotonic schedule (each beat fires at or after the previous).
                for (let i = 1; i < beats.length; i++) assert.ok(beats[i].at >= beats[i - 1].at, `${el}: beats ordered`);
                // Every key is a real bundled fx folder ("" → caller spawns the element burst).
                for (const b of beats) {
                    assert.ok(FOLDERS.has(b.key), `${el}/${arche}: key "${b.key}" is a known folder`);
                    assert.ok(b.scale > 0 && b.dur > 0, "positive scale/dur");
                }
                // Exactly one element bloom ("") on contact.
                assert.equal(beats.filter((b) => b.key === "").length, 1, `${el}: one element bloom`);
                // A crit always caps the combo with a finisher burst.
                if (crit) assert.ok(["kaboom", "explosion"].includes(beats[beats.length - 1].key), `${el}: crit finisher`);
            }
        }
    }
    // A slash flurries (two slash streaks); a pierce never doubles up.
    assert.equal(meleeContactFx("Wind", "slash", false, false).filter((b) => b.key === "slash").length, 2, "slash = double streak");
    assert.ok(meleeContactFx("Fire", "pierce", false, false).filter((b) => b.key === "slash").length <= 1, "pierce does not double-slash");
    assert.equal(meleeContactFx("Lightning", "pierce", false, false).filter((b) => b.key === "slash").length, 0, "lightning pierce leads with spark");
    // A heavy slam leads with a bighit.
    assert.equal(meleeContactFx("Earth", "heavySlam", false, true)[0].key, "bighit", "slam leads bighit");
});
