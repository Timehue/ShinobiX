import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as T from 'three';
import {repairWorldstormDragonHeadMotion} from './lib/pet-worldstorm-head-motion.mjs';
import {repairAzureRyujinDeathPose} from './lib/pet-azure-death-pose.mjs';
import {loadPetDeformationProbeBytes,snapshotPetPose} from './lib/pet-deformation-probe.mjs';
import {createIndependentFaceProbe} from '../src/pet-independent-face-probe.ts';

const fixture=(id,stage)=>new URL(`./fixtures/pet-terminal-action-20261021/${id}-${stage}.glb`,import.meta.url);
const annotations=JSON.parse(await readFile(new URL('./pet-independent-face-landmarks.json',import.meta.url))).pets;
const cases=[];
for(const id of ['mythic-1','mythic-6'])for(const stage of ['source','battle']){
    const bytes=await readFile(fixture(id,stage)),repair=id==='mythic-1'?repairWorldstormDragonHeadMotion:repairAzureRyujinDeathPose;
    const result=await repair(bytes),before=await loadPetDeformationProbeBytes(bytes),after=await loadPetDeformationProbeBytes(result.bytes);
    cases.push({id,stage,bytes,result,before,after});
}
function poser(m){
    const mixer=new T.AnimationMixer(m.scene),restore=snapshotPetPose(m.scene);
    return (name,phase)=>{mixer.stopAllAction();restore();const clip=m.animations.find(c=>c.name===name),a=mixer.clipAction(clip).reset().setLoop(T.LoopOnce,1);a.clampWhenFinished=true;a.play();a.time=clip.duration*phase;mixer.update(0);m.update();};
}
function floor(m){let min=Infinity;const point=new T.Vector3();for(const mesh of m.meshes)for(let v=0;v<mesh.geometry.attributes.position.count;v++)min=Math.min(min,mesh.getVertexPosition(v,point).applyMatrix4(mesh.matrixWorld).y);return min;}

test('action repair recipes reject unreviewed input',async()=>{
    await assert.rejects(()=>repairWorldstormDragonHeadMotion(Buffer.from('wrong')),/Unexpected/);
    await assert.rejects(()=>repairAzureRyujinDeathPose(Buffer.from('wrong')),/Unexpected/);
});
for(const c of cases){
    test(`${c.id}/${c.stage}: action fix preserves exact sculpt, skin, materials, bind frames and every unrelated curve`,()=>{
        const {before,after,id}=c,a=before.meshes[0],b=after.meshes[0];
        assert.deepEqual(after.json.nodes,before.json.nodes);assert.deepEqual(b.geometry.index.array,a.geometry.index.array);
        for(const name of Object.keys(a.geometry.attributes))assert.deepEqual(b.geometry.attributes[name].array,a.geometry.attributes[name].array,name);
        a.skeleton.boneInverses.forEach((m,i)=>assert.deepEqual(b.skeleton.boneInverses[i].toArray(),m.toArray()));
        for(const name of ['materials','textures'])assert.deepEqual(after.json[name],before.json[name]);
        before.json.images.forEach((img,i)=>{const a=before.json.bufferViews[img.bufferView],b=after.json.bufferViews[after.json.images[i].bufferView];assert.deepEqual(before.binary.subarray(a.byteOffset,a.byteOffset+a.byteLength),after.binary.subarray(b.byteOffset,b.byteOffset+b.byteLength));});
        for(const clip of before.animations){const actual=after.animations.find(a=>a.name===clip.name);assert.equal(actual.duration,clip.duration);
            for(const track of clip.tracks){const changed=id==='mythic-1'?['attack','cast','idle_hitreact1'].includes(clip.name)&&['head.quaternion','neck.quaternion'].includes(track.name):clip.name==='death'&&track.name==='root.position';if(changed)continue;
                const t=actual.tracks.find(t=>t.name===track.name);assert.ok(t,track.name);assert.deepEqual(t.times,track.times);assert.deepEqual(t.values,track.values);
            }
        }
    });
    if(c.id==='mythic-1'){
        test(`Worldstorm/${c.stage}: complete face remains rigid and action head excursions stay bounded while retaining movement`,()=>{
            const {before,after}=c,pose=poser(after),priorPose=poser(before),head=after.meshes[0].skeleton.bones.find(b=>b.name==='head'),priorHead=before.meshes[0].skeleton.bones.find(b=>b.name==='head');
            const probe=createIndependentFaceProbe(after.meshes,annotations[c.id]);pose('idle',0);const neutral=head.getWorldQuaternion(new T.Quaternion());priorPose('idle',0);const priorNeutral=priorHead.getWorldQuaternion(new T.Quaternion());let peak=0,oldPeak=0;
            for(const name of ['attack','cast','idle_hitreact1'])for(let i=0;i<=120;i++){
                pose(name,i/120);priorPose(name,i/120);probe.measure(i/120);
                peak=Math.max(peak,neutral.angleTo(head.getWorldQuaternion(new T.Quaternion())));oldPeak=Math.max(oldPeak,priorNeutral.angleTo(priorHead.getWorldQuaternion(new T.Quaternion())));
            }
            assert.equal(probe.report().failed,false,JSON.stringify(probe.report()));
            assert.ok(oldPeak>T.MathUtils.degToRad(30),'Pinned negative control must reproduce excessive tilt');
            assert.ok(peak>T.MathUtils.degToRad(5)&&peak<T.MathUtils.degToRad(22),`Head motion ${T.MathUtils.radToDeg(peak)} degrees`);
        });
    }else{
        test(`Azure/${c.stage}: authored death ends fallen, holds that pose and stays above the visible floor between authoring keys`,()=>{
            const {before,after,result}=c,pose=poser(after),oldPose=poser(before),root=after.meshes[0].skeleton.bones.find(b=>b.name==='root'),head=after.meshes[0].skeleton.bones.find(b=>b.name==='head');
            oldPose('death',1);const oldRoot=before.meshes[0].skeleton.bones.find(b=>b.name==='root').getWorldQuaternion(new T.Quaternion());
            pose('death',0);const standing=head.getWorldPosition(new T.Vector3()).y;
            let min=Infinity;for(let i=0;i<=240;i++){pose('death',i/240);min=Math.min(min,floor(after));}
            assert.ok(min>=result.report.ground-.0001,`Floor penetration ${min-result.report.ground}`);
            pose('death',1);assert.ok(oldRoot.angleTo(root.getWorldQuaternion(new T.Quaternion()))>T.MathUtils.degToRad(80));
            assert.ok(standing-head.getWorldPosition(new T.Vector3()).y>.3,'Head/body must actually collapse');
            const last=head.getWorldPosition(new T.Vector3());pose('death',.95);assert.ok(last.distanceTo(head.getWorldPosition(new T.Vector3()))<.003,'Terminal pose rebounds');
        });
        test(`Azure/${c.stage}: the collapse keeps every visible vertex connected to the whole rig`,()=>{
            const {before,after}=c,pose=poser(after),oldPose=poser(before),a=before.meshes[0],b=after.meshes[0],ar=a.skeleton.bones.find(b=>b.name==='root'),br=b.skeleton.bones.find(b=>b.name==='root');
            for(const phase of [.2,.4,.6,.8,1]){oldPose('death',phase);pose('death',phase);const transform=br.matrixWorld.clone().multiply(ar.matrixWorld.clone().invert());let max=0;
                for(let v=0;v<a.geometry.attributes.position.count;v++){const expected=a.getVertexPosition(v,new T.Vector3()).applyMatrix4(a.matrixWorld).applyMatrix4(transform),actual=b.getVertexPosition(v,new T.Vector3()).applyMatrix4(b.matrixWorld);max=Math.max(max,expected.distanceTo(actual));}
                assert.ok(max<.00001,`Disconnected/deformed rig at ${phase}: ${max}`);
            }
        });
    }
}
