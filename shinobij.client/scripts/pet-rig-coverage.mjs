import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';
import { runtimePetModels } from './lib/pet-runtime-audit.mjs';
import { createPetCombatRigMotion } from '../src/lib/pet-combat-rig-motion.ts';
import { INDIVIDUAL_PET_ANIMATION_MODEL_IDS } from '../src/lib/pet-proper-animation-assets.ts';
await MeshoptDecoder.ready;
const loader=new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const models=[];
for(const {pet,model,path} of runtimePetModels) {
    const bytes=await readFile(path), length=bytes.readUInt32LE(12), json=JSON.parse(bytes.subarray(20,20+length)), binary=bytes.subarray(28+length);
    json.materials=[]; json.textures=[]; json.images=[];
    for(const mesh of json.meshes) for(const p of mesh.primitives) delete p.material;
    const text=Buffer.from(JSON.stringify(json)), size=(text.length+3)&~3, out=Buffer.alloc(28+size+binary.length);
    out.writeUInt32LE(0x46546c67,0); out.writeUInt32LE(2,4); out.writeUInt32LE(out.length,8); out.writeUInt32LE(size,12); out.writeUInt32LE(0x4e4f534a,16); out.fill(32,20,20+size); text.copy(out,20);
    out.writeUInt32LE(binary.length,20+size); out.writeUInt32LE(0x004e4942,24+size); binary.copy(out,28+size);
    const gltf=await loader.parseAsync(out.buffer.slice(out.byteOffset,out.byteOffset+out.byteLength),'');
    const detailed=INDIVIDUAL_PET_ANIMATION_MODEL_IDS.has(model.visualId), layer=createPetCombatRigMotion([gltf.scene],detailed);
    const upper=gltf.scene.getObjectByName('wing_upperL'), mid=gltf.scene.getObjectByName('wing_midL');
    const named=new Map(); gltf.scene.traverse(node=>{if(node.isBone) named.set(node.name.replace(/[._]([LR])$/u,'$1'),node);});
    const leg=['L','R'].some(side=>[['front_upper','front_lower','front_paw'],['hind_upper','hind_lower','hind_paw'],['thigh','shin','foot']].some(([a,b,c])=>{
        const upper=named.get(a+side),lower=named.get(b+side),tip=named.get(c+side);
        return !!upper && lower?.parent===upper && tip?.parent===lower;
    }));
    models.push({id:pet.id,visualId:model.visualId,profile:model.profile,detailed,secondaryJoints:layer.jointCount,
        wingLayer:model.profile==='avian' && !!upper && mid?.parent===upper,
        distalRecovery:!detailed && leg, animationClips:gltf.animations.map(c=>c.name)});
}
const result={summary:{identities:models.length,mixerImprovements:models.length,secondaryMotion:models.filter(m=>m.secondaryJoints>0).length,
    wingLayer:models.filter(m=>m.wingLayer).length,distalRecovery:models.filter(m=>m.distalRecovery).length,detailedPreserved:models.filter(m=>m.detailed).length},models};
await writeFile(resolve(import.meta.dirname,'../../docs/pet-motion-evidence/rig-coverage.json'),JSON.stringify(result,null,2)); console.log(JSON.stringify(result.summary));
