import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {preparePetHeadProbe} from './lib/pet-deformation-probe.mjs';

function fixture() {
    const scene=new THREE.Group(),root=new THREE.Bone(),head=new THREE.Bone();
    root.name='root';head.name='head';root.add(head);
    const geometry=new THREE.PlaneGeometry(2,2,10,10),count=geometry.attributes.position.count;
    const joints=new Uint16Array(count*4),weights=new Float32Array(count*4);
    for(let i=0;i<count;i++){joints[i*4]=1;weights[i*4]=1;}
    geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(joints,4));
    geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
    const mesh=new THREE.SkinnedMesh(geometry,new THREE.MeshBasicMaterial());
    mesh.add(root);scene.add(mesh);scene.updateMatrixWorld(true);mesh.bind(new THREE.Skeleton([root,head]));
    const update=()=>{scene.updateMatrixWorld(true);mesh.skeleton.update();};update();
    return {root,head,mesh,update,probe:preparePetHeadProbe(mesh)};
}
test('world edges expose nonuniform skull scaling hidden by bone-local measurements',()=>{
    const f=fixture();f.root.scale.set(2,.5,1);f.update();const result=f.probe.measure();
    assert.ok(result.maxDrift<1e-6);
    assert.ok(result.worldMinRatio<.6);assert.ok(result.worldMaxRatio>1.9);
});
test('uniform character sizing and rigid head rotation preserve the skull',()=>{
    const f=fixture();f.root.scale.setScalar(2);f.head.rotation.z=.6;f.update();const result=f.probe.measure();
    assert.ok(result.maxDrift<1e-6);assert.ok(Math.abs(result.worldMinRatio-1)<1e-6);assert.ok(Math.abs(result.worldMaxRatio-1)<1e-6);
});
test('a collapsed root scale is rejected rather than silently passing',()=>{
    const f=fixture();f.root.scale.x=0;f.update();assert.throws(()=>f.probe.measure(),/Invalid posed root scale/);
});
test('a reviewed neck anchor measures the skull in that bone frame',()=>{
    const f=fixture();f.head.name='neck';
    const probe=preparePetHeadProbe(f.mesh,undefined,'neck');
    assert.ok(probe?.vertices>20);f.head.rotation.y=.8;f.update();
    const result=probe.measure();assert.ok(result.maxDrift<1e-6);
    assert.ok(Math.abs(result.worldMinRatio-1)<1e-6);assert.ok(Math.abs(result.worldMaxRatio-1)<1e-6);
    assert.equal(preparePetHeadProbe(f.mesh),null);
});
