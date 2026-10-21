import assert from 'node:assert/strict';
import {AnimationMixer,LoopOnce,Vector3} from 'three';
import {loadPetDeformationProbe,snapshotPetPose} from './pet-deformation-probe.mjs';
import {stablePetModelPresentationBounds} from '../../src/lib/pet-model-bounds.ts';

/** Independently inspected sole patches in the reviewed Snow Rabbit sculpt.
 * Select the visible geometry, without consulting repaired skin weights or
 * treating an imported ankle pivot as the bottom of a paw. */
export async function snowRabbitVisibleSupportProbe(path){
    const model=await loadPetDeformationProbe(path);
    assert.equal(model.sha256,'9b6aa18cddbeeede40e785e339be1c4c30b0b8c3ab84cca211d95947a93f7fce','Visible sole annotation needs fresh review for a changed Rabbit');
    assert.equal(model.meshes.length,1);
    const mesh=model.meshes[0],floor=stablePetModelPresentationBounds(model.scene).groundY,point=new Vector3(),soles={left:[],right:[]};
    for(let v=0;v<mesh.geometry.attributes.position.count;v++){
        mesh.getVertexPosition(v,point).applyMatrix4(mesh.matrixWorld);
        if(point.y>floor+.025||point.z<-.04||point.z>.14)continue;
        if(point.x>.035)soles.left.push(v);
        if(point.x<-.025)soles.right.push(v);
    }
    assert.equal(soles.left.length,458);assert.equal(soles.right.length,433);
    const restore=snapshotPetPose(model.scene),mixer=new AnimationMixer(model.scene);
    const pose=(name,phase)=>{mixer.stopAllAction();restore();const clip=model.animations.find(clip=>clip.name===name);assert.ok(clip);const action=mixer.clipAction(clip).reset().setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play();action.time=clip.duration*phase;mixer.update(0);model.update();};
    const support=(name,phase)=>{pose(name,phase);const clearances=Object.fromEntries(Object.entries(soles).map(([side,vertices])=>{let minimum=Infinity;for(const v of vertices)minimum=Math.min(minimum,mesh.getVertexPosition(v,point).applyMatrix4(mesh.matrixWorld).y);return[side,minimum-floor];}));return{clearance:Math.min(...Object.values(clearances)),clearances};};
    support.seam=name=>{pose(name,0);const start=Array.from({length:mesh.geometry.attributes.position.count},(_,v)=>mesh.getVertexPosition(v,new Vector3()).applyMatrix4(mesh.matrixWorld));pose(name,1);let maximum=0;for(let v=0;v<start.length;v++)maximum=Math.max(maximum,start[v].distanceTo(mesh.getVertexPosition(v,point).applyMatrix4(mesh.matrixWorld)));return maximum;};
    return support;
}
