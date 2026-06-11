import { test } from "node:test";
import assert from "node:assert/strict";
import {
    tileToWorld,
    poseMotion,
    shakeAmpForBeat,
    lerp,
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
