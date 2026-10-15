/** Reviewed Oni skull envelope in the original mesh's local coordinates.
 * Preserve geometry, atlas, rig and animation payloads; change only skin weights.
 * Write a separate candidate so it can be inspected before promotion. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { Uint8BufferAttribute } from 'three';
import { MeshoptEncoder } from 'meshoptimizer';
import { repairPetSkinWeights } from '../src/lib/pet-skin-weight-repair.ts';
import { loadPetDeformationProbe } from './lib/pet-deformation-probe.mjs';
import { parseStudioGlb, encodeStudioGlb, align4 } from './lib/pet-studio-glb.mjs';
import { compactGlbDelivery } from './compact-glb-delivery.mjs';

export const ONI_SKULL_REPAIR_REVISION = '20261015-oni-full-face-v2';
const ONI_REPAIR_SOURCE_SHA256 = '5c3736144f5b895c963cae5f79a19b2856f1c7fc7898d25d9b1a22190375bf98';
const NECK_TRANSITION_EDGES = [[7683,7691],[7690,7688],[13666,13665]];
export const oniSkullShare = point => {
    const smooth = (lo, hi, value) => { const t = Math.max(0, Math.min(1, (value-lo)/(hi-lo))); return t*t*(3-2*t); };
    const upperSkull = smooth(-.02, .16, point.y) * smooth(.06, .30, point.z);
    // The muzzle, lips and lower jaw sit BELOW the upper-skull envelope.
    // Binding only the brow/eyes left the mouth following the neck and chest,
    // so a normal head nod closed and stretched the unarticulated jaw.
    const completeFace = smooth(-.32, -.18, point.y) * smooth(.35, .55, point.z);
    return Math.max(upperSkull, completeFace);
};
export async function repairOniSkull(source, destination) {
    if (resolve(source) === resolve(destination)) throw Error('Write an inspection candidate first');
    const bytes = await readFile(source), { json, bin } = parseStudioGlb(bytes);
    if (json.extras?.skullBindingRepair) throw Error('Use the original unrepaired asset');
    if (createHash('sha256').update(bytes).digest('hex') !== ONI_REPAIR_SOURCE_SHA256) throw Error('Oni anatomical landmarks require the recorded original geometry and rig');
    const model = await loadPetDeformationProbe(source);
    if (model.meshes.length !== 1) throw Error('Expected the reviewed single Oni surface');
    const mesh = model.meshes[0], { position, skinIndex, skinWeight } = mesh.geometry.attributes;
    const head = mesh.skeleton.bones.findIndex(b => b.name === 'head');
    if (head < 0 || json.extras?.properAnimationIdentity?.key !== 'mythic-4:abyssal oni hound') throw Error('Expected Oni Hound rig');
    const joints = new Uint8Array(position.count * 4), weights = new Uint8Array(position.count * 4);
    let changed = 0, rigid = 0;
    for (let v = 0; v < position.count; v++) {
        const share = oniSkullShare({ y: position.getY(v), z: position.getZ(v) });
        if (!share) {
            for (let s = 0; s < 4; s++) { joints[v*4+s] = skinIndex.getComponent(v,s); weights[v*4+s] = Math.round(skinWeight.getComponent(v,s)*255); }
            continue;
        }
        const influences = new Map();
        for (let s = 0; s < 4; s++) { const j = skinIndex.getComponent(v,s); influences.set(j, (influences.get(j) ?? 0) + skinWeight.getComponent(v,s)*(1-share)); }
        influences.set(head, (influences.get(head) ?? 0) + share);
        const ranked = [...influences].filter(([,w]) => w > 0).sort((a,b) => b[1]-a[1]).slice(0,4);
        const total = ranked.reduce((n,[,w]) => n+w,0);
        ranked.forEach(([j,w],s) => { joints[v*4+s] = j; weights[v*4+s] = Math.round(w/total*255); });
        weights[v*4] += 255-weights.subarray(v*4,v*4+4).reduce((n,w) => n+w,0);
        changed++; if (share === 1) rigid++;
    }
    if (rigid < 3000) throw Error('Skull envelope did not cover the reviewed face');
    // Diffuse only the measured connected neck neighborhood. Rigid facial
    // vertices stay locked while the jaw transitions into the scarf/chest.
    const bound = mesh.geometry.clone();
    bound.setAttribute('skinIndex', new Uint8BufferAttribute(joints,4));
    bound.setAttribute('skinWeight', new Uint8BufferAttribute(weights,4,true));
    const transition = repairPetSkinWeights(bound,mesh.skeleton.bones.length,head,48,NECK_TRANSITION_EDGES);
    const repairedJoints = transition.geometry.getAttribute('skinIndex'), repairedWeights = transition.geometry.getAttribute('skinWeight');
    let protectedFootVertices = 0;
    for (let v=0;v<position.count;v++) {
        // Keep the authored grounded paws/ankles exactly as they were. The
        // connected scarf neighborhood can otherwise reach a few distal UV
        // copies and introduce tiny, unrelated changes in their binding.
        if (position.getY(v)<-.65) { protectedFootVertices++; continue; }
        for (let s=0;s<4;s++) { joints[v*4+s]=repairedJoints.getComponent(v,s);weights[v*4+s]=Math.round(repairedWeights.getComponent(v,s)*255); }
        weights[v*4]+=255-weights.subarray(v*4,v*4+4).reduce((sum,w)=>sum+w,0);
    }
    await MeshoptEncoder.ready;
    let binary = bin;
    let fallback = json.buffers.findIndex(b => b.extensions?.EXT_meshopt_compression?.fallback);
    if (fallback < 0) { fallback = json.buffers.length; json.buffers.push({ byteLength: 0, extensions: { EXT_meshopt_compression: { fallback: true } } }); }
    const append = (array, normalized) => {
        const packed = MeshoptEncoder.encodeGltfBuffer(array, position.count, 4, 'ATTRIBUTES');
        const offset = align4(binary.length), rawOffset = align4(json.buffers[fallback].byteLength);
        binary = Buffer.concat([binary, Buffer.alloc(offset-binary.length), packed]);
        json.buffers[fallback].byteLength = rawOffset+array.length;
        const view = json.bufferViews.push({ buffer:fallback, byteOffset:rawOffset, byteLength:array.length, byteStride:4, target:34962,
            extensions:{ EXT_meshopt_compression:{ buffer:0, byteOffset:offset, byteLength:packed.length, byteStride:4, count:position.count, mode:'ATTRIBUTES' } } })-1;
        return json.accessors.push({ bufferView:view, componentType:5121, count:position.count, type:'VEC4', ...(normalized ? { normalized:true } : {}) })-1;
    };
    const primitive = json.meshes[0].primitives[0]; primitive.attributes.JOINTS_0 = append(joints,false); primitive.attributes.WEIGHTS_0 = append(weights,true);
    json.buffers[0].byteLength = align4(binary.length);
    json.extras.skullBindingRepair = { revision:ONI_SKULL_REPAIR_REVISION, sourceSha256:createHash('sha256').update(bytes).digest('hex'),
        envelope:{ y:[-.02,.16], z:[.06,.30], union:[{y:[-.32,-.18],z:[.35,.55]}], coordinateSpace:'original-mesh-local' }, changedVertices:changed, rigidSkullVertices:rigid,
        neckTransition:{iterations:48,edges:NECK_TRANSITION_EDGES,protectedFootVertices} };
    const compacted = parseStudioGlb(compactGlbDelivery(encodeStudioGlb(json,binary)));
    // Compaction reindexes live accessors. A later reauthor must retain the
    // repaired weight payload rather than truncate at the historical boundary.
    compacted.json.extras.properAnimationSourceBoundary = { binLength:compacted.bin.length,
        accessorCount:compacted.json.accessors.length, bufferViewCount:compacted.json.bufferViews.length };
    const output = encodeStudioGlb(compacted.json,compacted.bin);
    await mkdir(dirname(destination), { recursive:true }); await writeFile(destination,output);
    return { changed, rigid, bytes:output.length, sourceBytes:bytes.length };
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
    console.log(JSON.stringify(await repairOniSkull(resolve(process.argv[2]),resolve(process.argv[3]))));
}
