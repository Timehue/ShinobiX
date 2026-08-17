/**
 * Framing maths for the Pet Showdown action camera.
 *
 * The director authors each shot as an ANGLE — a side dolly, a shoulder swoop,
 * an orbit. What it cannot author is how far back that angle has to sit, because
 * that depends on three things the shot does not know: how big the creatures in
 * it are, how far the element effect throws, and what shape the viewport is.
 *
 * The old rule was a pair of minimum distances (never nearer than 7.6 to the
 * subject, 6.0 to any body). A minimum distance does not frame anything: it says
 * where the lens may not go, not what ends up on screen. A move whose shock ring
 * opens past five units still overflowed the frame, and it overflowed sooner on
 * a narrow phone because a fixed distance ignores horizontal FOV entirely —
 * which is why the action read as "zoomed so far in you cannot see the effect".
 *
 * The two frame axes are deliberately kept SEPARATE here rather than fitting one
 * bounding sphere. Almost every impact effect in PetShowdownVfx3d is a ground
 * feature — the shock ring especially — so it is wide but flat. Fitting it as a
 * sphere would demand the vertical room of a five-unit ball, shoving every blow
 * out to the arena's containment limit and flattening the difference between a
 * jab and a signature. Width and height are asked for independently, and the
 * lens honours whichever is tighter.
 */

/** Vertical→horizontal FOV, in radians. three.js `PerspectiveCamera.fov` is vertical. */
export function horizontalFov(verticalFovDeg: number, aspect: number): number {
    const v = (Math.max(1, verticalFovDeg) * Math.PI) / 180;
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    return 2 * Math.atan(Math.tan(v / 2) * a);
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * Vertical FOV for a viewport shape. Showdown used a fixed 48° at every aspect,
 * which on an upright phone leaves barely 22° of HORIZONTAL coverage — so an
 * impact effect could only be framed by dollying back past the arena's own
 * backdrop wall, and the containment clamp silently ate the difference. Opening
 * the lens on narrow viewports buys that coverage without leaving the shell.
 *
 * The ceiling is deliberate: past roughly 62° the perspective stretch on a near
 * body starts reading as a fisheye, which is its own kind of wrong. The sibling
 * duel camera (`pet-duel-camera.ts`) makes the same trade for the same reason.
 */
export function showdownFov(aspect: number): number {
    const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
    const narrow = clamp01((1.2 - a) / 0.74);
    return 48 + narrow * 14;
}

/**
 * Distance at which `horiz` fits across the frame AND `vert` fits up it.
 *
 * Both are half-extents measured from the point the lens is aimed at. On a
 * landscape monitor height is usually the binding constraint; on a phone held
 * upright width is, by a wide margin — which is the whole reason this takes the
 * aspect rather than a tuned constant.
 */
export function fitDistance(horiz: number, vert: number, verticalFovDeg: number, aspect: number): number {
    const v = (Math.max(1, verticalFovDeg) * Math.PI) / 180;
    const h = horizontalFov(verticalFovDeg, aspect);
    const byWidth = horiz > 0 ? horiz / Math.max(1e-3, Math.sin(h / 2)) : 0;
    const byHeight = vert > 0 ? vert / Math.max(1e-3, Math.sin(v / 2)) : 0;
    return Math.max(byWidth, byHeight);
}

/**
 * How much room each kind of beat needs around the point being shot, in world
 * units. Sourced from the effect layer rather than guessed: `ShockRing` opens to
 * `0.7 + 4.6` ≈ 5.3 across the ground, a super cast shell sits at 2.6, and the
 * element particle beds throw 1.4–2.4 wide and rise as high as 3.8
 * (PetShowdownVfx3d). Heights are half-extents about the look point, which sits
 * near chest height, so they cover a tall pet plus its rising element work.
 */
export const SHOT_EXTENT = Object.freeze({
    /** Signature: shock ring at full extent plus the cast column above it. */
    super: { horiz: 5.9, vert: 3.4 },
    /** A landed heavy or a KO — ring, element bed and the recoil throw. */
    heavy: { horiz: 4.6, vert: 2.8 },
    /** A thrown attack: the bolt has to be readable in flight, not just landing. */
    ranged: { horiz: 4.2, vert: 2.6 },
    /** An ordinary contact hit: element bed and impact flash only. */
    normal: { horiz: 3.4, vert: 2.4 },
    /** Anticipation — nothing has spawned yet, so only the body matters. */
    windup: { horiz: 2.6, vert: 2.2 },
    /** Non-combat beats: a switch-in, the closing orbit. */
    quiet: { horiz: 2.2, vert: 2.0 },
});

export type ShotWeight = keyof typeof SHOT_EXTENT;

/** Which extent budget a beat draws on. */
export function shotWeight(opts: {
    superMove: boolean;
    heavy: boolean;
    ranged: boolean;
    windup: boolean;
}): ShotWeight {
    if (opts.superMove) return "super";
    if (opts.windup) return "windup";
    if (opts.heavy) return "heavy";
    if (opts.ranged) return "ranged";
    return "normal";
}

/**
 * The half-extents that have to be visible around `centre`: this beat's effect
 * budget, widened so no body in the shot is cropped. `points` are the bodies
 * involved — on a lunge the caster ends up beside its victim, and letting the
 * lens sit tight enough to slice it in half is the same defect in miniature.
 *
 * A body's contribution is capped: two fighters on opposite lines are 8.2 apart,
 * and literally fitting both would demand a distance the arena shell cannot
 * contain, so the far one is allowed to sit at the frame edge rather than
 * dragging the lens into orbit.
 */
export function framedExtent(
    centre: readonly [number, number, number],
    points: readonly (readonly [number, number, number])[],
    weight: ShotWeight,
    maxBodySpread = 3.2,
): { horiz: number; vert: number } {
    const base = SHOT_EXTENT[weight];
    let spread = 0;
    for (const p of points) {
        spread = Math.max(spread, Math.hypot(p[0] - centre[0], p[2] - centre[2]));
    }
    return {
        horiz: Math.max(base.horiz, Math.min(spread, maxBodySpread) + 1.2),
        vert: base.vert,
    };
}
