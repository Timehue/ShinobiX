import { KUNAI_HAUL_MS, KUNAI_RETURN_MS, kunaiFish, kunaiFlightMs, type KunaiThrow } from '../../../shared/kunai-fishing';

export type Point = { x: number; y: number };
export type KunaiPose = Point & { angle: number };
export const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
export const smooth = (value: number) => { const t = clamp01(value); return t * t * (3 - 2 * t); };
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const mixAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
export const weaponTip = (pose: KunaiPose, unit: number): Point => ({ x: pose.x + Math.cos(pose.angle) * 24.5 * unit, y: pose.y + Math.sin(pose.angle) * 24.5 * unit });
export const weaponRing = (pose: KunaiPose, unit: number): Point => ({ x: pose.x - Math.cos(pose.angle) * 19.6 * unit, y: pose.y - Math.sin(pose.angle) * 19.6 * unit });
export const kunaiWindupMs = (shot: KunaiThrow) => Math.min(110, kunaiFlightMs(shot) * .23);

/** Integrate each startle impulse so changing swim speed never resets the tail's phase. */
export function fishSpineMotion(index: number, at: number, misses: KunaiThrow[], caughtAt?: number) {
    let phase = at / 1000 * (7 + index * .55), agitation = 0;
    for (const miss of misses) {
        const age = (at - miss.at - kunaiFlightMs(miss)) / 1000;
        if (age < 0) continue;
        phase += 8 * (.65 * (1 - Math.exp(-age / .65)) - .09 * (1 - Math.exp(-age / .09)));
        agitation += 1.4 * (Math.exp(-age / .65) - Math.exp(-age / .09));
    }
    if (caughtAt != null && at >= caughtAt) {
        const age = (at - caughtAt) / 1000;
        phase += 8 * (age - .12 * (1 - Math.exp(-age / .12)));
        agitation += smooth(age / .15);
    }
    return { phase, agitation: clamp01(agitation) };
}

export function kunaiRestPose(w: number, h: number, aim: Point, unit: number): KunaiPose {
    const x = w * .5 + 22 * unit, y = h - 65 * unit;
    return { x, y, angle: Math.atan2(aim.y / 100 * h - y, aim.x / 100 * w - x) };
}

/** Includes anticipation and follow-through inside the existing server flight time. */
export function kunaiThrowPose(w: number, h: number, shot: KunaiThrow, age: number, unit: number, reduced = false): KunaiPose {
    const rest = kunaiRestPose(w, h, shot, unit), windup = kunaiWindupMs(shot);
    const wind = smooth(age / windup), recoil = reduced ? 0 : 1;
    const release = { x: rest.x + 11 * unit * recoil, y: rest.y + 12 * unit * recoil, angle: rest.angle + .13 * recoil };
    if (age < windup) return { x: mix(rest.x, release.x, wind), y: mix(rest.y, release.y, wind), angle: mixAngle(rest.angle, release.angle, wind) };
    const t = clamp01((age - windup) / (kunaiFlightMs(shot) - windup));
    const u = 1 - (1 - t) ** 1.25, v = 1 - u;
    const start = weaponTip(release, unit), end = { x: shot.x / 100 * w, y: shot.y / 100 * h };
    const distance = Math.hypot(end.x - start.x, end.y - start.y), arc = reduced ? 0 : 14 * unit;
    const c1 = { x: start.x + Math.cos(release.angle) * distance * .34, y: start.y + Math.sin(release.angle) * distance * .34 };
    const c2 = { x: mix(start.x, end.x, .78), y: mix(start.y, end.y, .78) - arc };
    const x = v ** 3 * start.x + 3 * v * v * u * c1.x + 3 * v * u * u * c2.x + u ** 3 * end.x;
    const y = v ** 3 * start.y + 3 * v * v * u * c1.y + 3 * v * u * u * c2.y + u ** 3 * end.y;
    const dx = 3 * v * v * (c1.x - start.x) + 6 * v * u * (c2.x - c1.x) + 3 * u * u * (end.x - c2.x);
    const dy = 3 * v * v * (c1.y - start.y) + 6 * v * u * (c2.y - c1.y) + 3 * u * u * (end.y - c2.y);
    const angle = Math.atan2(dy, dx);
    return { x: x - Math.cos(angle) * 24.5 * unit, y: y - Math.sin(angle) * 24.5 * unit, angle };
}

/** Ease both ends of a miss; the final pose is exactly the ready hand pose. */
export function kunaiReturnPose(w: number, h: number, shot: KunaiThrow, age: number, unit: number, reduced = false): KunaiPose {
    const start = kunaiThrowPose(w, h, shot, kunaiFlightMs(shot), unit, reduced), end = kunaiRestPose(w, h, shot, unit);
    const t = smooth((age - 90) / (KUNAI_RETURN_MS - 90));
    const arc = reduced ? 0 : Math.sin(t * Math.PI) * 12 * unit;
    return { x: mix(start.x, end.x, t), y: mix(start.y, end.y, t) - arc, angle: mixAngle(start.angle, end.angle, t) };
}

export function hauledFishPose(seed: number, index: number, shot: KunaiThrow, age: number, w: number, h: number, misses: KunaiThrow[] = []): KunaiPose {
    const impact = shot.at + kunaiFlightMs(shot), point = kunaiFish(seed, index, impact, misses), next = kunaiFish(seed, index, impact + 40, misses);
    const t = clamp01(age / KUNAI_HAUL_MS), s = smooth(t), tangent = t * (1 - t) ** 2;
    const start = { x: point.x / 100 * w, y: point.y / 100 * h }, end = { x: w * .49, y: h * .89 };
    const vx = (next.x - point.x) / 100 * w / 40, vy = (next.y - point.y) / 100 * h / 40;
    const angle = Math.atan2(vy, vx), shoreAngle = Math.atan2(end.y - start.y, end.x - start.x);
    return { x: mix(start.x, end.x, s) + tangent * vx * KUNAI_HAUL_MS,
        y: mix(start.y, end.y, s) + tangent * vy * KUNAI_HAUL_MS,
        angle: mixAngle(angle, shoreAngle, smooth(age / 500)) };
}

export function outmatchedFishPose(seed: number, index: number, shot: KunaiThrow, age: number, w: number, h: number, misses: KunaiThrow[] = []): KunaiPose {
    const start = hauledFishPose(seed, index, shot, 0, w, h, misses);
    const t = smooth((age - 300) / (KUNAI_HAUL_MS - 300)), direction = start.x < w * .5 ? -1 : 1;
    return { x: start.x + direction * w * .65 * t, y: start.y - h * .6 * t,
        angle: mixAngle(start.angle, Math.atan2(-h * .6, direction * w * .65), t) };
}

/** The blade remains attached at the same point as the fish turns and comes ashore. */
export function attachedKunaiPose(w: number, h: number, shot: KunaiThrow, fish: KunaiPose, initialFish: KunaiPose, age: number, unit: number, reduced = false): KunaiPose {
    const impact = kunaiThrowPose(w, h, shot, kunaiFlightMs(shot), unit, reduced);
    const tip = weaponTip(impact, unit), rotation = fish.angle - initialFish.angle;
    const dx = tip.x - initialFish.x, dy = tip.y - initialFish.y;
    const angle = mixAngle(impact.angle, fish.angle, smooth(age / 500));
    return { x: fish.x + dx * Math.cos(rotation) - dy * Math.sin(rotation) - Math.cos(angle) * 24.5 * unit,
        y: fish.y + dx * Math.sin(rotation) + dy * Math.cos(rotation) - Math.sin(angle) * 24.5 * unit, angle };
}
