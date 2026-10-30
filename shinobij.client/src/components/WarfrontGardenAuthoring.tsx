import { useEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useLoader } from "@react-three/fiber";
import { MeshStandardMaterial, TextureLoader, RepeatWrapping, SRGBColorSpace, type Mesh, type Group } from "three";
import { WARFRONT_TERRAIN, WARFRONT_TERRAIN_SIGNATURE, warfrontTerrainPoint } from "../lib/pet-warfront-contract";
import { RITE_WORLD_SCALE } from "../lib/pet-warfront-rite-presentation";
import mistUrl from "../assets/fx/mist/018.png";

export function WarfrontTerrainProp({ kind }: { kind: "pillar" | "cover" | "garden" }) {
    const { scene } = useGLTF("/scripts/warfront-terrain/source/training-garden-layout.glb");
    const texture = useLoader(TextureLoader, "/assets/warfront/kage-tactics-slate-v1.webp");
    const model = useMemo(() => {
        const map = texture.clone(); map.colorSpace = SRGBColorSpace; map.wrapS = map.wrapT = RepeatWrapping; map.needsUpdate = true;
        const meshes = (scene.getObjectByName(kind) as Group).children.map(node => {
            const mesh = node as Mesh;
            const material = (mesh.material as MeshStandardMaterial).clone();
            if (material.name === "stone" || material.name === "trim") { material.map = map; material.color.setScalar(2.4); }
            return { geometry: mesh.geometry, material, name: mesh.name };
        });
        return { meshes, map };
    }, [scene, texture, kind]);
    useEffect(() => () => { model.map.dispose(); model.meshes.forEach(mesh => mesh.material.dispose()); }, [model]);
    return <group name={`wfr-${kind}`}>{model.meshes.map(mesh => <mesh key={mesh.name} geometry={mesh.geometry} material={mesh.material} castShadow receiveShadow />)}</group>;
}

export function PetWarfrontTerrain3D({ floorOnly = false }: { floorOnly?: boolean }) {
    const mistSource = useLoader(TextureLoader, mistUrl);
    const mist = useMemo(() => mistSource.clone(), [mistSource]);
    useEffect(() => () => mist.dispose(), [mist]);
    useFrame(state => { state.gl.domElement.dataset.riteTerrain = WARFRONT_TERRAIN_SIGNATURE; });
    return <group name="wfr-training-garden" scale={RITE_WORLD_SCALE}>
        <WarfrontTerrainProp kind="garden" />
        {!floorOnly && WARFRONT_TERRAIN.map(({ kind, col, row }) => {
            const [x, z] = warfrontTerrainPoint(col, row);
            return <group key={`${col}:${row}`} position={[x, 0, z]}>
                {kind === "mist" ? <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .045, 0]}>
                    <planeGeometry args={[2.6, 2.4]} />
                    <meshBasicMaterial map={mist} color="#91aaa6" transparent opacity={.22} depthWrite={false} />
                </mesh> : <WarfrontTerrainProp kind={kind} />}
            </group>;
        })}
    </group>;
}
