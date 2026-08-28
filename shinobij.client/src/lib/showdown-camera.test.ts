import test from "node:test";
import assert from "node:assert/strict";
import { SHOT_EXTENT, fitDistance, framedExtent, horizontalFov, showdownBackdropOffset, showdownFov, shotWeight } from "./showdown-camera";

const DESKTOP = 16 / 9;
/** The viewport the too-zoomed report came from. */
const REPORTED = 1520 / 1030;
const PHONE_PORTRAIT = 390 / 844;
const FOV = 48;

/** Is a half-extent of `horiz` wide and `vert` tall inside the frustum at `distance`? */
function fits(horiz: number, vert: number, distance: number, fovDeg: number, aspect: number): boolean {
    if (distance <= 0) return horiz <= 0 && vert <= 0;
    const v = (fovDeg * Math.PI) / 180;
    const h = horizontalFov(fovDeg, aspect);
    return horiz / distance <= Math.sin(h / 2) + 1e-9 && vert / distance <= Math.sin(v / 2) + 1e-9;
}

test("horizontal FOV widens with aspect and collapses on portrait", () => {
    assert.ok(horizontalFov(FOV, DESKTOP) > (FOV * Math.PI) / 180);
    assert.ok(horizontalFov(FOV, PHONE_PORTRAIT) < (FOV * Math.PI) / 180);
});

test("the mirrored arena backdrop centres its painted landmark on the resting camera", () => {
    const repeat = 2.5;
    const cameraX = 5.2;
    const cameraZ = 14;
    const angle = Math.atan2(-cameraX, -cameraZ);
    const u = ((angle / (Math.PI * 2)) % 1 + 1) % 1;
    const repeatedU = u * repeat + showdownBackdropOffset(cameraX, cameraZ, repeat);
    // A half-integer is the source image's centre under mirrored repeat.
    assert.ok(Math.abs((repeatedU - 0.5) - Math.round(repeatedU - 0.5)) < 1e-9);
    assert.ok(Math.abs(showdownBackdropOffset(cameraX, cameraZ, repeat)) < 0.5);
    assert.equal(showdownBackdropOffset(cameraX, cameraZ, 0), 0);
});

test("fit distance puts the whole extent on screen, and no further", () => {
    for (const aspect of [DESKTOP, REPORTED, 4 / 3, 1, PHONE_PORTRAIT]) {
        for (const weight of Object.keys(SHOT_EXTENT) as (keyof typeof SHOT_EXTENT)[]) {
            const { horiz, vert } = SHOT_EXTENT[weight];
            const d = fitDistance(horiz, vert, FOV, aspect);
            assert.ok(fits(horiz, vert, d, FOV, aspect), `${weight} @${aspect.toFixed(2)} did not fit at ${d.toFixed(2)}`);
            assert.ok(!fits(horiz, vert, d * 0.98, FOV, aspect), `${weight} @${aspect.toFixed(2)} pulled back further than needed`);
        }
    }
});

test("the two frame axes are asked for independently", () => {
    // A wide, flat ground effect must not be charged for vertical room it does
    // not use. Fitting it as a sphere would demand the taller of the two.
    const flat = fitDistance(4.6, 0.5, FOV, DESKTOP);
    const ball = fitDistance(4.6, 4.6, FOV, DESKTOP);
    assert.ok(flat < ball, "a flat ring should sit closer than a ball of the same width");
});

test("a narrow viewport demands more distance than a wide one", () => {
    assert.ok(fitDistance(4.6, 2.8, FOV, PHONE_PORTRAIT) > fitDistance(4.6, 2.8, FOV, DESKTOP) * 2);
});

test("effect budget scales with the weight of the blow", () => {
    // The ordering is the point: a signature's ring needs room a jab does not,
    // and pulling back for every light hit drains the punch out of all of them.
    assert.ok(SHOT_EXTENT.super.horiz > SHOT_EXTENT.heavy.horiz);
    assert.ok(SHOT_EXTENT.heavy.horiz > SHOT_EXTENT.ranged.horiz);
    assert.ok(SHOT_EXTENT.ranged.horiz > SHOT_EXTENT.normal.horiz);
    assert.ok(SHOT_EXTENT.normal.horiz > SHOT_EXTENT.windup.horiz);
    // ShockRing in PetShowdownVfx3d opens to 0.7 + 4.6; a signature must clear it.
    assert.ok(SHOT_EXTENT.super.horiz >= 5.3);
});

test("shot weight picks the budget the beat draws on", () => {
    assert.equal(shotWeight({ superMove: true, heavy: true, ranged: true, windup: true }), "super");
    assert.equal(shotWeight({ superMove: false, heavy: true, ranged: false, windup: true }), "windup");
    assert.equal(shotWeight({ superMove: false, heavy: true, ranged: true, windup: false }), "heavy");
    assert.equal(shotWeight({ superMove: false, heavy: false, ranged: true, windup: false }), "ranged");
    assert.equal(shotWeight({ superMove: false, heavy: false, ranged: false, windup: false }), "normal");
});

test("a lunging body widens the shot but cannot drag the lens into orbit", () => {
    const victim: [number, number, number] = [0, 0, -4.1];
    const beside: [number, number, number] = [1.6, 0, -4.1];
    const acrossTheArena: [number, number, number] = [0, 0, 4.1];
    assert.ok(
        framedExtent(victim, [beside, victim], "normal").horiz >= SHOT_EXTENT.normal.horiz,
        "a caster beside its victim must not be cropped",
    );
    // 8.2 units apart: fitting both literally would exceed the arena shell, so
    // the far body is capped rather than allowed to dictate the distance.
    const far = framedExtent(victim, [acrossTheArena, victim], "normal");
    assert.ok(far.horiz <= 3.2 + 1.2 + 1e-9, "a far body must be capped, not fitted");
});

test("the beat that read as too zoomed now clears its effect", () => {
    // Reported case: a landed heavy, lens on the victim, at the viewport the
    // screenshot came from. The old rule was a flat 7.6-unit floor regardless of
    // viewport shape or how much the move actually threw.
    const OLD_SUBJECT_MIN = 7.6;
    const { horiz, vert } = framedExtent([0, 0, 0], [[0, 0, 0]], "heavy");
    assert.ok(!fits(horiz, vert, OLD_SUBJECT_MIN, FOV, REPORTED), "the old floor should NOT have fit the effect");
    assert.ok(fits(horiz, vert, fitDistance(horiz, vert, FOV, REPORTED), FOV, REPORTED));
    // And a signature has to open up further still than an ordinary heavy.
    const sig = SHOT_EXTENT.super;
    assert.ok(fitDistance(sig.horiz, sig.vert, FOV, REPORTED) > fitDistance(horiz, vert, FOV, REPORTED));
});

test("zero extent asks for no distance, so quiet beats keep their authored framing", () => {
    assert.equal(fitDistance(0, 0, FOV, DESKTOP), 0);
    assert.equal(fitDistance(-1, -1, FOV, DESKTOP), 0);
});

test("the lens opens on narrow viewports and is left alone on wide ones", () => {
    assert.equal(showdownFov(REPORTED), 48, "the reported desktop viewport must not change lens");
    assert.equal(showdownFov(DESKTOP), 48);
    assert.ok(showdownFov(1) > 48);
    assert.ok(showdownFov(PHONE_PORTRAIT) > showdownFov(1));
    // Past ~62 the perspective stretch on a near body reads as a fisheye.
    assert.ok(showdownFov(PHONE_PORTRAIT) <= 62);
    assert.ok(showdownFov(0.2) <= 62, "the ceiling must hold for any absurd aspect");
});

test("opening the lens keeps phone framing inside the arena shell", () => {
    // Containment clamps the camera at 18; the backdrop cylinder is at 19. A
    // landed heavy has to fit without the clamp silently eating the difference.
    const { horiz, vert } = SHOT_EXTENT.heavy;
    const fixed = fitDistance(horiz, vert, 48, PHONE_PORTRAIT);
    const responsive = fitDistance(horiz, vert, showdownFov(PHONE_PORTRAIT), PHONE_PORTRAIT);
    assert.ok(fixed > 18, "a fixed 48-degree lens could NOT frame this inside the shell");
    assert.ok(responsive <= 18, `responsive lens should fit inside containment, got ${responsive.toFixed(1)}`);
});
