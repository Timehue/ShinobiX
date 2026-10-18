import * as THREE from 'three';
const smooth = (low, high, value) => { const t = Math.max(0,Math.min(1,(value-low)/(high-low))); return t*t*(3-2*t); };
export function petSkullRegionShare(point, config) {
    let share=smooth(config.y[0],config.y[1],point.y);
    if(config.z)share*=smooth(config.z[0],config.z[1],point.z);
    if(config.x)share*=1-smooth(config.x[0],config.x[1],Math.abs(point.x));
    // Signed bounds isolate an accessory on one side without binding the
    // opposite wing or other nearby anatomy to the head.
    if(config.xMin)share*=smooth(config.xMin[0],config.xMin[1],point.x);
    for(const region of config.union??[])share=Math.max(share,petSkullRegionShare(point,region));
    for(const box of config.exclude ?? [])if(point.x>=box[0]&&point.x<=box[1]&&point.y>=box[2]&&point.y<=box[3]&&point.z>=box[4]&&point.z<=box[5])return 0;
    return share;
}
/** One fixed geometry-to-visible-bind matrix. Masks never follow posed weights. */
export function petSkullEnvelopeMatrix(model, yaw=0) {
    model.scene.rotation.y+=yaw; model.update();
    const points=[];
    for(const mesh of model.meshes)for(let v=0;v<mesh.geometry.attributes.position.count;v++)points.push(mesh.getVertexPosition(v,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
    const box=new THREE.Box3().setFromPoints(points),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3()),scale=2/Math.max(size.x,size.y,size.z);
    const normalize=new THREE.Matrix4().makeScale(scale,scale,scale).multiply(new THREE.Matrix4().makeTranslation(-center.x,-center.y,-center.z));
    const mesh=model.meshes[0], head=mesh.skeleton.bones.findIndex(b=>b.name==='head');
    if(head<0)throw Error('Reviewed skull region requires a head bone');
    return normalize.multiply(mesh.matrixWorld).multiply(mesh.bindMatrixInverse)
        .multiply(mesh.skeleton.bones[head].matrixWorld).multiply(mesh.skeleton.boneInverses[head]).multiply(mesh.bindMatrix);
}
