import { Euler, Quaternion } from 'three';

const clamp = p => Math.max(0, Math.min(1, p));
const smooth = p => { p = clamp(p); return p * p * (3 - 2 * p); };
const pulse = (p, begin, peak, end) => p <= peak ? smooth((p - begin) / (peak - begin)) : 1 - smooth((p - peak) / (end - peak));
const attackClips = new Set(['attack', 'cast']);

/** Bounded, anatomy-specific articulation. Existing authored joint curves win.
 * Distal flex supports the original pose; delayed appendages resolve afterward. */
export function studioJointDeltas(names, clip, p) {
    const result = new Map(), put = (name, x, y = 0, z = 0) => { if (names.has(name)) result.set(name, [x, y, z].map(value => value * .5)); };
    const attack = attackClips.has(clip), jump = clip === 'gallop_jump' || clip === 'entrance';
    const guard = clip === 'guard', hit = clip === 'idle_hitreact1', victory = clip === 'victory';
    if (!attack && !jump && !guard && !hit && !victory) return result;
    const coil = attack ? pulse(p, 0, .30, .56) : jump ? pulse(p, 0, .28, .68) : guard ? smooth(p / .26) : hit ? pulse(p, 0, .12, .52) : pulse(p, 0, .28, .72);
    const follow = attack ? pulse(p, .45, .67, 1) : jump ? pulse(p, .55, .79, 1) : hit ? pulse(p, .12, .3, 1) : 0;
    const support = (clip === 'cast' ? .65 : 1);
    for (const [side, sign] of [['L', 1], ['R', -1]]) {
        const lead = side === 'L' ? 1 : .78;
        put(`front_lower.${side}`, (-.22 * coil + .05 * follow) * support * lead);
        put(`front_paw.${side}`, (.13 * coil - .08 * follow) * support * lead);
        put(`hind_lower.${side}`, -.15 * coil + .04 * follow);
        put(`hind_paw.${side}`, .1 * coil - .05 * follow);
        put(`forearm.${side}`, (-.26 * coil + .07 * follow) * support * lead, 0, -.025 * sign * coil);
        put(`hand.${side}`, (.1 * coil - .08 * follow) * support * lead);
        put(`shin.${side}`, -.17 * coil + .035 * follow);
        put(`foot.${side}`, .11 * coil - .035 * follow);
        // Small folds preserve layered feather bindings; flight's authored
        // shoulder movement keeps control of the overall wing silhouette.
        if (!jump) {
            put(`wing_mid.${side}`, .065 * sign * coil, 0, .04 * sign * follow);
            put(`wing_tip.${side}`, .045 * sign * follow);
        }
        put(`bat_wing_lower.${side}`, .075 * sign * coil, 0, .035 * sign * follow);
        put(`claw_pincer.${side}`, 0, .09 * sign * (coil - .35 * follow));
        for (const part of ['front', 'mid', 'rear']) {
            const gain = part === 'front' ? 1 : part === 'mid' ? .8 : .6;
            put(`leg_${part}_lower.${side}`, -.12 * coil * gain + .025 * follow);
            put(`leg_${part}_foot.${side}`, .075 * coil * gain - .02 * follow);
        }
    }
    return result;
}

/** Sample a glTF quaternion channel, including normalized Hermite splines. */
export function sampleStudioRotation(times, values, interpolation, p) {
    const time = clamp(p) * times[times.length - 1];
    let lower = 0;
    while (lower < times.length - 2 && time > times[lower + 1]) lower++;
    const upper = Math.min(lower + 1, times.length - 1), span = times[upper] - times[lower];
    const u = span > 0 ? clamp((time - times[lower]) / span) : 0;
    if (interpolation !== 'CUBICSPLINE') {
        const a = new Quaternion().fromArray(values, lower * 4), b = new Quaternion().fromArray(values, upper * 4);
        return interpolation === 'STEP' ? a : a.slerp(b, u).normalize();
    }
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u;
    const h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
    const q = new Quaternion();
    q.fromArray(Array.from({ length: 4 }, (_, axis) => h00 * values[lower * 12 + 4 + axis]
        + h10 * span * values[lower * 12 + 8 + axis] + h01 * values[upper * 12 + 4 + axis] + h11 * span * values[upper * 12 + axis]));
    return q.normalize();
}

export function delayedStudioRotation(sourceBind, targetBind, source, p, lag, gain) {
    const delta = sourceBind.clone().invert().multiply(source(Math.max(0, p - lag)));
    const rotation = new Euler().setFromQuaternion(delta, 'XYZ');
    // One-shots settle at their original bind, avoiding a secondary-joint
    // pop when the renderer hands control back to the neutral pose.
    const envelope = smooth(p / .1) * (1 - smooth((p - .84) / .16));
    return targetBind.clone().multiply(new Quaternion().setFromEuler(new Euler(
        Math.max(-.16, Math.min(.16, rotation.x * gain)) * envelope,
        Math.max(-.20, Math.min(.20, rotation.y * gain)) * envelope,
        Math.max(-.12, Math.min(.12, rotation.z * gain)) * envelope,
    ))).normalize();
}
