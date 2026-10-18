import assert from 'node:assert/strict';
import * as THREE from 'three';
import {loadPetDeformationProbe} from './pet-deformation-probe.mjs';
import {packContinuousPetSkinWeights} from '../../src/lib/pet-skin-weight-repair.ts';

/** Project a separately reviewed binding onto the original detailed surface.
 * This changes only joint palettes. The pinned reference makes the repair
 * reproducible after its derived battle asset is regenerated. */
export async function transferReviewedPetBinding(model,config) {
    assert.equal(config.method,'closest-triangle-barycentric-all-vertices');
    assert.match(config.path,/^scripts\/fixtures\/pet-complete-face-20261015\/[a-z0-9-]+\.glb$/);
    assert.match(config.sha256,/^[a-f0-9]{64}$/);
    const reference=await loadPetDeformationProbe(config.path);
    assert.equal(reference.sha256,config.sha256,'Reviewed binding reference changed');
    assert.deepEqual(reference.json.nodes,model.json.nodes,'Reference must use the same rig and geometry coordinate space');
    assert.equal(model.meshes.length,1);assert.equal(reference.meshes.length,1);
    const mesh=model.meshes[0],other=reference.meshes[0],geometry=mesh.geometry,surface=other.geometry;
    const jointMap=other.skeleton.bones.map(b=>mesh.skeleton.bones.findIndex(n=>n.name===b.name));
    assert.ok(jointMap.every(j=>j>=0));
    for(let i=0;i<jointMap.length;i++)assert.deepEqual(other.skeleton.boneInverses[i].elements,mesh.skeleton.boneInverses[jointMap[i]].elements);
    const count=geometry.attributes.position.count,joints=new Uint8Array(count*4),weights=new Uint8Array(count*4);
    const triangle=new THREE.Triangle(),point=new THREE.Vector3(),nearest=new THREE.Vector3(),bestPoint=new THREE.Vector3(),barycentric=new THREE.Vector3();
    let maximumProjectionDistance=0;
    for(let vertex=0;vertex<count;vertex++){
        point.fromBufferAttribute(geometry.attributes.position,vertex);
        let distance=Infinity,best=[];
        for(let i=0;i<surface.index.count;i+=3){
            const vertices=[surface.index.getX(i),surface.index.getX(i+1),surface.index.getX(i+2)];
            triangle.setFromAttributeAndIndices(surface.attributes.position,...vertices).closestPointToPoint(point,nearest);
            const squared=point.distanceToSquared(nearest);
            if(squared<distance){distance=squared;best=vertices;bestPoint.copy(nearest);}
        }
        maximumProjectionDistance=Math.max(maximumProjectionDistance,Math.sqrt(distance));
        triangle.setFromAttributeAndIndices(surface.attributes.position,...best).getBarycoord(bestPoint,barycentric);
        assert.ok(Number.isFinite(barycentric.x+barycentric.y+barycentric.z));
        const palette=new Float64Array(mesh.skeleton.bones.length);
        for(let i=0;i<3;i++)for(let slot=0;slot<4;slot++)palette[jointMap[surface.attributes.skinIndex.getComponent(best[i],slot)]]+=surface.attributes.skinWeight.getComponent(best[i],slot)*barycentric.getComponent(i);
        const packed=packContinuousPetSkinWeights(palette);
        for(let slot=0;slot<4;slot++){joints[vertex*4+slot]=packed.joints[slot]??0;weights[vertex*4+slot]=Math.round((packed.weights[slot]??0)*255);}
        weights[vertex*4]+=255-weights.subarray(vertex*4,vertex*4+4).reduce((sum,w)=>sum+w,0);
    }
    geometry.computeBoundingBox();const diagonal=geometry.boundingBox.getSize(new THREE.Vector3()).length();
    assert.ok(maximumProjectionDistance/diagonal<.05,'Reference is too far from the detailed source surface');
    return {joints,weights,vertices:count,maximumProjectionDistance};
}
