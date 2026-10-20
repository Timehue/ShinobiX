import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Quaternion,PropertyBinding} from 'three';
import {loadPetDeformationProbe} from './lib/pet-deformation-probe.mjs';
import {readStudioAccessor} from './lib/pet-studio-glb.mjs';
import {retargetFittedPetPerformances,OMITTED_FITTED_PERFORMANCE_CLIPS} from './lib/pet-retarget-fitted-performances.mjs';
import {freezeVisibleSoleRegions,selectVisibleSoleRegions,measureVisibleLimbPerformances} from './lib/pet-visible-limb-performance.mjs';

const fixture=p=>new URL('./fixtures/'+p,import.meta.url);
const cases=[
  {
    "id": "mythic-3",
    "original": "pet-complete-face-20261015/mythic-3-v1.glb",
    "pins": {
      "source": "ae390c352980c1456700ad240628e3f46435b4e52c687afe04c73e011093b427",
      "battle": "4a90c0f4f5c00c9d1e7324e1ff4bd6a705bec894c2fed8ccc208b5bf96ac6a66"
    },
    "sourceGolden": "4fd4b4f5a38f1fd02c7a63c6091768a6396bfa973c4feb9ce8f838cb4632d498"
  },
  {
    "id": "mythic-12",
    "original": "pet-complete-face-20261015/mythic-12-v1.glb",
    "pins": {
      "source": "9d39b74c479917baca5fefc7a6244794c5d597b2e2f515fe98323a8455ba3428",
      "battle": "5242e784a12882cd8b4fbe0c68fc4ba1e9dfc7685138fac45919af8fd72e8dda"
    },
    "sourceGolden": "731ba7e1c37b6c24ad0f57ba430fd82b418105925cd255b044d7a8524563abf0"
  },
  {
    "id": "mythic-13",
    "original": "pet-complete-face-20261015/mythic-13-v1.glb",
    "pins": {
      "source": "62eabaf7202d7d74084f0fdb2ea21f73b13a798e58c019b4cec4c340ef0dc77b",
      "battle": "eec849fc0914bda6481a6079f9ff7b944a4254b83fc2a5446456df95fb721b17"
    },
    "sourceGolden": "156d4f2a07834897a42f15a72bffb4a323db781801eef6b9fe2dae2b149e09b8"
  },
  {
    "id": "mythic-14",
    "original": "pet-complete-face-20261015/mythic-14-v1.glb",
    "pins": {
      "source": "edcfc08d7230f99df9c32667e8ed20dc9d64fbf6c1d8dfc1811be9113b3406a1",
      "battle": "2d76b2fd250feaa6c061b994b548aed4a5b9aeeaa7a213a04d34f1acff0c4f15"
    },
    "sourceGolden": "0e90a9aa485040fb7fcf0d7307c8165fd8976283fe10f163c89d7446d1ff2470"
  },
  {
    "id": "mythic-15",
    "original": "pet-complete-face-20261015/mythic-15-v1.glb",
    "pins": {
      "source": "fe10ef667ac577512b50d6d54ea8c92ee035fe11ca267273859e0a3922018e7a",
      "battle": "96efdf8f5ddbb7f8c07a8447b68d99615d38454f523688456966c62d0dea99dd"
    },
    "sourceGolden": "a7dc5a71c0f5b25290a349cf0ad1ac4090d2daf5feb6a42a417742741d7d5075"
  }
];
const privateCandidateRoot=process.env.PET_OMITTED_CANDIDATE_ROOT;


for(const row of cases)for(const stage of ['source','battle'])test(`${row.id} ${stage}: original angular performances and independent own-leg paw motion survive the omitted-clip repair`,async()=>{
 const temp=await mkdtemp(join(tmpdir(),'pet-own-limb-rotation-'));
 try{
  const path=fixture(`pet-omitted-limb-performances/${row.id}-before-${stage}.glb`),bytes=await readFile(path),candidate=await retargetFittedPetPerformances(bytes,{expectedSha256:row.pins[stage]}),out=join(temp,'candidate.glb');await writeFile(out,candidate.bytes);
  if(stage==='source')assert.equal(candidate.report.sha256,row.sourceGolden);
  const before=await loadPetDeformationProbe(path),after=await loadPetDeformationProbe(out),original=await loadPetDeformationProbe(fixture(row.original)),annotation=JSON.parse(await readFile(fixture(`pet-omitted-limb-performances/${row.id}-visible-paws.json`))),regions=freezeVisibleSoleRegions(original,annotation),selection=selectVisibleSoleRegions(after,regions,{original,stage});
  assert.deepEqual(after.json.nodes,before.json.nodes);
  const shipping=await loadPetDeformationProbe(new URL(privateCandidateRoot ? `../${privateCandidateRoot}/${stage==='battle'?'direct-battle/':''}roster/${row.id}.glb` : `../public/pet-models/${stage==='battle'?'warfront-lod/':''}roster/${row.id}.glb`, import.meta.url)),shippingSelection=selectVisibleSoleRegions(shipping,regions,{original,stage});
  if(stage==='source')assert.equal(shipping.sha256,row.sourceGolden);
  // Final LODs are regenerated from the pinned source, not from the old LOD.
  // Require exact source curve retention through generation. Retargeting the
  // old Solar LOD independently differs by <=1.39e-16 in near-zero components
  // because its exported bind frames have already been rounded once.
  const deliveryReference=stage==='battle'&&!privateCandidateRoot?await loadPetDeformationProbe(new URL(`../public/pet-models/roster/${row.id}.glb`,import.meta.url)):after;
  if(stage==='battle'&&!privateCandidateRoot)assert.equal(deliveryReference.sha256,row.sourceGolden);
  for(const clip of deliveryReference.animations){const actual=shipping.animations.find(c=>c.name===clip.name);assert.equal(actual.tracks.length,clip.tracks.length);for(const t of clip.tracks){const u=actual.tracks.find(u=>u.name===t.name);assert.ok(u);assert.deepEqual(u.times,t.times);assert.deepEqual(u.values,t.values);assert.equal(u.getInterpolation(),t.getInterpolation());}}
  for(const name of Object.keys(before.meshes[0].geometry.attributes))assert.deepEqual(after.meshes[0].geometry.attributes[name].array,before.meshes[0].geometry.attributes[name].array);
  before.meshes[0].skeleton.boneInverses.forEach((m,i)=>assert.deepEqual(after.meshes[0].skeleton.boneInverses[i].toArray(),m.toArray()));
  for(const clip of before.animations){const other=after.animations.find(c=>c.name===clip.name);assert.equal(other.duration,clip.duration);for(const track of clip.tracks){const actual=other.tracks.find(t=>t.name===track.name);assert.ok(actual);assert.deepEqual(actual.times,track.times);assert.deepEqual(actual.values,track.values);assert.equal(actual.getInterpolation(),track.getInterpolation());}if(!OMITTED_FITTED_PERFORMANCE_CLIPS.includes(clip.name))assert.equal(other.tracks.length,clip.tracks.length);}
  const bone=node=>before.meshes[0].skeleton.bones.find(b=>b.name===PropertyBinding.sanitizeNodeName(before.json.nodes[node].name));
  let comparedKeys=0,maxWorldAngularError=0;
  for(const clipReport of candidate.report.clips){const a=before.json.animations.find(c=>c.name===clipReport.name),b=after.json.animations.find(c=>c.name===clipReport.name);
   for(const pair of clipReport.retargetedChannels){
    const old=a.channels.find(c=>c.target.node===pair.originalNode),fresh=b.channels.find(c=>c.target.node===pair.fittedNode);assert.ok(old&&fresh);assert.equal(fresh.target.path,'rotation');
    const sa=a.samplers[old.sampler],sb=b.samplers[fresh.sampler];assert.equal(sb.input,sa.input);assert.equal(sb.interpolation,sa.interpolation);
    const av=await readStudioAccessor(before.json,before.binary,sa.output),bv=await readStudioAccessor(after.json,after.binary,sb.output);assert.equal(av.values.length,bv.values.length);
    const oldBone=bone(pair.originalNode),newBone=bone(pair.fittedNode);assert.ok(oldBone&&newBone);
    const pa=oldBone.parent.getWorldQuaternion(new Quaternion()),pb=newBone.parent.getWorldQuaternion(new Quaternion()),oldBind=oldBone.quaternion.clone(),newBind=newBone.quaternion.clone();
    const stride=sa.interpolation==='CUBICSPLINE'?12:4,start=sa.interpolation==='CUBICSPLINE'?4:0;
    for(let i=start;i<av.values.length;i+=stride){
     // Independent world-space delta check uses the original bones and bind
     // transforms, not the repair's reported left/right quaternion constants.
     const qa=pa.clone().multiply(new Quaternion().fromArray(av.values,i)).multiply(oldBind.clone().invert()).multiply(pa.clone().invert()).normalize();
     const qb=pb.clone().multiply(new Quaternion().fromArray(bv.values,i)).multiply(newBind.clone().invert()).multiply(pb.clone().invert()).normalize();
     const error=qa.angleTo(qb);maxWorldAngularError=Math.max(maxWorldAngularError,error);assert.ok(error<.000002,`${clipReport.name}/${pair.name}: authored angular delta changed`);comparedKeys++;
    }
   }
  }
  assert.ok(comparedKeys>100);
  const base=stage==='source'?original:await loadPetDeformationProbe(fixture(`pet-omitted-limb-performances/${row.id}-original-lod.glb`));
  for(const [paw,prefix,side]of [['frontL','front','L'],['frontR','front','R'],['hindL','hind','L'],['hindR','hind','R']]){
   const fittedNames=after.meshes[0].skeleton.bones.filter(b=>new RegExp(`^${prefix}_(upper|lower|paw)${side}$`).test(b.name)).map(b=>b.name);
   const originals=base.meshes[0].skeleton.bones.filter(b=>new RegExp(prefix==='front'?`^(front_(upper|lower|paw)|upper_arm|forearm|hand)${side}$`:`^(hind_(upper|lower|paw)|thigh|shin|foot)${side}$`).test(b.name)).map(b=>b.name);
   assert.equal(fittedNames.length,3);assert.equal(originals.length,3);
   const oldMotion=measureVisibleLimbPerformances(before,selection,{limbNames:fittedNames}),newMotion=measureVisibleLimbPerformances(after,selection,{limbNames:fittedNames}),shippingMotion=measureVisibleLimbPerformances(shipping,shippingSelection,{limbNames:fittedNames}),reference=measureVisibleLimbPerformances(base,selectVisibleSoleRegions(base,regions,{original,stage}),{legacy:true,limbNames:originals});
   for(const name of OMITTED_FITTED_PERFORMANCE_CLIPS){const a=oldMotion.find(c=>c.clip===name),b=newMotion.find(c=>c.clip===name),r=reference.find(c=>c.clip===name);assert.equal(a.frozenLimbChannels,0);assert.equal(a.patches[paw].maxLimbContribution,0);
    if(r.patches[paw].maxLimbContribution>.005)assert.ok(b.patches[paw].maxLimbContribution>.005,`${name}/${paw}: original own-leg performance lost`);
    if(b.frozenLimbChannels===0)assert.equal(b.patches[paw].maxLimbContribution,0);
    // Bound any unchanged smooth-skin cross-leg influences below .3% skin
    // share and .001 model units, below the .005 meaningful authored paw-
    // motion gate. Check actual original sole regions, not a repair mask.
    for(const other of Object.keys(regions))if(other!==paw){
     assert.ok(b.patches[other].maxLimbContribution<.001,`${name}/${paw} deforms ${other}`);
     for(const v of selection[other].indices){let foreign=0;const mesh=after.meshes[0];for(let k=0;k<4;k++)if(fittedNames.includes(mesh.skeleton.bones[mesh.geometry.attributes.skinIndex.getComponent(v,k)].name))foreign+=mesh.geometry.attributes.skinWeight.getComponent(v,k);assert.ok(foreign<.003,`${paw} has excessive skin share on ${other}`);}
    }
   }
   for(const b of shippingMotion.filter(c=>OMITTED_FITTED_PERFORMANCE_CLIPS.includes(c.clip))){const r=reference.find(c=>c.clip===b.clip);if(r.patches[paw].maxLimbContribution>.005)assert.ok(b.patches[paw].maxLimbContribution>.005,`${b.clip}/${paw}: delivered candidate paw performance lost`);if(b.frozenLimbChannels===0)assert.equal(b.patches[paw].maxLimbContribution,0);for(const other of Object.keys(regions))if(other!==paw)assert.ok(b.patches[other].maxLimbContribution<.001,`${b.clip}/${paw}: actual shipping cross-paw deformation`);}
  }
  console.log(JSON.stringify({id:row.id,stage,shippingSha256:shipping.sha256,comparedKeys,maxWorldAngularError,ownLegCounterfactuals:4,actualDeliveredOwnLegCounterfactuals:4,deliveryScope:privateCandidateRoot?'private-diagnostic-candidate':'shipping-public-assets',originalAndFittedJointDeltaEqual:true,scalarRatios:'Retained in diagnostic evidence; exact original angular deltas and visible anatomical arcs govern this rig repair.'}));
 }finally{await rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
