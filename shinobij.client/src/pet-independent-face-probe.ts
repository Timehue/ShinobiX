// QA only: inspect visibly identified anatomical surfaces in the real renderer.
import * as THREE from 'three';

export type IndependentFaceAnnotation = {
    geometryToVisibleBind: number[];
    headCountVisuallyVerified:number;
    heads:{id:string;landmarks:string[]}[];
    landmarks: Record<string,{center:number[];radius:number;anchorBone?:string}>;
};

export function createIndependentFaceProbe(meshes:THREE.SkinnedMesh[],annotation:IndependentFaceAnnotation){
    if(annotation.geometryToVisibleBind.length!==16)throw Error('Missing frozen anatomical frame');
    if(!annotation.heads?.length||annotation.heads.length!==annotation.headCountVisuallyVerified)throw Error('Independently inspected head coverage missing');
    for(const head of annotation.heads)if(head.landmarks.length<3||new Set(head.landmarks).size!==head.landmarks.length||head.landmarks.some(name=>!annotation.landmarks[name]))throw Error(`${head.id}: upper face, muzzle/beak and lower-face landmark coverage missing`);
    const envelope=new THREE.Matrix4().fromArray(annotation.geometryToVisibleBind);
    const regions=Object.entries(annotation.landmarks).flatMap(([name,landmark])=>meshes.map(mesh=>{
        const anchor=mesh.skeleton.bones.find(b=>b.name===(landmark.anchorBone??'head'));
        if(!anchor)throw Error(`${name}: anatomical anchor missing`);
        const anchorIndex=mesh.skeleton.bones.indexOf(anchor),center=new THREE.Vector3().fromArray(landmark.center);
        const p=mesh.geometry.attributes.position,vertices:number[]=[],expected=new Map<number,THREE.Vector3>(),world=new Map<number,THREE.Vector3>();
        for(let v=0;v<p.count;v++)if(new THREE.Vector3().fromBufferAttribute(p,v).applyMatrix4(envelope).distanceTo(center)<=landmark.radius){
            vertices.push(v);
            expected.set(v,new THREE.Vector3().fromBufferAttribute(p,v).applyMatrix4(mesh.bindMatrix).applyMatrix4(mesh.skeleton.boneInverses[anchorIndex]));
            world.set(v,mesh.getVertexPosition(v,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
        }
        if(vertices.length<20)throw Error(`${name}: incomplete independent anatomical coverage (${vertices.length} vertices)`);
        const selected=new Set(vertices),diagonal=new THREE.Box3().setFromPoints([...expected.values()]).getSize(new THREE.Vector3()).length();
        const worldDiagonal=new THREE.Box3().setFromPoints([...world.values()]).getSize(new THREE.Vector3()).length();
        if(!(diagonal>1e-8&&worldDiagonal>1e-8))throw Error(`${name}: degenerate anatomical surface`);
        const index=mesh.geometry.index,edges=new Map<string,{a:number;b:number;length:number}>();
        for(let i=0;i<(index?.count??p.count);i+=3)for(const[a,b]of[[0,1],[1,2],[2,0]]){
            const from=index?index.getX(i+a):i+a,to=index?index.getX(i+b):i+b;
            if(!selected.has(from)||!selected.has(to))continue;
            const length=world.get(from)!.distanceTo(world.get(to)!);
            if(length>worldDiagonal*.002)edges.set(`${Math.min(from,to)},${Math.max(from,to)}`,{a:from,b:to,length});
        }
        if(edges.size<3)throw Error(`${name}: anatomical edge coverage missing`);
        const root=mesh.skeleton.bones.find(b=>b.name==='root')??mesh.skeleton.bones[0],bindRootScale=Math.cbrt(Math.abs(root.matrixWorld.determinant()));
        if(!(bindRootScale>1e-8))throw Error('Invalid anatomical root scale');
        return {name,mesh,anchor,root,bindRootScale,vertices,expected,world,edges,diagonal,maxDrift:0,worldMinRatio:1,worldMaxRatio:1,maximumTime:0};
    }));
    if(!regions.length)throw Error('No independent anatomical landmarks');
    let poses=0;
    return {
        measure(time:number){
            poses++;
            for(const r of regions){
                const inverse=r.anchor.matrixWorld.clone().invert(),shown=new THREE.Vector3();
                const scale=Math.cbrt(Math.abs(r.root.matrixWorld.determinant()))/r.bindRootScale;
                if(!(scale>1e-8))throw Error('Invalid posed anatomical root scale');
                for(const v of r.vertices){
                    const world=r.world.get(v)!;r.mesh.getVertexPosition(v,world).applyMatrix4(r.mesh.matrixWorld);
                    const drift=shown.copy(world).applyMatrix4(inverse).distanceTo(r.expected.get(v)!)/r.diagonal;
                    if(!Number.isFinite(drift))throw Error('Non-finite anatomical deformation');
                    if(drift>r.maxDrift){r.maxDrift=drift;r.maximumTime=time;}
                }
                for(const edge of r.edges.values()){
                    const ratio=r.world.get(edge.a)!.distanceTo(r.world.get(edge.b)!)/edge.length/scale;
                    if(!Number.isFinite(ratio))throw Error('Non-finite anatomical edge');
                    r.worldMinRatio=Math.min(r.worldMinRatio,ratio);r.worldMaxRatio=Math.max(r.worldMaxRatio,ratio);
                }
            }
        },
        report(){
            const values=regions.map(r=>({name:r.name,vertices:r.vertices.length,edges:r.edges.size,maxDrift:r.maxDrift,worldMinRatio:r.worldMinRatio,worldMaxRatio:r.worldMaxRatio,maximumTime:r.maximumTime}));
            return {poses,regions:values,failed:values.some(v=>v.maxDrift>.00002||v.worldMinRatio<.985||v.worldMaxRatio>1.015)};
        },
    };
}
