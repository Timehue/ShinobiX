import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {rebuildPebbleTortoise} from './rebuild-pebble-tortoise.mjs';
import {repairPebbleTortoiseRootClearance} from './repair-pebble-tortoise-root-clearance.mjs';
import {loadPetDeformationProbe,snapshotPetPose,petClipSampleTimes} from './lib/pet-deformation-probe.mjs';
import {createIndependentFaceProbe} from '../src/pet-independent-face-probe.ts';
import {reviewedPebbleScalp} from './lib/pet-reviewed-scalp-component.mjs';
import {assertReviewedDistinctPebblePayload} from './lib/pet-reviewed-payload.mjs';

// Preserve the rejected attempt as a regression fixture. Passing its old
// numerical checks never grants approval to put it back in the game.
const source=new URL('./fixtures/pet-pebble-full-remake-private/rejected-public-scalp.glb',import.meta.url);
const battle=new URL('./fixtures/pet-pebble-full-remake-private/rejected-public-scalp-battle.glb',import.meta.url);
const fixture=new URL('./fixtures/pet-pebble-tortoise-distinct/starter-earth-before.glb',import.meta.url);
const meshSha='789f87dd462a45e3794f3fbe4be71f9d71dec0c2ef8faa844a5a4a59d20257bf';
const expected='c99b0471489b65a5fe2c4b9b50bf781c48f4820f7eacdb092cf983a15ca51894';
const annotation=JSON.parse(await readFile(new URL('./fixtures/pet-pebble-full-remake-private/rejected-public-face-landmarks.json',import.meta.url)));
const contactFixture=new URL('./fixtures/pet-pebble-tortoise-distinct/contact-motion-before.glb',import.meta.url);
const groundedClips=['attack','cast','idle_hitreact1'];

test('rejected scalp attempt cannot be readmitted by its old provenance',async()=>{
    const bytes=await readFile(source),model=await loadPetDeformationProbe(source),path=fileURLToPath(source);
    assert.throws(()=>assertReviewedDistinctPebblePayload(path,bytes,model.json),/rejected Pebble scalp/);
    const changed=Buffer.from(bytes);changed[changed.length-1]^=1;
    assert.throws(()=>assertReviewedDistinctPebblePayload(path,changed,model.json),/rejected Pebble scalp/);
    assert.throws(()=>assertReviewedDistinctPebblePayload(fileURLToPath(new URL('../public/pet-models/roster/standard-5.glb',import.meta.url)),bytes,model.json),/rejected Pebble scalp/);
    const shared=structuredClone(model.json);shared.extras.pebbleDistinctRebuild.sharedStoneTurtleGeometry=true;
    assert.throws(()=>assertReviewedDistinctPebblePayload(path,bytes,shared));
});

test('historical scalp identification is confined to its exact rejected fixture',async()=>{
    const model=await loadPetDeformationProbe(source),mesh=model.meshes[0],g=mesh.geometry,primitive=model.json.meshes[0].primitives[0];
    const glb={file:await readFile(source),json:model.json},start=g.attributes.position.count-1006,vertices=new Set();let triangles=0;
    for(let i=0;i<g.index.count;i+=3)if(g.index.getX(i)>=start){triangles++;for(let k=0;k<3;k++)vertices.add(g.index.getX(i+k));}
    const attrs={POSITION:g.attributes.position,TEXCOORD_0:g.attributes.uv,WEIGHTS_0:g.attributes.skinWeight,JOINTS_0:g.attributes.skinIndex};
    const streams=new Map(Object.entries(attrs).map(([key,a])=>[primitive.attributes[key],a]));
    const reader=(_glb,index)=>({value:(i,k)=>streams.get(index).getComponent(i,k)}),component={triangles,vertices};
    assert.equal(reviewedPebbleScalp(glb,primitive,'starter-earth',component,reader),true);
    assert.equal(reviewedPebbleScalp(glb,primitive,'standard-5',component,reader),false);
    const changed=Buffer.from(glb.file);changed[changed.length-1]^=1;
    assert.equal(reviewedPebbleScalp({...glb,file:changed},primitive,'starter-earth',component,reader),false);
    assert.equal(reviewedPebbleScalp(glb,primitive,'starter-earth',{...component,triangles:1786},reader),false);
    for(const [attribute,value]of[['POSITION',10],['TEXCOORD_0',0],['WEIGHTS_0',0]]){
        const malformed=(doc,index)=>index===primitive.attributes[attribute]?{value:()=>value}:reader(doc,index);
        assert.equal(reviewedPebbleScalp(glb,primitive,'starter-earth',component,malformed),false,attribute);
    }
    const json=structuredClone(glb.json);delete json.extras.pebbleDistinctRebuild;
    assert.equal(reviewedPebbleScalp({...glb,json},primitive,'starter-earth',component,reader),false);
});

function groundSweep(model){
    const mesh=model.meshes[0],p=new THREE.Vector3(),minimum=()=>{let y=Infinity;for(let v=0;v<mesh.geometry.attributes.position.count;v++)y=Math.min(y,mesh.getVertexPosition(v,p).applyMatrix4(mesh.matrixWorld).y);return y;};
    const ground=minimum(),restore=snapshotPetPose(model.scene),mixer=new THREE.AnimationMixer(model.scene),results=[];
    for(const name of groundedClips){const clip=model.animations.find(c=>c.name===name),steps=Math.ceil(clip.duration*480);let min=Infinity;for(let i=0;i<=steps;i++){mixer.stopAllAction();restore();const a=mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;a.play();a.time=Math.min(clip.duration,(i+.37)*clip.duration/steps);mixer.update(0);model.update();min=Math.min(min,minimum());}results.push({name,clearance:min-ground});}
    return results;
}

test('Pebble floor correction reproduces reviewed bytes without changing its sculpt or limb articulation',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'pebble-contact-'));
    try{const output=join(dir,'pebble.glb');const receipt=await repairPebbleTortoiseRootClearance(fileURLToPath(contactFixture),output);assert.equal(receipt.sha256,expected);
        const before=await loadPetDeformationProbe(contactFixture),after=await loadPetDeformationProbe(output);assert.deepEqual(after.json.nodes,before.json.nodes);
        for(const name of Object.keys(before.meshes[0].geometry.attributes))assert.deepEqual(after.meshes[0].geometry.attributes[name].array,before.meshes[0].geometry.attributes[name].array);
        assert.deepEqual(after.meshes[0].geometry.index.array,before.meshes[0].geometry.index.array);
        for(const clip of before.animations)for(const track of clip.tracks){const next=after.animations.find(c=>c.name===clip.name).tracks.find(t=>t.name===track.name);if(groundedClips.includes(clip.name)&&track.name==='root.position')continue;assert.deepEqual(next.times,track.times);assert.deepEqual(next.values,track.values);}
    }finally{await rm(dir,{recursive:true,force:true});}
});

test('Independent full-surface samples detect the pre-correction floor penetration',async()=>{
    const result=groundSweep(await loadPetDeformationProbe(contactFixture));assert.ok(result.every(r=>r.clearance<-.02),JSON.stringify(result));
});

for(const stage of ['source','battle'])test(`Pebble ${stage}: attack, cast and recoil clear the floor at independent offset times`,async()=>{
    const m=await loadPetDeformationProbe(stage==='source'?source:battle);
    const result=groundSweep(m);assert.ok(result.every(r=>r.clearance>=-.0005),JSON.stringify(result));assert.equal(m.json.extras.characterMotion.plantedAttack,true);assert.equal(m.json.extras.characterMotion.plantedRecoil,true);
});

test('Pebble rebuild is reproducible from its own pinned source and retains all thirteen takes',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'pebble-distinct-'));
    try{
        const output=join(dir,'pebble.glb'),receipt=await rebuildPebbleTortoise(fileURLToPath(fixture),output);
        assert.equal(receipt.sha256,meshSha);
        const before=await loadPetDeformationProbe(fixture),after=await loadPetDeformationProbe(output);
        assert.equal((await loadPetDeformationProbe(source)).sha256,expected);
        assert.equal(after.animations.length,13);
        for(let i=0;i<13;i++){
            assert.equal(after.animations[i].name,before.animations[i].name);
            assert.equal(after.animations[i].duration,before.animations[i].duration);
            assert.deepEqual(after.animations[i].tracks.map(t=>t.name),before.animations[i].tracks.map(t=>t.name));
        }
        assert.notEqual(after.sha256,(await loadPetDeformationProbe(new URL('../public/pet-models/roster/standard-5.glb',import.meta.url))).sha256);
        assert.equal(after.json.extras.properAnimationIdentity.key,'starter-earth:pebble tortoise');
        assert.ok(receipt.removedCapTriangles>2000&&receipt.scalpVertices>900);
        for(const bone of after.meshes[0].skeleton.bones){const scale=bone.getWorldScale(new THREE.Vector3());assert.ok(Math.max(...scale.toArray())-Math.min(...scale.toArray())<1e-5);}
    }finally{await rm(dir,{recursive:true,force:true});}
});

test('Scalp cleanup preserves the original eyes, muzzle and chin geometry and UVs',async()=>{
    const original=(await loadPetDeformationProbe(fixture)).meshes[0].geometry;
    const current=(await loadPetDeformationProbe(source)).meshes[0].geometry;
    const p=new THREE.Vector3(),q=new THREE.Vector3();let checked=0;
    for(let v=0;v<original.attributes.position.count;v++){
        p.fromBufferAttribute(original.attributes.position,v);
        // Independent anatomical invariant: the face in front of the headband
        // is outside the scalp edit, including the tops of both eyes.
        if(p.z<.50||p.y<-.12||p.y>.57)continue;
        const uv=original.attributes.uv;let found=false;
        for(let n=0;n<current.attributes.position.count;n++){
            q.fromBufferAttribute(current.attributes.position,n);
            if(p.distanceToSquared(q)>4e-12)continue;
            if(Math.abs(uv.getX(v)-current.attributes.uv.getX(n))>2e-6||Math.abs(uv.getY(v)-current.attributes.uv.getY(n))>2e-6)continue;
            found=true;break;
        }
        assert.ok(found,`original facial vertex ${v} was removed or moved`);checked++;
    }
    assert.ok(checked>500,`${checked} protected facial vertices`);
});

for(const stage of ['source','battle'])test(`Pebble ${stage}: ten independently marked face regions remain coherent through all clips and 468 blends`,async()=>{
    const model=await loadPetDeformationProbe(stage==='source'?source:battle);
    const probe=createIndependentFaceProbe(model.meshes,annotation),mixer=new THREE.AnimationMixer(model.scene),restore=snapshotPetPose(model.scene);let samples=0;
    for(const clip of model.animations)for(const time of petClipSampleTimes(clip,24)){
        mixer.stopAllAction();restore();const action=mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();action.time=time;mixer.update(0);model.update();probe.measure(time);samples++;
    }
    for(const from of model.animations)for(const to of model.animations)if(from!==to)for(const blend of [.25,.5,.75]){
        mixer.stopAllAction();restore();for(const[clip,weight,p]of[[from,1-blend,.75],[to,blend,.25]]){const action=mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.setEffectiveWeight(weight).play();action.time=clip.duration*p;}mixer.update(0);model.update();probe.measure(blend);
    }
    const result=probe.report();assert.equal(result.failed,false,JSON.stringify(result));assert.equal(result.regions.length,10);assert.ok(samples>400);
    for(const region of result.regions)assert.ok(region.vertices>=20,region.name);
});
