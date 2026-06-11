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
    COLISEUM_COLS,
    COLISEUM_ROWS,
} from "./pet-coliseum-scene.ts";

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
    assert.equal(shakeAmpForBeat("impact", base), 0, "routine impact = no shake");
});

test("lerp basics", () => {
    assert.equal(lerp(0, 10, 0), 0);
    assert.equal(lerp(0, 10, 1), 10);
    assert.equal(lerp(0, 10, 0.5), 5);
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
    assert.equal(lungeReach(10), 2.2, "long lunge capped at MAX_LUNGE");
    assert.equal(lungeReach(0.5), 0.25, "tiny gap still gives a minimal hop");
});

test("poseMotion: lunge honors the reach parameter", () => {
    assert.equal(poseMotion("lunge", 1, 0.8).dx, 0.8);
    assert.equal(poseMotion("lunge", -1, 0.8).dx, -0.8);
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
