import {MathUtils} from 'three';

// Indices are tied to the pinned four-legged source rig. The old coiled
// sculpture is not a valid nearest-surface weight donor for a straight torso.
const legs = [
    {x: .155, z: .26, joints: [6, 7, 8]},
    {x: -.165, z: .26, joints: [9, 10, 11]},
    {x: .165, z: -.23, joints: [15, 16, 17]},
    {x: -.18, z: -.23, joints: [18, 19, 20]},
];
const smooth = (a, b, value) => {
    const t = MathUtils.clamp((value - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
};

/** Continuous torso/limb ownership, retaining the independently picked face. */
export function fitDuneViperNoCoilSkin(authored) {
    const result = structuredClone(authored);
    for (let face = 0; face < result.faces.length; face++) for (let corner = 0; corner < 3; corner++) {
        const [x, y, z] = result.vertices[result.faces[face][corner]];
        if (y >= -.12) continue;
        const leg = legs[(z > .04 ? 0 : 2) + (x < 0 ? 1 : 0)];
        const distance = Math.hypot(x - leg.x, z - leg.z);
        const amount = Math.max(
            (1 - smooth(.06, .15, distance)) * smooth(-.24, -.38, y),
            smooth(-.38, -.43, y),
        );
        const lower = smooth(-.31, -.405, y), foot = smooth(-.40, -.455, y);
        const weights = new Map([
            [1, 1 - amount],
            [leg.joints[0], amount * (1 - lower)],
            [leg.joints[1], amount * lower * (1 - foot)],
            [leg.joints[2], amount * lower * foot],
        ]);
        const neck = smooth(-.28, -.12, y) * smooth(.10, .24, z);
        if (neck) {
            for (const [joint, weight] of weights) weights.set(joint, weight * (1 - neck));
            for (const [joint, weight] of result.weights[face][corner]) {
                weights.set(joint, (weights.get(joint) ?? 0) + weight * neck);
            }
        }
        // Keep the new tail on its own fitted chain. The fade starts behind
        // the hind feet, so no ankle can inherit these controls.
        const pelvis = weights.get(1) ?? 0;
        const tail = smooth(.34, .44, -z);
        const middle = smooth(.43, .60, -z), tip = smooth(.58, .74, -z);
        if (tail) {
            weights.set(1, pelvis * (1 - tail));
            weights.set(12, pelvis * tail * (1 - middle));
            weights.set(13, pelvis * tail * middle * (1 - tip));
            weights.set(14, pelvis * tail * middle * tip);
        }
        const top = [...weights].filter(([, weight]) => weight > 1e-9)
            .sort((a, b) => b[1] - a[1]).slice(0, 4);
        const total = top.reduce((sum, [, weight]) => sum + weight, 0);
        result.weights[face][corner] = top.map(([joint, weight]) => [joint, weight / total]);
    }
    return result;
}
