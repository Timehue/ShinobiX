export type PetCombatMotion = "idle" | "run" | "dash" | "windup" | "strike" | "recover" | "stagger" | "dodge" | "guard" | "rest" | "dead";

export type AttackClipWindow = Readonly<{ start: number; end: number }>;

export type PetDeathChoreography = Readonly<{
    /** 0 -> 1 eased collapse progress. */
    fall: number;
    /** Brief upward recoil before gravity takes over, in world units. */
    lift: number;
    /** Downward root compensation that keeps a tilted body in floor contact. */
    sink: number;
    /** Short 0 -> 1 -> 0 landing compression pulse. */
    impact: number;
}>;

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

/** Advance a visible body yaw without ever taking the long way around or
 * rotating farther than one readable frame allows. `maxFrameStep` is a hard
 * safety rail (independent of a dropped-frame delta); `turnRate` keeps ordinary
 * high-refresh motion smooth below that rail. */
export function advanceCombatBodyYaw(
    currentYaw: number,
    wantedYaw: number,
    deltaSeconds: number,
    turnRate: number,
    maxFrameStep = Math.PI / 3,
): number {
    if (!Number.isFinite(currentYaw) || !Number.isFinite(wantedYaw)) return Number.isFinite(currentYaw) ? currentYaw : 0;
    const frameBudget = Math.max(0, Math.min(Math.abs(maxFrameStep), Math.max(0, deltaSeconds) * Math.max(0, turnRate)));
    const error = wrappedAngle(wantedYaw - currentYaw);
    return currentYaw + clamp(error, -frameBudget, frameBudget);
}

/** Exact world-space heading from one combatant to another. Keep this as the
 * single target-facing source; PetModel3D already owns the visual turn easing,
 * so smoothing the vector before it reaches the model can leave a planted pet
 * frozen on a stale intermediate heading. */
export function resolveOpponentFacing(
    fromX: number,
    fromZ: number,
    opponentX: number,
    opponentZ: number,
    fallbackX = 0,
    fallbackZ = 1,
): [number, number] {
    const dx = opponentX - fromX;
    const dz = opponentZ - fromZ;
    return Math.hypot(dx, dz) > 1e-5
        ? normalize(dx, dz)
        : normalize(fallbackX, fallbackZ);
}

/** Final root yaw that maps one model's corrected visible-forward axis onto its
 * world-space combat heading. Keep this shared with PetModel3D so tests exercise
 * the same last transform the renderer applies, not only the target vector. */
export function resolveCombatBodyYaw(faceX: number, faceZ: number, yawOffset = 0): number {
    return Math.atan2(faceX, faceZ) + yawOffset;
}

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

/** Shared KO phrase used by every 3D pet. Authored death clips still animate
 * the skeleton; this supplies the readable whole-body recoil, fall and landing
 * beat that otherwise varies wildly between imported rigs. */
export function petDeathChoreography(
    motionAge: number,
    targetHeight: number,
    profile: "quadruped" | "biped" | "avian" | "serpentine" | "heavy" = "quadruped",
): PetDeathChoreography {
    const age = Math.max(0, motionAge);
    const recoilWindow = profile === "heavy" ? 0.2 : 0.16;
    const fallDuration = profile === "heavy" ? 0.82 : profile === "avian" ? 0.62 : 0.7;
    const fall = smoothstep((age - recoilWindow * 0.5) / fallDuration);
    const recoilP = clamp(age / recoilWindow, 0, 1);
    const recoilScale = profile === "avian" ? 0.09 : profile === "heavy" ? 0.035 : 0.055;
    const lift = Math.sin(Math.PI * recoilP) * Math.max(0.5, targetHeight) * recoilScale * (1 - fall);
    const sinkScale = profile === "biped" ? 0.2 : profile === "avian" ? 0.15 : profile === "heavy" ? 0.12 : profile === "serpentine" ? 0.08 : 0.13;
    const sink = fall * Math.max(0.5, targetHeight) * sinkScale;
    const landingAt = recoilWindow * 0.5 + fallDuration;
    const impactP = clamp((age - landingAt) / 0.28, 0, 1);
    const impact = age >= landingAt ? Math.sin(Math.PI * impactP) * (1 - impactP * 0.35) : 0;
    return { fall, lift, sink, impact };
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
    // travel, but keep the opponent inside a 45-degree forward cone. The wider
    // 72-degree allowance let a retreating pet spend long beats looking almost
    // completely away from the fight.
    const faceAngle = Math.atan2(face[0], face[1]);
    const moveAngle = Math.atan2(move[0], move[1]);
    const delta = clamp(wrappedAngle(moveAngle - faceAngle), -Math.PI * 0.25, Math.PI * 0.25);
    const angle = faceAngle + delta;
    return [Math.sin(angle), Math.cos(angle)];
}
