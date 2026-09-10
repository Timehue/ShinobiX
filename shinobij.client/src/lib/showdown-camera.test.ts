import test from "node:test";
import assert from "node:assert/strict";
import { PerspectiveCamera, Vector3 } from "three";
import { showdownTechniqueCamera } from "./showdown-camera";
import { SHOT_EXTENT, SHOWDOWN_PORTRAIT_FRAMING, fitDistance, framedExtent, horizontalFov, showdownBackdropOffset, showdownCameraBlend, showdownFov, shotWeight } from "./showdown-camera";

test("camera settling is identical at 30, 60 and 144 Hz", () => {
    const positions = [30, 60, 144].map(fps => {
        let x = 0;
        for (let frame = 0; frame < fps; frame++) x += (10 - x) * showdownCameraBlend(1 / fps, 3.4);
        return x;
    });
    assert.ok(Math.max(...positions) - Math.min(...positions) < 1e-9);
    assert.equal(showdownCameraBlend(0, 3.4), 0);
});

const DESKTOP = 16 / 9;
/** The viewport the too-zoomed report came from. */
const REPORTED = 1520 / 1030;
const PHONE_PORTRAIT = 390 / 844;
const FOV = 48;

test("elemental signature framing separates both pets on every lane", () => {
    for (const a of [[-3.4, 0, 4.1], [0, 0, 4.1], [3.4, 0, 4.1]]) {
        for (const b of [[-3.4, 0, -4.1], [0, 0, -4.1], [3.4, 0, -4.1]]) {
            for (const ground of [false, true]) {
                const shot = showdownTechniqueCamera(a, b, ground);
                const camera = new PerspectiveCamera(48, 16 / 9, .1, 80);
                camera.position.set(...shot.position); camera.lookAt(...shot.look); camera.updateMatrixWorld();
                const actor = new Vector3(a[0], 1, a[2]).project(camera);
                const target = new Vector3(b[0], 1, b[2]).project(camera);
                assert.ok(Math.abs(actor.x - target.x) > .55, "victim silhouette must not sit behind caster");
                assert.ok(Math.abs(actor.x) < 1 && Math.abs(target.x) < 1, "both bodies fit");
                const enemyShot = showdownTechniqueCamera(b, a, ground);
                assert.ok(enemyShot.position[2] > b[2], "enemy casts must not put the camera behind the enemy row");
            }
        }
    }
});

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
    // The elevated portrait master shot supports a wider lens while desktop
    // retains the original perspective.
    assert.ok(showdownFov(PHONE_PORTRAIT) <= 74);
    assert.ok(showdownFov(0.2) <= 74, "the ceiling must hold for any absurd aspect");
});

test("opening the lens keeps phone framing inside the arena shell", () => {
    // Containment clamps the camera at 18; the backdrop cylinder is at 19. A
    // landed heavy has to fit without the clamp silently eating the difference.
    const { horiz, vert } = SHOT_EXTENT.heavy;
    const fixed = fitDistance(horiz, vert, 48, PHONE_PORTRAIT);
    const responsive = fitDistance(horiz, vert, showdownFov(PHONE_PORTRAIT), PHONE_PORTRAIT);
    assert.ok(fixed > 18, "a fixed 48-degree lens could NOT frame this inside the shell");
    assert.ok(responsive <= 18, `responsive lens should fit inside containment, got ${responsive.toFixed(1)}`);
    const signature = SHOT_EXTENT.super;
    assert.ok(fitDistance(signature.horiz, signature.vert, showdownFov(PHONE_PORTRAIT), PHONE_PORTRAIT) <= 18, 'signature extent must fit too');
});

test("portrait master shot keeps all six bodies above the command deck", () => {
    const camera = new PerspectiveCamera(showdownFov(PHONE_PORTRAIT), PHONE_PORTRAIT, 0.1, 80);
    camera.position.set(...SHOWDOWN_PORTRAIT_FRAMING.position);
    camera.lookAt(0, 1, -0.6);
    camera.setViewOffset(390, 844, 0, Math.round(844 * SHOWDOWN_PORTRAIT_FRAMING.opticalShift), 390, 844);
    camera.updateMatrixWorld();
    assert.ok(camera.position.length() < 18);
    // Include one unit of silhouette width outside the left and right slots.
    for (const x of [-4.6, 0, 4.6]) for (const z of [-4.1, 4.1]) for (const y of [0, 2.7]) {
        const point = new Vector3(x, y, z).project(camera);
        assert.ok(Math.abs(point.x) < 1, 'body must fit horizontally');
        assert.ok(point.y > 0.08, 'feet must remain above the lower command/party panels');
        assert.ok(point.y < 0.8, 'head must remain below the top HUD');
    }
});
