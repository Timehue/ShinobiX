import type { PetCombatModelProfile } from "./pet-3d-models";
import { petDuelAttackRhythm } from "./pet-duel-presentation";

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
    presentationScale = 1,
}: {
    targetHeight?: number;
    profile?: PetCombatModelProfile;
    rarity?: string;
    presentationScale?: number;
}): number {
    return clamp(targetHeight * PROFILE_RADIUS[profile] * showdownRarityScale(rarity) * presentationScale, 0.62, 1.58);
}

/** The production renderer's visual rarity scale, shared with its footprint and
 * audit data so the contact solver cannot use a smaller body than the player sees. */
export function showdownRarityScale(rarity: string): number {
    return rarity === "mythic" ? 1.13 : rarity === "legendary" ? 1.07 : rarity === "rare" ? 1.02 : 1;
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

export interface ShowdownPathPoint { x: number; z: number }
export interface ShowdownTravelRoute {
    points: readonly ShowdownPathPoint[];
    length: number;
}
export interface ShowdownMeleeRoute extends ShowdownTravelRoute {
    impactX: number;
    impactZ: number;
    detoured: boolean;
}

type ShowdownObstacle = ShowdownPathPoint & { radius: number };

function clearRoute(points: readonly ShowdownPathPoint[], radius: number, obstacles: readonly ShowdownObstacle[]): boolean {
    return points.slice(1).every((b, i) => obstacles.every(obstacle =>
        showdownSegmentClearance(points[i], b, obstacle) >= radius + obstacle.radius + 0.08 - 1e-9));
}

/** Round a corner only when every resulting swept segment remains clear. */
function travelRoute(points: readonly ShowdownPathPoint[], radius: number, obstacles: readonly ShowdownObstacle[]): ShowdownTravelRoute {
    const distinct = points.filter((point, i) => !i || Math.hypot(point.x - points[i - 1].x, point.z - points[i - 1].z) > 1e-6);
    let rounded = distinct;
    for (const trim of [1.1, 0.55, 0.275]) {
        const candidate = [distinct[0]];
        for (let i = 1; i < distinct.length - 1; i++) {
            const a = distinct[i - 1], corner = distinct[i], b = distinct[i + 1];
            const incoming = Math.hypot(corner.x - a.x, corner.z - a.z);
            const outgoing = Math.hypot(b.x - corner.x, b.z - corner.z);
            const cut = Math.min(trim, incoming * 0.45, outgoing * 0.45);
            const entry = { x: corner.x + (a.x - corner.x) * cut / incoming, z: corner.z + (a.z - corner.z) * cut / incoming };
            const exit = { x: corner.x + (b.x - corner.x) * cut / outgoing, z: corner.z + (b.z - corner.z) * cut / outgoing };
            candidate.push(entry);
            for (let sample = 1; sample <= 16; sample++) {
                const t = sample / 16, s = 1 - t;
                candidate.push({ x: s * s * entry.x + 2 * s * t * corner.x + t * t * exit.x, z: s * s * entry.z + 2 * s * t * corner.z + t * t * exit.z });
            }
        }
        if (distinct.length > 1) candidate.push(distinct[distinct.length - 1]);
        if (clearRoute(candidate, radius, obstacles)) { rounded = candidate; break; }
    }
    return { points: rounded, length: rounded.slice(1).reduce((sum, b, i) => sum + Math.hypot(b.x - rounded[i].x, b.z - rounded[i].z), 0) };
}

/** Reserves use the clear space behind their team instead of cutting through
 * the other field slots. The exchange is staged so incoming/outgoing paths
 * are never occupied at the same time. */
export function showdownReserveRoute(from: ShowdownPathPoint, to: ShowdownPathPoint, radius: number, obstacles: readonly ShowdownObstacle[], side: "player" | "enemy"): ShowdownTravelRoute {
    if (clearRoute([from, to], radius, obstacles)) return travelRoute([from, to], radius, obstacles);
    const sign = side === "player" ? 1 : -1;
    const back = sign * Math.max(sign * from.z, sign * to.z, ...obstacles.map(o => sign * o.z + radius + o.radius + 0.3));
    const corridor = [from, { x: from.x, z: back }, { x: to.x, z: back }, to];
    return travelRoute(clearRoute(corridor, radius, obstacles) ? corridor : [from], radius, obstacles);
}

/** A short acceleration/deceleration ramp leaves a steady gallop between. */
export function showdownTravelProgress(progress: number): number {
    const p = clamp(progress, 0, 1), ramp = 0.16, rate = 1 / (1 - ramp);
    if (p < ramp) return rate * p * p / (2 * ramp);
    if (p > 1 - ramp) return 1 - rate * (1 - p) * (1 - p) / (2 * ramp);
    return rate * (p - ramp / 2);
}

export const SHOWDOWN_SWITCH_TIMING = Object.freeze({ exitEnd: 0.44, entryStart: 0.5, entryEnd: 0.92, reinforcementStart: 0.14 });

/** Swept-disc clearance, not just endpoint spacing: diagonal attacks can
 * otherwise pass through a large team-mate while stopping short of the foe. */
export function showdownSegmentClearance(a: ShowdownPathPoint, b: ShowdownPathPoint, obstacle: ShowdownPathPoint): number {
    const dx = b.x - a.x, dz = b.z - a.z;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq ? clamp(((obstacle.x - a.x) * dx + (obstacle.z - a.z) * dz) / lengthSq, 0, 1) : 0;
    return Math.hypot(obstacle.x - a.x - dx * t, obstacle.z - a.z - dz * t);
}

/** Short recoil and dodge offsets stop at the first neighbour's footprint. */
export function showdownReactionPosition(
    from: ShowdownPathPoint,
    to: ShowdownPathPoint,
    radius: number,
    obstacles: readonly (ShowdownPathPoint & { radius: number })[],
): ShowdownPathPoint {
    const dx = to.x - from.x, dz = to.z - from.z;
    const lengthSq = dx * dx + dz * dz;
    if (lengthSq < 1e-10) return from;
    let limit = 1;
    for (const obstacle of obstacles) {
        const ox = from.x - obstacle.x, oz = from.z - obstacle.z;
        const clearance = radius + obstacle.radius + 0.08;
        const c = ox * ox + oz * oz - clearance * clearance;
        const b = ox * dx + oz * dz;
        if (b >= 0) continue; // Moving away from this neighbour.
        if (c <= 0) { limit = 0; continue; }
        const discriminant = b * b - lengthSq * c;
        if (discriminant < 0) continue;
        limit = Math.min(limit, Math.max(0, (-b - Math.sqrt(discriminant)) / lengthSq));
    }
    return { x: from.x + dx * limit, z: from.z + dz * limit };
}

/** Keep clear lanes straight. If another body obstructs that lane, approach
 * through the empty centre aisle and strike the target from the front.
 * Calculated once per action and shared by the root motion and its wake. */
export function showdownMeleeRoute(
    from: ShowdownPathPoint,
    to: ShowdownPathPoint,
    attackerRadius: number,
    defenderRadius: number,
    obstacles: readonly (ShowdownPathPoint & { radius: number })[],
    strikeDrive = 1,
): ShowdownMeleeRoute {
    const direct = showdownMeleeContact(from.x, from.z, to.x, to.z, attackerRadius, defenderRadius, strikeDrive);
    const clear = (points: readonly ShowdownPathPoint[]) => clearRoute(points, attackerRadius, obstacles);
    let points: ShowdownPathPoint[] = [from, { x: direct.x, z: direct.z }];
    let impact = direct;
    let detoured = false;
    if (!clear(points)) {
        const frontal = showdownMeleeContact(to.x, from.z, to.x, to.z, attackerRadius, defenderRadius, strikeDrive);
        // Leave a short final approach even when the largest contact gap
        // reaches the arena centre, so the pet faces its foe before striking.
        const middleZ = (from.z + to.z) / 2 + Math.sign(from.z - to.z) * 0.4;
        const aisle = [from, { x: from.x, z: middleZ }, { x: to.x, z: middleZ }, { x: frontal.x, z: frontal.z }];
        if (clear(aisle)) {
            points = aisle;
            impact = frontal;
            detoured = true;
        } else {
            // Custom formations may leave no corridor. Hold the root rather
            // than clip through a bystander; the authored attack/VFX still play.
            points = [from];
            detoured = true;
        }
    }
    return {
        ...travelRoute(points, attackerRadius, obstacles), detoured,
        impactX: impact.impactX, impactZ: impact.impactZ,
    };
}

/** Arc-length sampling makes different corridors take the same attack beat.
 * Tangents are supplied so a detour turns its body along the actual dash. */
export function showdownRoutePoint(route: ShowdownTravelRoute, progress: number): ShowdownPathPoint & { dx: number; dz: number } {
    let remaining = route.length * clamp(progress, 0, 1);
    let tangent = { dx: 0, dz: 1 };
    for (let i = 1; i < route.points.length; i++) {
        const a = route.points[i - 1], b = route.points[i];
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        if (length < 0.00001) continue;
        tangent = { dx: (b.x - a.x) / length, dz: (b.z - a.z) / length };
        if (remaining <= length || i === route.points.length - 1) {
            const t = Math.min(1, remaining / length);
            return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dx: (b.x - a.x) / length, dz: (b.z - a.z) / length };
        }
        remaining -= length;
    }
    return { ...route.points[route.points.length - 1], ...tangent };
}

export interface ShowdownAttackRhythm {
    /** First authored anticipation frame; earlier time remains the living idle. */
    windupStart: number;
    /** Melee root travel begins here. Ranged attacks keep charging instead. */
    dashStart: number;
    /** Authoritative contact/release point shared by playback and VFX. */
    contact: number;
    /** End of the held contact pose. */
    contactEnd: number;
    /** End of visible recovery; the remaining beat is a settle breath. */
    recoverEnd: number;
    /** Skeletal animation pace for this presentation weight. */
    attackPace: number;
}

/**
 * One attack clock for the production Showdown renderer. It deliberately
 * consumes both anticipationShare and contactShare from the duel presentation
 * policy: body travel, cast release, impact side effects, and painted VFX must
 * not each invent a different strike frame.
 */
export function showdownAttackRhythm({
    weight,
    superMove,
    delivery,
    moveKind,
}: {
    weight: "light" | "normal" | "heavy";
    superMove: boolean;
    delivery: "melee" | "ranged" | "self";
    moveKind?: string;
}): Readonly<ShowdownAttackRhythm> {
    const damageProxy = superMove ? 1 : weight === "heavy" ? 0.7 : weight === "light" ? 0.08 : 0.36;
    const authored = petDuelAttackRhythm(damageProxy, superMove, moveKind === "crush");
    const contact = clamp(
        (delivery === "ranged" ? 0.4 : 0.35) + authored.anticipationShare * (delivery === "ranged" ? 0.55 : 0.72),
        0.48,
        0.6,
    );
    const windupStart = clamp(contact - authored.anticipationShare, 0.16, 0.38);
    const dashStart = delivery === "melee"
        ? clamp(contact - Math.min(0.22, authored.anticipationShare * 0.65), windupStart + 0.06, contact - 0.07)
        : contact;
    const contactEnd = clamp(contact + authored.contactShare * 0.45, contact + 0.07, 0.76);
    const recoveryShare = superMove ? 0.16 : weight === "heavy" ? 0.19 : weight === "light" ? 0.24 : 0.22;
    return Object.freeze({
        windupStart,
        dashStart,
        contact,
        contactEnd,
        recoverEnd: clamp(contactEnd + recoveryShare, contactEnd + 0.12, 0.94),
        attackPace: superMove ? 0.55 : weight === "heavy" ? 0.75 : weight === "light" ? 1.3 : 1,
    });
}

/** One attack phrase: accelerate, hold the committed contact pose through the
 * hit frame, then recoil home. The smooth edges keep paws from sliding. */
export function showdownMeleeDrive(progress: number, rhythm?: Pick<ShowdownAttackRhythm, "dashStart" | "contact" | "contactEnd" | "recoverEnd">): number {
    const dashStart = rhythm?.dashStart ?? 0.32;
    const contact = rhythm?.contact ?? 0.5;
    const contactEnd = rhythm?.contactEnd ?? 0.68;
    const recoverEnd = rhythm?.recoverEnd ?? 0.92;
    if (progress < dashStart) return 0;
    if (progress < contact) return smoothstep((progress - dashStart) / Math.max(0.001, contact - dashStart));
    if (progress < contactEnd) return 1;
    if (progress < recoverEnd) return 1 - smoothstep((progress - contactEnd) / Math.max(0.001, recoverEnd - contactEnd));
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
