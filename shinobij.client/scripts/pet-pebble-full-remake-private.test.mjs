// Private-draft regressions. These do not mark Pebble reviewed or releasable.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import {loadPetDeformationProbe,snapshotPetPose,preparePetHeadProbe} from './lib/pet-deformation-probe.mjs';
const dir=new URL('./fixtures/pet-pebble-full-remake-private/',import.meta.url);
const contract=JSON.parse(await readFile(new URL('contract.json',dir)));
const load=name=>loadPetDeformationProbe(fileURLToPath(new URL(name,dir)));
const model=await load('new-anatomy-before-ground.glb');
const phases=[0,.125,.25,.375,.5,.625,.75,.875,1];
function posing(m){const restore=snapshotPetPose(m.scene),mixer=new T.AnimationMixer(m.scene);return {single(clip,phase){mixer.stopAllAction();restore();const a=mixer.clipAction(clip).reset().setLoop(T.LoopOnce,1);a.clampWhenFinished=true;a.play();a.time=clip.duration*phase;mixer.update(0);m.update();},blend(from,to,b){mixer.stopAllAction();restore();for(const[c,w,p]of[[from,1-b,.75],[to,b,.25]]){const a=mixer.clipAction(c).reset().setLoop(T.LoopOnce,1);a.clampWhenFinished=true;a.setEffectiveWeight(w).play();a.time=c.duration*p;}mixer.update(0);m.update();},reset(){mixer.stopAllAction();restore();m.update();}};}
const point=(mesh,i)=>mesh.getVertexPosition(i,new T.Vector3()).applyMatrix4(mesh.matrixWorld);

test('reduced-mesh underarm stretch is reproduced by the failed LOD and prevented across every clip and blend',async()=>{
 const bad=await load('rejected-underarm-lod.glb'),good=await load('new-anatomy-battle-v9.glb');
 assert.equal(bad.sha256,contract.rejectedUnderarmLodSha256);assert.equal(good.sha256,contract.battleV9Sha256);
 const bp=posing(bad),bm=bad.meshes[0],edge=[2341,2342],baseline=point(bm,edge[0]).distanceTo(point(bm,edge[1]));
 bp.single(bad.animations.find(c=>c.name==='attack'),.4);
 const stretched=point(bm,edge[0]).distanceTo(point(bm,edge[1]));assert.ok(stretched/baseline>8&&stretched>.11,'failed LOD must retain the actual underarm defect');bp.reset();
 const mesh=good.meshes[0],g=mesh.geometry,points=Array.from({length:g.attributes.position.count},(_,i)=>point(mesh,i)),diagonal=new T.Box3().setFromPoints(points).getSize(new T.Vector3()).length(),edges=new Map();
 // Inspect all indexed surfaces, independently of the preservation boxes.
 for(let i=0;i<g.index.count;i+=3)for(const [a,b]of [[0,1],[1,2],[2,0]]){const x=g.index.getX(i+a),y=g.index.getX(i+b),length=points[x].distanceTo(points[y]);if(length>diagonal*.000001)edges.set([x,y].sort((a,b)=>a-b).join(','),{x,y,length});}
 const p=posing(good);let checked=0;
 const measure=()=>{const posed=points.map((_,i)=>point(mesh,i));for(const e of edges.values()){const length=posed[e.x].distanceTo(posed[e.y]);assert.ok(!(length/e.length>8&&length>diagonal*.04),`visible edge stretch ${e.x},${e.y}`);}checked++;};
 for(const clip of good.animations)for(const phase of [...phases,.4]){p.single(clip,phase);measure();}
 for(const from of good.animations)for(const to of good.animations)if(from!==to)for(const blend of [.25,.5,.75]){p.blend(from,to,blend);measure();}
 p.reset();assert.equal(checked,598);
});

test('both meshes retain thirteen complete facial patches including the underside and rear of the jaw',async()=>{
 for(const m of [model,await load('new-anatomy-battle-v9.glb')]){
  const regions=Object.entries(contract.completeFaceLandmarks).map(([name,{center,radius}])=>({name,probe:preparePetHeadProbe(m.meshes[0],p=>new T.Vector3(p.x,p.y,p.z).distanceTo(new T.Vector3(...center))<=radius)}));
  assert.equal(regions.length,13);for(const r of regions)assert.ok(r.probe?.measure&&r.probe.vertices>=20,r.name);
  const p=posing(m),measure=()=>{for(const r of regions)assert.ok(r.probe.measure().maxDrift<.00002,r.name+' detached from the head');};
  for(const clip of m.animations)for(const phase of phases){p.single(clip,phase);measure();}
  for(const from of m.animations)for(const to of m.animations)if(from!==to)for(const blend of [.25,.5,.75]){p.blend(from,to,blend);measure();}p.reset();
 }
});

test('unreleased fixtures retain exact bytes and all thirteen raw clips',async()=>{
 assert.equal(model.sha256,contract.sourceSha256);
 assert.equal((await load('rejected-spiked-joints.glb')).sha256,contract.rejectedSpikesSha256);
 assert.equal((await load('rejected-loose-chin.glb')).sha256,contract.rejectedChinSha256);
 assert.equal(model.animations.length,13);assert.equal(contract.visualApproval,false);
 assert.equal(model.json.extras.pebbleFullRemake.privateCandidateOnly,true);
 assert.equal(model.json.extras.pebbleFullRemake.acceptance,'unreviewed');
});

test('head, neck, torso and limbs are one closed skin surface',()=>{
 const g=model.meshes[0].geometry,skin=new Set(contract.skinVertexIndices),canonical=new Map(),vertices=new Map(),adj=new Map(),edges=new Map();
 for(const i of skin){const p=[0,1,2].map(k=>g.attributes.position.getComponent(i,k)),key=p.map(v=>Math.round(v*1e5)).join(',');if(!vertices.has(key))vertices.set(key,p);canonical.set(i,key);}
 for(let i=0;i<g.index.count;i+=3){const ids=[0,1,2].map(k=>g.index.getX(i+k));if(ids.some(v=>!skin.has(v)))continue;for(let k=0;k<3;k++){const a=canonical.get(ids[k]),b=canonical.get(ids[(k+1)%3]),key=[a,b].sort().join('|');edges.set(key,(edges.get(key)??0)+1);if(!adj.has(a))adj.set(a,new Set());adj.get(a).add(b);if(!adj.has(b))adj.set(b,new Set());adj.get(b).add(a);}}
 assert.equal(vertices.size,6372);assert.ok([...edges.values()].every(count=>count===2),'open or non-manifold skin');
 const visited=new Set(),queue=[vertices.keys().next().value];while(queue.length){const v=queue.pop();if(visited.has(v))continue;visited.add(v);for(const n of adj.get(v)??[])if(!visited.has(n))queue.push(n);}
 assert.equal(visited.size,vertices.size,'detached scalp or limb');
 const ys=[...vertices.values()].map(p=>p[1]);assert.ok(Math.min(...ys)<-.99&&Math.max(...ys)>.8,'skin must span skull through toes');
});

test('visually observed thigh spike is reproduced by the rejected binding and prevented in every take and blend',async()=>{
 const bad=await load('rejected-spiked-joints.glb'),bp=posing(bad),good=posing(model),bm=bad.meshes[0],gm=model.meshes[0],witness=contract.jointWitnesses[0];
 const length=(mesh,w)=>point(mesh,w.vertices[0]).distanceTo(point(mesh,w.vertices[1]));
 const baseline=length(bm,witness);bp.single(bad.animations.find(c=>c.name===witness.clip),witness.phase);assert.ok(length(bm,witness)/baseline>6,'failed draft must still reproduce the observed spike');bp.reset();
 const witnesses=contract.jointWitnesses.map(w=>({...w,bindLength:length(gm,w)}));let max=1,worst=null;
 const measure=pose=>{for(const w of witnesses){const ratio=length(gm,w)/w.bindLength;if(ratio>max){max=ratio;worst={pose,vertices:w.vertices,bindMidpoint:w.bindMidpoint};}}};
 for(const clip of model.animations)for(const phase of phases){good.single(clip,phase);measure({clip:clip.name,phase});}
 let blends=0;for(const a of model.animations)for(const b of model.animations)if(a!==b)for(const blend of [.25,.5,.75]){good.blend(a,b,blend);measure({from:a.name,to:b.name,blend});blends++;}
 good.reset();assert.equal(blends,468);assert.ok(max<1.05,`outer thigh stretch ${max}: ${JSON.stringify(worst)}`);
});

test('complete facial patches include the lower chin; failed chin binding remains detectable',async()=>{
 const {center,radius,anatomicalMinZ}=contract.chin;
 const chin=p=>p.z>=anatomicalMinZ&&new T.Vector3(p.x,p.y,p.z).distanceTo(new T.Vector3(...center))<=radius;
 const bad=await load('rejected-loose-chin.glb'),bp=posing(bad),probe=preparePetHeadProbe(bad.meshes[0],chin);
 assert.ok(probe.vertices>=20);bp.single(bad.animations.find(c=>c.name==='idle_2'),.375);assert.ok(probe.measure().maxDrift>.05,'old jaw attachment must fail');bp.reset();
 const regions=[...Object.entries(contract.headRegions).map(([name,[c,r]])=>({name,probe:preparePetHeadProbe(model.meshes[0],p=>new T.Vector3(p.x,p.y,p.z).distanceTo(new T.Vector3(...c))<=r)})),{name:'chin',probe:preparePetHeadProbe(model.meshes[0],chin)}];
 for(const r of regions)assert.ok(r.probe?.measure&&r.probe.vertices>=20,r.name);
 const p=posing(model);let maximum=0;
 const measure=()=>{for(const r of regions){const v=r.probe.measure();maximum=Math.max(maximum,v.maxDrift);assert.ok(v.worldMinRatio>=.985&&v.worldMaxRatio<=1.015,r.name+' changed shape');}};
 for(const clip of model.animations)for(const phase of phases){p.single(clip,phase);measure();}
 for(const a of model.animations)for(const b of model.animations)if(a!==b)for(const bWeight of [.25,.5,.75]){p.blend(a,b,bWeight);measure();}
 p.reset();assert.ok(maximum<.00002,`facial drift ${maximum}`);
});

test('new skin has a real UV unwrap rather than a uniform colour sample',()=>{
 const uv=model.meshes[0].geometry.attributes.uv,values=new Set();for(const i of contract.skinVertexIndices)values.add(uv.getX(i).toFixed(6)+','+uv.getY(i).toFixed(6));
 assert.ok(values.size>6000);assert.equal(model.json.images[0].mimeType,'image/webp');
 assert.equal(model.json.extras.pebbleFullRemake.geometryEntirelyNew,true);
 assert.equal(model.json.extras.pebbleFullRemake.uvAtlasEntirelyNew,true);
});
