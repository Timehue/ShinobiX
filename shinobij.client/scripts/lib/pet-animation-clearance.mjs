import { Quaternion } from 'three';
import { align4, readStudioAccessor } from './pet-studio-glb.mjs';

// A reviewed collision can require a smaller authored excursion after a face
// binding correction. Keep this explicit and limited to named rotation tracks.
export function reduceReviewedRotationExcursion(values, factor) {
    if (!(factor > 0 && factor < 1) || values.length % 12) throw Error('Invalid cubic rotation clearance');
    const result = Float32Array.from(values), base = new Quaternion().fromArray(values, 4), q = new Quaternion();
    for (let key = 0; key < values.length / 12; key++) {
        q.fromArray(values, key * 12 + 4);
        base.clone().slerp(q, factor).toArray(result, key * 12 + 4);
        for (const start of [key * 12, key * 12 + 8]) for (let c = 0; c < 4; c++) result[start + c] *= factor;
    }
    if (!Array.from(result).every(Number.isFinite)) throw Error('Non-finite rotation clearance');
    return result;
}

export async function applyReviewedAnimationClearance(json, bin, config) {
    if (!config) return bin;
    const { clip: name, bones, rotationExcursion, reason } = config;
    if (!name || !reason || !Array.isArray(bones) || !bones.length || new Set(bones).size !== bones.length) throw Error('Explicit reviewed collision tracks required');
    const clip = json.animations.find(a => a.name === name);
    if (!clip) throw Error('Reviewed collision clip missing');
    let binary = bin;
    const changed = new Set();
    for (const channel of clip.channels) {
        const bone = json.nodes[channel.target.node].name;
        if (!bones.includes(bone) || channel.target.path !== 'rotation') continue;
        if (changed.has(bone)) throw Error('Ambiguous collision rotation channel');
        const sampler = clip.samplers[channel.sampler];
        if (sampler.interpolation !== 'CUBICSPLINE') throw Error('Reviewed collision requires cubic rotation tracks');
        const { values, width } = await readStudioAccessor(json, bin, sampler.output);
        if (width !== 4) throw Error('Expected rotation quaternions');
        const corrected = reduceReviewedRotationExcursion(values, rotationExcursion);
        const offset = align4(binary.length), bytes = Buffer.from(corrected.buffer);
        binary = Buffer.concat([binary, Buffer.alloc(offset - binary.length), bytes]);
        const view = json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length }) - 1;
        sampler.output = json.accessors.push({ bufferView: view, componentType: 5126, count: corrected.length / 4, type: 'VEC4' }) - 1;
        changed.add(bone);
    }
    if (changed.size !== bones.length) throw Error('Incomplete reviewed collision correction');
    json.buffers[0].byteLength = align4(binary.length);
    return binary;
}
