import assert from'node:assert/strict';
import{AnimationMixer,LoopOnce,Vector3}from'three';
import{loadPetDeformationProbe,snapshotPetPose}from'./pet-deformation-probe.mjs';
import{stablePetModelPresentationBounds}from'../../src/lib/pet-model-bounds.ts';

// Anatomical soles picked from the new sculpt, independent of skin weights.
export async function pebbleVisibleSupportProbe(path){
 const model=await loadPetDeformationProbe(path),mesh=model.meshes[0],p=mesh.geometry.attributes.position,feet=[];
 for(let v=0;v<p.count;v++)if(p.getY(v)<-.87&&Math.abs(p.getX(v))>.12&&Math.abs(p.getX(v))<.55&&p.getZ(v)>-.15)feet.push(v);
 assert.ok(feet.length>=300,'New sculpt sole coverage missing');
 const floor=stablePetModelPresentationBounds(model.scene).groundY,restore=snapshotPetPose(model.scene),mixer=new AnimationMixer(model.scene),point=new Vector3();
 const pose=(name,phase)=>{mixer.stopAllAction();restore();const clip=model.animations.find(c=>c.name===name),action=mixer.clipAction(clip).reset().setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play();action.time=clip.duration*phase;mixer.update(0);model.update();};
 const support=(name,phase)=>{pose(name,phase);let low=Infinity;
  for(const v of feet)low=Math.min(low,mesh.getVertexPosition(v,point).applyMatrix4(mesh.matrixWorld).y);
  return{vertices:feet.length,clearance:low-floor};
 };
 support.seam=name=>{pose(name,0);const start=Array.from({length:p.count},(_,v)=>mesh.getVertexPosition(v,new Vector3()).applyMatrix4(mesh.matrixWorld));pose(name,1);let maximum=0;for(let v=0;v<p.count;v++)maximum=Math.max(maximum,start[v].distanceTo(mesh.getVertexPosition(v,point).applyMatrix4(mesh.matrixWorld)));return maximum;};
 return support;
}
