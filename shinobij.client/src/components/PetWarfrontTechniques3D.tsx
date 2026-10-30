import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, Mesh, MeshBasicMaterial } from "three";
import type { DuelResult } from "../lib/pet-duel-sim";
import type { PetVisualQualityConfig } from "../lib/pet-visual-quality";
import { RITE_WORLD_SCALE } from "../lib/pet-warfront-rite-presentation";
import { buildWarfrontTechniqueTimeline, warfrontTechniqueProgress, type WarfrontTechnique } from "../lib/pet-warfront-techniques";
import { VolumetricSetPiece } from "./PetShowdownVfx3d";
import type { SetPieceSpawn } from "./PetShowdownVfx";
import { warfrontEnergyMaterial } from "../lib/warfront-energy-material";
import { warfrontElementSignature } from "../lib/pet-warfront-spectacle";

/** Reuse Colosseum's actual curling waves, flame crowns, spiral vortices,
 * rising rock meshes and lightning columns. The replay clock owns every
 * frame: pause, speed changes and rematches cannot leave wall-clock effects. */
function TechniqueActor({ actorId, element, seed, timeline, clockRef, quality, reducedMotion }: {
    actorId: string; element: string; seed: number;
    timeline: readonly (readonly WarfrontTechnique[])[];
    clockRef: MutableRefObject<number>; quality: PetVisualQualityConfig; reducedMotion: boolean;
}) {
    const group = useRef<Group>(null);
    const ground = useRef<Mesh>(null);
    const groundMaterial = useMemo(() => warfrontEnergyMaterial(5), []);
    useEffect(() => () => groundMaterial.dispose(), [groundMaterial]);
    const spawn = useMemo<SetPieceSpawn>(() => ({ key: seed, element, from: [0, 0, element === "Water" ? -1.1 : 0], to: [0, 0, 0],
        startedAt: 0, durationMs: 900,
        progress: () => {
            const action = timeline[Math.floor(clockRef.current)]?.find(a => a.actorId === actorId);
            return action ? reducedMotion ? 0.6 : warfrontTechniqueProgress(action, clockRef.current) : -1;
        },
    }), [seed, element, timeline, clockRef, actorId, reducedMotion]);
    useFrame(() => {
        if (!group.current) return;
        const action = timeline[Math.floor(clockRef.current)]?.find(a => a.actorId === actorId);
        group.current.visible = Boolean(action);
        if (!action) return;
        group.current.position.set(action.x * RITE_WORLD_SCALE, 0, action.z * RITE_WORLD_SCALE);
        group.current.rotation.y = action.heading;
        group.current.scale.setScalar(action.signature ? 0.9 : 0.65);
        if (ground.current) {
            const progress = warfrontTechniqueProgress(action, clockRef.current);
            const material = ground.current.material as MeshBasicMaterial;
            material.color.set(warfrontElementSignature(element).primary);
            // Brief reflected light gives way to a restrained, ground-bound
            // residue. No persistent decals accumulate across the three clashes.
            material.color.multiplyScalar(0.35 + Math.exp(-progress * 9) * 0.65);
            material.opacity = reducedMotion ? 0.12 : (1 - progress) * 0.34;
            ground.current.scale.setScalar(1 + progress * 0.65);
        }
    });
    return <group ref={group} visible={false}>
        <mesh ref={ground} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} material={groundMaterial}>
            <planeGeometry args={[4, 4]} />
        </mesh>
        <VolumetricSetPiece spawn={spawn} quality={quality} warfront />
    </group>;
}

export function PetWarfrontTechniques3D({ result, clockRef, quality, reducedMotion }: {
    result: DuelResult; clockRef: MutableRefObject<number>; quality: PetVisualQualityConfig; reducedMotion: boolean;
}) {
    const timeline = useMemo(() => buildWarfrontTechniqueTimeline(result), [result]);
    const actors = useMemo(() => [...new Map(timeline.flat().map(a => [a.actorId, a.element]))], [timeline]);
    useFrame(state => {
        const canvas = state.gl.domElement;
        if (!canvas.hasAttribute("data-rite-elemental-actions-active")) return;
        const active = timeline[Math.floor(clockRef.current)] ?? [];
        canvas.dataset.riteGrandTechniques = active.map(a => a.element).join(",");
    });
    return <>{actors.map(([actorId, element], i) => <TechniqueActor key={actorId} actorId={actorId} element={element}
        seed={i * 31 + 17} timeline={timeline} clockRef={clockRef} quality={quality} reducedMotion={reducedMotion} />)}</>;
}
