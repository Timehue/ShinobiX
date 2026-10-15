import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {MeshoptDecoder} from 'meshoptimizer';
import {parseStudioGlb} from './pet-studio-glb.mjs';
// Semantic comparison of live geometry, independent of accessor/view numbering.
export async function petMeshContent(file,omitBindings=false){
 await MeshoptDecoder.ready;
 const {json,bin}=parseStudioGlb(file),views=new Map(),meshes=structuredClone(json.meshes);
 const accessor=id=>{
  const source=json.accessors[id];assert.ok(source&&!source.sparse,'Unsupported geometry accessor');
  const view=json.bufferViews[source.bufferView];assert.ok(view);
  if(!views.has(source.bufferView)){
   const ext=view.extensions?.EXT_meshopt_compression;
   let bytes=bin.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength);
   if(ext){bytes=Buffer.alloc(ext.count*ext.byteStride);MeshoptDecoder.decodeGltfBuffer(bytes,ext.count,ext.byteStride,bin.subarray(ext.byteOffset??0,(ext.byteOffset??0)+ext.byteLength),ext.mode,ext.filter);}
   views.set(source.bufferView,bytes);
  }
  const width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[source.type],size={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4}[source.componentType];assert.ok(width&&size);
  const bytes=views.get(source.bufferView),stride=view.byteStride??width*size,values=Buffer.alloc(source.count*width*size);
  for(let i=0;i<source.count;i++)bytes.copy(values,i*width*size,(source.byteOffset??0)+i*stride,(source.byteOffset??0)+i*stride+width*size);
  const metadata=structuredClone(source);delete metadata.bufferView;delete metadata.byteOffset;
  return {...metadata,sha256:createHash('sha256').update(values).digest('hex')};
 };
 for(const mesh of meshes)for(const primitive of mesh.primitives){
  if(omitBindings){delete primitive.attributes.JOINTS_0;delete primitive.attributes.WEIGHTS_0;}
  for(const name of Object.keys(primitive.attributes))primitive.attributes[name]=accessor(primitive.attributes[name]);
  if(primitive.indices!==undefined)primitive.indices=accessor(primitive.indices);
 }
 return meshes;
}
