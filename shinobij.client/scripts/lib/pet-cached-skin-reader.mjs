import * as THREE from 'three';
// Offline audit sampler. Refresh with sync() after every pose update.
// Float64 matrices and operation order match Three.js applyBoneTransform;
// this avoids recalculating static attributes and identical bone transforms
// for every vertex. Morphing meshes retain the reference attribute path.
export function createCachedPetVertexReader(meshes){
 const rows=new Map(meshes.map(mesh=>[mesh,{matrices:mesh.skeleton.bones.map(()=>new THREE.Matrix4()),base:new THREE.Vector4(),work:new THREE.Vector4(),indices:new THREE.Vector4(),weights:new THREE.Vector4()}]));
 function prepare(mesh,row){
  row.bindMatrix=mesh.bindMatrix.clone();row.staticVertices=!mesh.geometry.morphAttributes.position?.length;
  if(!row.staticVertices)return;
  const count=mesh.geometry.attributes.position.count;row.bases=new Float64Array(count*4);row.vertexIndices=new Uint32Array(count*4);row.vertexWeights=new Float64Array(count*4);
  const point=new THREE.Vector3();for(let v=0;v<count;v++){
   THREE.Mesh.prototype.getVertexPosition.call(mesh,v,point);row.base.set(...point,1).applyMatrix4(mesh.bindMatrix);
   row.indices.fromBufferAttribute(mesh.geometry.attributes.skinIndex,v);row.weights.fromBufferAttribute(mesh.geometry.attributes.skinWeight,v);
   row.base.toArray(row.bases,v*4);row.indices.toArray(row.vertexIndices,v*4);row.weights.toArray(row.vertexWeights,v*4);
  }
 }
 for(const[mesh,row]of rows)prepare(mesh,row);
 return {
  sync(){for(const[mesh,row]of rows){if(!row.bindMatrix.equals(mesh.bindMatrix))prepare(mesh,row);for(let i=0;i<row.matrices.length;i++)row.matrices[i].multiplyMatrices(mesh.skeleton.bones[i].matrixWorld,mesh.skeleton.boneInverses[i]);}},
  getVertexPosition(mesh,index,target){
   const row=rows.get(mesh);if(!row)throw Error('Unregistered audit mesh');
   if(row.staticVertices&&!target.isVector4){
    const offset=index*4,bx=row.bases[offset],by=row.bases[offset+1],bz=row.bases[offset+2],bw=row.bases[offset+3];let x=0,y=0,z=0;
    for(let slot=0;slot<4;slot++){const weight=row.vertexWeights[offset+slot];if(weight!==0){const e=row.matrices[row.vertexIndices[offset+slot]].elements;
     x+=(e[0]*bx+e[4]*by+e[8]*bz+e[12]*bw)*weight;
     y+=(e[1]*bx+e[5]*by+e[9]*bz+e[13]*bw)*weight;
     z+=(e[2]*bx+e[6]*by+e[10]*bz+e[14]*bw)*weight;
    }}
    return target.set(x,y,z).applyMatrix4(mesh.bindMatrixInverse);
   }
   THREE.Mesh.prototype.getVertexPosition.call(mesh,index,target);
   row.indices.fromBufferAttribute(mesh.geometry.attributes.skinIndex,index);
   row.weights.fromBufferAttribute(mesh.geometry.attributes.skinWeight,index);
   if(target.isVector4){row.base.copy(target);target.set(0,0,0,0);}else{row.base.set(...target,1);target.set(0,0,0);}
   row.base.applyMatrix4(mesh.bindMatrix);
   for(let slot=0;slot<4;slot++){const weight=row.weights.getComponent(slot);if(weight!==0)target.addScaledVector(row.work.copy(row.base).applyMatrix4(row.matrices[row.indices.getComponent(slot)]),weight);}
   if(target.isVector4)target.w=row.base.w;
   return target.applyMatrix4(mesh.bindMatrixInverse);
  }
 };
}
