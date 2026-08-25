import type { PetCombatModelProfile } from "./pet-3d-models";

export type ShowdownPerformanceVariant = 0 | 1 | 2;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const smoothstep = (value: number): number => {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
};

const PROFILE_RADIUS: Readonly<Record<PetCombatModelProfile, number>> = {
    quadruped: 0.46,
    biped: 0.36,
    avian: 0.43,
    serpentine: 0.52,
    heavy: 0.5,
};

/** Conservative ground-plane half-depth for contact choreography. It is
 * intentionally derived from the certified presentation height rather than
 * mesh bounds: bounds change while wings, tails, and attack clips articulate,
 * whereas the contact lane must stay deterministic across replay and capture. */
export function showdownBodyRadius({
    targetHeight = 2.1,
    profile = "quadruped",
    rarity = "common",
}: {
    targetHeight?: number;
    profile?: PetCombatModelProfile;
    rarity?: string;
}): number {
    const rarityScale = /mythic|legend/i.test(rarity) ? 1.06 : /epic/i.test(rarity) ? 1.03 : 1;
    return clamp(targetHeight * PROFILE_RADIUS[profile] * rarityScale, 0.62, 1.58);
}

/** The attacker reaches beyond its resting silhouette during the strike pose. */
export function showdownStrikeReach(attackerRadius: number, strikeDrive = 1): number {
    return clamp(attackerRadius * 0.42 * clamp(strikeDrive, 0.82, 1.48), 0.3, 0.82);
}

/** Centre-to-centre separation at contact. The small light gap leaves room for
 * the white impact core, so the VFX reads as the cause of contact instead of a
 * decal buried inside two intersecting creatures. */
export function showdownContactGap(attackerRadius: number, defenderRadius: number, strikeDrive = 1): number {
    return clamp(attackerRadius + showdownStrikeReach(attackerRadius, strikeDrive) + 0.3 + defenderRadius, 1.98, 4.1);
}

export function showdownMeleeContact(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    attackerRadius: number,
    defenderRadius: number,
    strikeDrive = 1,
): Readonly<{ x: number; z: number; impactX: number; impactZ: number; travel: number; gap: number }> {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const distance = Math.hypot(dx, dz);
    const gap = showdownContactGap(attackerRadius, defenderRadius, strikeDrive);
    if (distance < 0.001) return { x: fromX, z: fromZ, impactX: fromX, impactZ: fromZ, travel: 0, gap };
    const travel = Math.max(0, distance - gap);
    const x = fromX + dx / distance * travel;
    const z = fromZ + dz / distance * travel;
    const impactAdvance = attackerRadius + showdownStrikeReach(attackerRadius, strikeDrive) + 0.15;
    return {
        x,
        z,
        impactX: x + dx / distance * impactAdvance,
        impactZ: z + dz / distance * impactAdvance,
        travel,
        gap,
    };
}

/** One attack phrase: accelerate, hold the committed contact pose through the
 * hit frame, then recoil home. The smooth edges keep paws from sliding. */
export function showdownMeleeDrive(progress: number): number {
    if (progress < 0.32) return 0;
    if (progress < 0.5) return smoothstep((progress - 0.32) / 0.18);
    if (progress < 0.68) return 1;
    if (progress < 0.92) return 1 - smoothstep((progress - 0.68) / 0.24);
    return 0;
}

const PROFILE_RECOIL: Readonly<Record<PetCombatModelProfile, number>> = {
    quadruped: 0.92,
    biped: 1,
    avian: 1.16,
    serpentine: 0.82,
    heavy: 0.58,
};

/** Root displacement behind the skeletal stagger. Larger and lighter bodies
 * travel differently while remaining close enough to their assigned lane. */
export function showdownReactionRecoil(
    impactPower: number,
    profile: PetCombatModelProfile,
    ageMs: number,
): number {
    const power = clamp((impactPower - 0.4) / 0.85, 0, 1);
    const attack = smoothstep(clamp(ageMs / 95, 0, 1));
    const release = 1 - smoothstep(clamp((ageMs - 130) / 390, 0, 1));
    return power * PROFILE_RECOIL[profile] * 0.78 * attack * release;
}

export function showdownDodgeOffset(ageMs: number, profile: PetCombatModelProfile = "quadruped", variant: ShowdownPerformanceVariant = 0): number {
    const duration = profile === "heavy" ? 520 : profile === "avian" ? 400 : 450;
    const arc = Math.sin(Math.PI * clamp(ageMs / duration, 0, 1));
    const range = profile === "heavy" ? 0.72 : profile === "serpentine" ? 1.04 : profile === "avian" ? 1.28 : 0.96;
    return arc * range * (variant === 1 ? -1 : 1);
}

/** Presentation age pauses while hit-stop owns the contact frame, keeping root
 * recoil synchronized with the frozen skeletal reaction. */
export function showdownReactionAge(now: number, hitAt: number, hitStopUntil: number): number {
    if (hitAt <= 0) return Number.POSITIVE_INFINITY;
    const frozen = Math.max(0, Math.min(now, hitStopUntil) - hitAt);
    return Math.max(0, now - hitAt - frozen);
}

/** Compatibility for presentation callers that do not know a profile. New
 * Coliseum fighters use showdownReactionRecoil with their certified profile. */
export function showdownHitRecoil(ageMs: number, impactPower: number): number {
    return showdownReactionRecoil(impactPower, "quadruped", ageMs);
}

/** Stable three-way take selection. Identity—not wall-clock time—chooses a
 * pet's cadence, so replays and screenshot tests remain deterministic. */
export function showdownPerformanceVariant(identity: string): ShowdownPerformanceVariant {
    let hash = 2166136261;
    for (let i = 0; i < identity.length; i += 1) {
        hash ^= identity.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (Math.abs(hash) % 3) as ShowdownPerformanceVariant;
}

export interface ShowdownCinematicImpulse {
    lensDegrees: number;
    hitStopMs: number;
    slowMotionMs: number;
    slowScale: number;
}

/** Damage-aware cinematography shared by regular, signature, and finishing
 * hits. This affects presentation time only; authoritative combat is untouched. */
export function showdownCinematicImpulse({
    damageFraction,
    superMove,
    killingBlow,
    lightning,
}: {
    damageFraction: number;
    superMove: boolean;
    killingBlow: boolean;
    lightning: boolean;
}): ShowdownCinematicImpulse {
    const weight = clamp(damageFraction * 2.5 + (superMove ? 0.35 : 0) + (killingBlow ? 0.45 : 0), 0, 1);
    const hitStop = (95 + weight * 235) * (lightning ? 1.35 : 1);
    return {
        lensDegrees: weight * (killingBlow ? 7.5 : superMove ? 5.8 : 3.8),
        hitStopMs: killingBlow ? Math.max(640, hitStop) : superMove ? Math.max(260, hitStop) : hitStop,
        slowMotionMs: killingBlow ? 920 : superMove ? 440 : weight > 0.72 ? 260 : 0,
        slowScale: killingBlow ? 0.28 : superMove ? 0.48 : 0.68,
    };
}
