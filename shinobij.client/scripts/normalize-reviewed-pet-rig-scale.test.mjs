import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import * as THREE from 'three';
import {encodeStudioGlb,parseStudioGlb,readStudioAccessor,align4} from './lib/pet-studio-glb.mjs';
import {loadPetDeformationProbe,preparePetHeadProbe,snapshotPetPose} from './lib/pet-deformation-probe.mjs';
import {normalizeReviewedPetRigScale} from './normalize-reviewed-pet-rig-scale.mjs';

function fixture(interpolation){
 const json={asset:{version:'2.0'},extras:{},scene:0,scenes:[{nodes:[0,3]}],nodes:[
  {name:'Rig',scale:[3,1,.8],children:[1]},
  {name:'root',translation:[0,.1,0],children:[2]},
  {name:'head',translation:[0,.4,0],rotation:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),.35).toArray()},
  {name:'Body',mesh:0,skin:0},
 ],skins:[{joints:[1,2]}],meshes:[{primitives:[{attributes:{}}]}],animations:[],buffers:[{byteLength:0}],bufferViews:[],accessors:[]};
 let binary=Buffer.alloc(0);
 const append=(array,type,count)=>{const bytes=Buffer.from(array.buffer,array.byteOffset,array.byteLength),offset=align4(binary.length);binary=Buffer.concat([binary,Buffer.alloc(offset-binary.length),bytes]);
  const bufferView=json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length})-1;
  return json.accessors.push({bufferView,componentType:array instanceof Uint16Array?5123:5126,type,count})-1;};
 const plane=new THREE.PlaneGeometry(.6,.4,5,5),count=plane.attributes.position.count;
 const primitive=json.meshes[0].primitives[0];
 primitive.attributes.POSITION=append(plane.attributes.position.array,'VEC3',count);Object.assign(json.accessors[primitive.attributes.POSITION],{min:[-.3,-.2,0],max:[.3,.2,0]});
 primitive.attributes.NORMAL=append(plane.attributes.normal.array,'VEC3',count);
 primitive.indices=append(plane.index.array,'SCALAR',plane.index.count);
 const joints=new Uint16Array(count*4),weights=new Float32Array(count*4);for(let i=0;i<count;i++){joints[i*4]=1;weights[i*4]=1;}
 primitive.attributes.JOINTS_0=append(joints,'VEC4',count);primitive.attributes.WEIGHTS_0=append(weights,'VEC4',count);
 const rig=new THREE.Group(),root=new THREE.Bone(),head=new THREE.Bone();rig.scale.set(3,1,.8);root.position.y=.1;head.position.y=.4;head.rotation.z=.35;rig.add(root);root.add(head);rig.updateMatrixWorld(true);
 const ibm=new Float32Array(32);root.matrixWorld.clone().invert().toArray(ibm,0);head.matrixWorld.clone().invert().toArray(ibm,16);json.skins[0].inverseBindMatrices=append(ibm,'MAT4',2);
 const times=append(new Float32Array([0,1]),'SCALAR',2);Object.assign(json.accessors[times],{min:[0],max:[1]});
 const rotations=[head.quaternion.toArray(),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),1.4).toArray()];
 const translations=[[0,.1,0],[.2,.2,.1]],cubic=interpolation==='CUBICSPLINE';
 const rotationOutput=new Float32Array(cubic?rotations.flatMap(q=>[[.03,0,.02,0],q,[.03,0,.02,0]]).flat():rotations.flat());
 const translationOutput=new Float32Array(cubic?translations.flatMap(p=>[[.1,.02,.03],p,[.1,.02,.03]]).flat():translations.flat());
 json.animations=[{name:'pose',channels:[{sampler:0,target:{node:2,path:'rotation'}},{sampler:1,target:{node:1,path:'translation'}}],samplers:[
  {input:times,output:append(rotationOutput,'VEC4',cubic?6:2),interpolation},
  {input:times,output:append(translationOutput,'VEC3',cubic?6:2),interpolation},
 ]}];json.buffers[0].byteLength=align4(binary.length);return encodeStudioGlb(json,binary);
}
for(const interpolation of ['LINEAR','STEP','CUBICSPLINE'])test(`rig normalization preserves bind geometry and rigid skull motion with ${interpolation} tracks`,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'pet-rig-normalization-'));
 try{
  const source=join(directory,'source.glb'),candidate=join(directory,'candidate.glb');await writeFile(source,fixture(interpolation));
  const before=await loadPetDeformationProbe(source),beforeProbe=preparePetHeadProbe(before.meshes[0]),beforeMixer=new THREE.AnimationMixer(before.scene);
  const beforeAction=beforeMixer.clipAction(before.animations[0]).setLoop(THREE.LoopOnce,1);beforeAction.clampWhenFinished=true;beforeAction.play();beforeAction.time=1;beforeMixer.update(0);before.update();
  assert.ok(beforeProbe.measure().worldMaxRatio>1.2,'Fixture must reproduce ancestry-induced face distortion');
  const result=await normalizeReviewedPetRigScale(source,candidate);assert.ok(result.maxBindError<1e-6);assert.equal(result.retargetedChannels,2);
  const after=await loadPetDeformationProbe(candidate),restore=snapshotPetPose(after.scene),probe=preparePetHeadProbe(after.meshes[0]),mixer=new THREE.AnimationMixer(after.scene);
  for(const time of [0,.1,.25,.5,.75,1]){
   mixer.stopAllAction();restore();const action=mixer.clipAction(after.animations[0]).setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.reset().play();action.time=time;mixer.update(0);after.update();
   const value=probe.measure();assert.ok(value.maxDrift<1e-6);assert.ok(Math.abs(value.worldMinRatio-1)<1e-6);assert.ok(Math.abs(value.worldMaxRatio-1)<1e-6);
  }
  if(interpolation==='CUBICSPLINE'){
   const {json,bin}=parseStudioGlb(await readFile(candidate));
   const values=(await readStudioAccessor(json,bin,json.animations[0].samplers[1].output)).values;
   for(const offset of [0,6,9,15])for(const [axis,expected] of [.3,.02,.024].entries())assert.ok(Math.abs(values[offset+axis]-expected)<1e-6,'Translation derivatives must retain their transformed magnitude without positional offset');
  }
  await assert.rejects(()=>normalizeReviewedPetRigScale(candidate,source),/Use the original rig/);
 }finally{assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(basename(directory).startsWith('pet-rig-normalization-'));await rm(directory,{recursive:true,force:true});}
});
