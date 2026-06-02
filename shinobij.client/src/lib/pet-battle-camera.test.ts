import { test } from "node:test";
import assert from "node:assert/strict";
import { petBattleCamera, petCameraHoldMs } from "./pet-battle-camera.ts";

const base = { resolved: false, isKO: false, crit: false, signature: false, heavyHit: false, sigCharge: false, activeType: "impact" as const };

test("resolved → camera idles (no class, no hit-stop)", () => {
    const c = petBattleCamera({ ...base, resolved: true, isKO: true, crit: true });
    assert.equal(c.className, "");
    assert.equal(c.hitStopMs, 0);
});

test("signature charge → focus + dim, no hit-stop", () => {
    const c = petBattleCamera({ ...base, signature: true, sigCharge: true, activeType: "charge" });
    assert.equal(c.className, "battle-camera-focus battle-background-dim");
    assert.equal(c.hitStopMs, 0);
});

test("crit impact → crit impact-punch + crit hit-stop", () => {
    const c = petBattleCamera({ ...base, crit: true });
    assert.equal(c.className, "pet-stage-impact-crit");
    assert.equal(c.hitStopMs, 140);
});

test("KO → KO impact-punch + KO hit-stop (longest freeze)", () => {
    const c = petBattleCamera({ ...base, isKO: true, activeType: "ko" });
    assert.equal(c.className, "pet-stage-impact-ko");
    assert.equal(c.hitStopMs, 220);
});

test("signature (non-crit) impact → signature impact-punch", () => {
    const c = petBattleCamera({ ...base, signature: true });
    assert.equal(c.className, "pet-stage-impact-sig");
    assert.equal(c.hitStopMs, 140);
});

test("heavy (non-crit) impact → light impact-punch + heavy hit-stop", () => {
    const c = petBattleCamera({ ...base, heavyHit: true });
    assert.equal(c.className, "pet-stage-impact-hit");
    assert.equal(c.hitStopMs, 90);
});

test("crit outranks signature for the punch class", () => {
    const c = petBattleCamera({ ...base, crit: true, signature: true });
    assert.equal(c.className, "pet-stage-impact-crit");
});

test("light impact → no shake, no hit-stop", () => {
    const c = petBattleCamera({ ...base });
    assert.equal(c.className, "");
    assert.equal(c.hitStopMs, 0);
});

test("non-contact beat (windup) → no shake, no hit-stop", () => {
    const c = petBattleCamera({ ...base, crit: true, activeType: "windup" });
    assert.equal(c.className, "");
    assert.equal(c.hitStopMs, 0);
});

test("hit-stop helper: only impact/ko hold; severity ordered KO>crit>heavy", () => {
    const opt = (o = {}) => ({ crit: false, signature: false, isKO: false, heavyHit: false, ...o });
    assert.equal(petCameraHoldMs("windup", opt()), 0);
    assert.equal(petCameraHoldMs("impact", opt()), 0);
    assert.equal(petCameraHoldMs("impact", opt({ heavyHit: true })), 90);
    assert.equal(petCameraHoldMs("impact", opt({ crit: true })), 140);
    assert.equal(petCameraHoldMs("impact", opt({ signature: true })), 140);
    assert.equal(petCameraHoldMs("ko", opt()), 220);
    // KO dominates even without an impact type.
    assert.equal(petCameraHoldMs("recoil", opt({ isKO: true })), 220);
});
