export type PetCombatMotion = "idle" | "run" | "dash" | "windup" | "strike" | "recover" | "stagger" | "dodge" | "dead";

export type AttackClipWindow = Readonly<{ start: number; end: number }>;

const ATTACK_WINDOWS: Readonly<Partial<Record<PetCombatMotion, AttackClipWindow>>> = Object.freeze({
    windup: Object.freeze({ start: 0, end: 0.34 }),
    strike: Object.freeze({ start: 0.34, end: 0.74 }),
    recover: Object.freeze({ start: 0.74, end: 0.995 }),
});

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const smoothstep = (value: number) => {
    const p = clamp(value, 0, 1);
    return p * p * (3 - 2 * p);
};
const normalize = (x: number, z: number): [number, number] => {
    const length = Math.hypot(x, z);
    return length > 1e-5 ? [x / length, z / length] : [0, 1];
};
const wrappedAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** The generated attack take is one clip, but combat presents it as three
 * authored phases. Holding each phase at its boundary prevents anticipation
 * from reaching the clip's final raised-paw pose before contact occurs. */
export function attackClipWindow(motion: PetCombatMotion): AttackClipWindow | null {
    return ATTACK_WINDOWS[motion] ?? null;
}

/** Only neutral traversal owns a locomotion cycle. Residual velocity must not
 * layer a run/bob over a planted cast, hit reaction, or attack recovery. */
export function motionOwnsLocomotion(motion: PetCombatMotion, moving: boolean): boolean {
    return motion === "dash" || motion === "run" || (motion === "idle" && moving);
}

export function resolveCombatBodyFacing({
    faceX,
    faceZ,
    moveX,
    moveZ,
    motion,
    motionAge,
    allowTravelFacing,
}: {
    faceX: number;
    faceZ: number;
    moveX: number;
    moveZ: number;
    motion: PetCombatMotion;
    motionAge: number;
    allowTravelFacing: boolean;
}): [number, number] {
    const face = normalize(faceX, faceZ);
    if (!allowTravelFacing || (motion !== "run" && motion !== "dash")) return face;

    const move = normalize(moveX, moveZ);
    if (motion === "dash") {
        // Follow the S-route through launch, then deliberately acquire the target
        // for the final third. The body therefore never arrives sideways/backward.
        const contactBlend = smoothstep((motionAge / 0.58 - 0.58) / 0.42);
        return normalize(
            move[0] + (face[0] - move[0]) * contactBlend,
            move[1] + (face[1] - move[1]) * contactBlend,
        );
    }

    // A planted quadruped cannot sell a fast sideways slide. Turn the torso into
    // travel, but cap the turn to 72 degrees around the opponent eyeline so the
    // fighter never appears to abandon the exchange or show its back at random.
    const faceAngle = Math.atan2(face[0], face[1]);
    const moveAngle = Math.atan2(move[0], move[1]);
    const delta = clamp(wrappedAngle(moveAngle - faceAngle), -Math.PI * 0.4, Math.PI * 0.4);
    const angle = faceAngle + delta;
    return [Math.sin(angle), Math.cos(angle)];
}
