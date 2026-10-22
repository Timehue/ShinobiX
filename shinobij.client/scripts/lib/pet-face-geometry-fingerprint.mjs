import {createHash} from 'node:crypto';

/** Keep anatomical picks valid across weight repairs, but invalidate them when
 * the sculpt, UVs, texture, rig frames or topology that identify a face change. */
export function petFaceGeometryFingerprint(model){
    const hash=createHash('sha256');
    for(const mesh of model.meshes){
        for(const name of ['position','normal','uv']){
            const a=mesh.geometry.attributes[name];hash.update(name+'\0');
            if(a)hash.update(Buffer.from(a.array.buffer,a.array.byteOffset,a.array.byteLength));
        }
        const index=mesh.geometry.index;if(index)hash.update(Buffer.from(index.array.buffer,index.array.byteOffset,index.array.byteLength));
        hash.update(JSON.stringify(mesh.skeleton.boneInverses.map(matrix=>matrix.toArray())));
    }
    hash.update(JSON.stringify(model.json.nodes));
    const bin=model.binary;
    if(!bin)throw Error('Fingerprint requires the original texture payload');
    for(const image of model.json.images??[]){
        if(image.uri){hash.update(image.uri);continue;}
        const view=model.json.bufferViews[image.bufferView];hash.update(bin.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength));
    }
    return hash.digest('hex');
}
