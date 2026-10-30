import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, DoubleSide, ShapeUtils, Vector2, Vector3 } from "three";
import { WARFRONT_TERRAIN_SIGNATURE, warfrontTerrainPoint } from "../lib/pet-warfront-contract";
import { GARDEN_MASKS, gardenImageFrame } from "../lib/pet-warfront-garden";
import { RITE_WORLD_SCALE } from "../lib/pet-warfront-rite-presentation";

/** Fixed-camera environment with real depth occlusion. Solid silhouettes from
 * the finished art are registered to the authoritative collision cells. */
export function PetWarfrontTerrain3D() {
    const portrait = useThree(state => state.size.height > state.size.width);
    const lastFrame = useRef("");
    const masks = useMemo(() => Object.entries(GARDEN_MASKS[portrait ? "portrait" : "landscape"]).flatMap(([cell, polygons]) => {
        const [col,row] = cell.split(":").map(Number);
        return polygons.map((polygon,index) => {
            const geometry = new BufferGeometry();
            geometry.setAttribute("position",new Float32BufferAttribute(new Float32Array(polygon.length*3),3));
            geometry.setIndex(ShapeUtils.triangulateShape(polygon.map(([x,y])=>new Vector2(x,y)),[]).flat());
            return { key: cell+":"+index, col,row,polygon,geometry };
        });
    }),[portrait]);
    const material = useMemo(()=>new MeshBasicMaterial({colorWrite:false,depthWrite:true,side:DoubleSide}),[]);
    const point = useMemo(()=>new Vector3(),[]);
    useEffect(()=>()=>{masks.forEach(mask=>mask.geometry.dispose());},[masks]);
    useEffect(()=>()=>material.dispose(),[material]);
    useFrame(({camera,gl,size})=>{
        gl.domElement.dataset.riteTerrain = WARFRONT_TERRAIN_SIGNATURE;
        gl.domElement.dataset.riteArena = "training-garden-v1";
        const key = `${size.width}:${size.height}:${camera.projectionMatrix.elements.join(",")}`;
        if(key === lastFrame.current) return;
        lastFrame.current=key;
        const frame=gardenImageFrame(size.width,size.height);
        camera.updateMatrixWorld();
        for(const mask of masks) {
            const [x,z]=warfrontTerrainPoint(mask.col,mask.row);
            point.set(x*RITE_WORLD_SCALE,0,z*RITE_WORLD_SCALE).project(camera);
            const depth=point.z;
            const positions=mask.geometry.getAttribute("position");
            mask.polygon.forEach(([px,py],index)=>{
                point.set(2*(frame.x+px/frame.sourceWidth*frame.width)/size.width-1,
                    1-2*(frame.y+py/frame.sourceHeight*frame.height)/size.height,depth).unproject(camera);
                positions.setXYZ(index,point.x,point.y,point.z);
            });
            positions.needsUpdate=true;
            mask.geometry.computeBoundingSphere();
        }
    });
    return <group name="wfr-training-garden-depth">{masks.map(mask=><mesh key={mask.key} geometry={mask.geometry} material={material} renderOrder={-10} frustumCulled={false} />)}</group>;
}
