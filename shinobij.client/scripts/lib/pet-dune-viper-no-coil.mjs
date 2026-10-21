import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as T from "three";
import { loadPetDeformationProbeBytes } from "./pet-deformation-probe.mjs";
import { parseStudioGlb, encodeStudioGlb, align4, readStudioAccessor } from "./pet-studio-glb.mjs";
import { fitDuneViperNoCoilSkin } from './pet-dune-viper-no-coil-skin.mjs';
import {compactGlbDelivery} from '../compact-glb-delivery.mjs';
async function rebuildDuneViperNoCoil(input, g, tex) {
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  assert.equal(hash(input), "4d3136a78c73e66269ada4b2f02bcade5b279aa6dd7ea03a56d5c712e9ec398c", "Unexpected pre-remake Viper");
  assert.equal(hash(JSON.stringify(g)), "089d5c29bb243ae405185704535ddfa063edb6e0d671a6d91e86071ca42935f2", "Unexpected authored sculpture");
  assert.equal(hash(tex), "6ba909db13927f920a1ff06a242894d67c385312ef0313903e29f8b36d61c6e3", "Unexpected authored texture");
  g = fitDuneViperNoCoilSkin(g);
  const m = await loadPetDeformationProbeBytes(input), mesh = m.meshes[0], { json, bin } = parseStudioGlb(input);
  if (g.rigLegTranslations) {
    const bones = mesh.skeleton.bones, original = bones.map((b) => b.getWorldPosition(new T.Vector3())), correction = bones.map((b, i) => b.matrixWorld.clone().multiply(mesh.skeleton.boneInverses[i]));
    for (const chain of g.rigLegTranslations) for (const name of chain.names) {
      const i = bones.findIndex((b) => b.name === name), bone = bones[i], target = original[i].clone().add(new T.Vector3(...chain.delta)), local = bone.parent.worldToLocal(target);
      bone.position.copy(local);
      m.update();
      json.nodes[json.skins[0].joints[i]].translation = local.toArray();
      mesh.skeleton.boneInverses[i].copy(bone.matrixWorld).invert().multiply(correction[i]);
    }
  }
  // Place the tail controls along the rebuilt tail rather than the old coil.
  const tailCorrections = mesh.skeleton.bones.map((bone, i) => bone.matrixWorld.clone().multiply(mesh.skeleton.boneInverses[i]));
  for (const [name, position] of [
    ['tail_1', [0, -.29, -.34]], ['tail_2', [.02, -.30, -.54]], ['tail_3', [.04, -.29, -.73]],
  ]) {
    const i = mesh.skeleton.bones.findIndex(bone => bone.name === name);
    const bone = mesh.skeleton.bones[i];
    bone.position.copy(bone.parent.worldToLocal(new T.Vector3(...position)));
    m.update();
    json.nodes[json.skins[0].joints[i]].translation = bone.position.toArray();
    mesh.skeleton.boneInverses[i].copy(bone.matrixWorld).invert().multiply(tailCorrections[i]);
  }
  const flat = g.vertices.flat(), geom = new T.BufferGeometry();
  geom.setAttribute("position", new T.Float32BufferAttribute(flat, 3));
  geom.setIndex(g.faces.flat());
  geom.computeVertexNormals();
  const positions = [], normals = [], uv = [], joints = [], weights = [], indices = [], map = /* @__PURE__ */ new Map();
  for (let f = 0; f < g.faces.length; f++) for (let c = 0; c < 3; c++) {
    const v = g.faces[f][c], w = g.weights[f][c], coord = g.uv[f][c], key = v + ":" + coord.map((n) => n.toFixed(6)).join(",") + ":" + w.map(([j, n]) => j + "," + n.toFixed(6)).join(";");
    let id = map.get(key);
    if (id === void 0) {
      id = positions.length / 3;
      map.set(key, id);
      const skin = new T.Matrix4();
      skin.elements.fill(0);
      for (const [j, amount] of w) {
        const mat = mesh.skeleton.bones[j].matrixWorld.clone().multiply(mesh.skeleton.boneInverses[j]);
        for (let i = 0; i < 16; i++) skin.elements[i] += mat.elements[i] * amount;
      }
      skin.elements[15] = 1;
      const transform = mesh.matrixWorld.clone().multiply(mesh.bindMatrixInverse).multiply(skin).multiply(mesh.bindMatrix), world = new T.Vector3(...g.vertices[v]), raw = world.applyMatrix4(transform.invert());
      positions.push(...raw.toArray());
      const normalSkin = mesh.bindMatrixInverse.clone().multiply(skin).multiply(mesh.bindMatrix), normalTransform = new T.Matrix3().getNormalMatrix(mesh.matrixWorld).multiply(new T.Matrix3().setFromMatrix4(normalSkin));
      const normal = new T.Vector3().fromBufferAttribute(geom.attributes.normal, v).applyMatrix3(normalTransform.invert()).normalize();
      normals.push(...normal.toArray());
      uv.push(...coord);
      for (let i = 0; i < 4; i++) {
        joints.push(w[i]?.[0] ?? 0);
        weights.push(w[i]?.[1] ?? 0);
      }
    }
    indices.push(id);
  }
  let binary = bin;
  function append(array, type, width, componentType = 5126) {
    const b = Buffer.from(array.buffer, array.byteOffset, array.byteLength), o = align4(binary.length);
    binary = Buffer.concat([binary, Buffer.alloc(o - binary.length), b]);
    const vi = json.bufferViews.push({ buffer: 0, byteOffset: o, byteLength: b.length }) - 1, entry = { bufferView: vi, componentType, type, count: array.length / width };
    if (type === "VEC3") {
      entry.min = [0, 1, 2].map((k) => {
        let n = Infinity;
        for (let i = k; i < array.length; i += 3) n = Math.min(n, array[i]);
        return n;
      });
      entry.max = [0, 1, 2].map((k) => {
        let n = -Infinity;
        for (let i = k; i < array.length; i += 3) n = Math.max(n, array[i]);
        return n;
      });
    }
    return json.accessors.push(entry) - 1;
  }
  const texOffset = align4(binary.length);
  binary = Buffer.concat([binary, Buffer.alloc(texOffset - binary.length), tex]);
  json.images[0] = { bufferView: json.bufferViews.push({ buffer: 0, byteOffset: texOffset, byteLength: tex.length }) - 1, mimeType: "image/webp" };
  const prim = json.meshes[0].primitives[0];
  prim.attributes = { POSITION: append(Float32Array.from(positions), "VEC3", 3), NORMAL: append(Float32Array.from(normals), "VEC3", 3), TEXCOORD_0: append(Float32Array.from(uv), "VEC2", 2), JOINTS_0: append(Uint16Array.from(joints), "VEC4", 4, 5123), WEIGHTS_0: append(Float32Array.from(weights), "VEC4", 4) };
  prim.indices = append(Uint32Array.from(indices), "SCALAR", 1, 5125);
  if (g.rigLegTranslations) json.skins[0].inverseBindMatrices = append(Float32Array.from(mesh.skeleton.boneInverses.flatMap((b) => b.toArray())), "MAT4", 16);
  // A constant clearance offset preserves the complete motion and every
  // interpolation interval; only the vertical floor placement changes.
  const lifted = new Map();
  for (const animation of json.animations) for (const channel of animation.channels) {
    if (channel.target.path !== 'translation' || json.nodes[channel.target.node].name !== 'root') continue;
    const sampler = animation.samplers[channel.sampler], original = sampler.output;
    if (!lifted.has(original)) {
      const {values} = await readStudioAccessor(json, binary, original);
      for (let i = 1; i < values.length; i += 3) values[i] += .003;
      lifted.set(original, append(values, 'VEC3', 3));
    }
    sampler.output = lifted.get(original);
  }
  json.buffers[0].byteLength = align4(binary.length);
  json.extras.rearCoilRebuild = { status: "authored-candidate", revision: "20261021-viper-lean-no-coil-v1", rigLegTranslations: g.rigLegTranslations ?? [], floorLift: .003, scope: "Rebuild a lean torso and one tapered rearward tail without the coil. Fit continuous anatomical limb weights and the stance. Preserve the original head texture pixels and thirteen performances, with a constant vertical floor-clearance offset." };
  return compactGlbDelivery(encodeStudioGlb(json, binary));
}
export {
  rebuildDuneViperNoCoil
};
