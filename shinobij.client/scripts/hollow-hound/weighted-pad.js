/** Exact CPU skinning of the same weighted pad vertices, with shared bone matrices. */
import {Matrix4,Vector3} from 'three';

export function createWeightedPadReader(vertices){
    const groups=new Map();
    for(const {node,vertex} of vertices){
        if(node.geometry.morphAttributes.position?.length)throw Error('Weighted pad reader requires an unmorphed source');
        let group=groups.get(node);
        if(!group){group=[];groups.set(node,group);}
        const position=node.geometry.attributes.position,joints=node.geometry.attributes.skinIndex,weights=node.geometry.attributes.skinWeight;
        group.push({point:new Vector3().fromBufferAttribute(position,vertex),
            joints:[0,1,2,3].map(i=>joints.getComponent(vertex,i)),weights:[0,1,2,3].map(i=>weights.getComponent(vertex,i))});
    }
    return ()=>{
        const samples=[],point=new Vector3(),skinned=new Vector3(),term=new Vector3();
        for(const [node,entries] of groups){
            const transforms=new Map(),post=new Matrix4().multiplyMatrices(node.matrixWorld,node.bindMatrixInverse);
            for(const entry of entries){
                point.copy(entry.point).applyMatrix4(node.bindMatrix);skinned.set(0,0,0);
                for(let i=0;i<4;i++){
                    const weight=entry.weights[i],index=entry.joints[i];if(!weight)continue;
                    let matrix=transforms.get(index);
                    if(!matrix){matrix=new Matrix4().multiplyMatrices(node.skeleton.bones[index].matrixWorld,node.skeleton.boneInverses[index]);transforms.set(index,matrix);}
                    skinned.addScaledVector(term.copy(point).applyMatrix4(matrix),weight);
                }
                samples.push(skinned.clone().applyMatrix4(post));
            }
        }
        samples.sort((a,b)=>a.y-b.y);
        const length=Math.max(1,Math.ceil(samples.length*.25)),mean=new Vector3();
        for(let i=0;i<length;i++)mean.add(samples[i]);
        return mean.multiplyScalar(1/length).toArray();
    };
}
