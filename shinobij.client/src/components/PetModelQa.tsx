import { useMemo, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, Environment, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { Pet } from "../types/pet";
import { petCombatModel } from "../lib/pet-3d-models";
import { petVisualQuality } from "../lib/pet-visual-quality";
import { DEFAULT_PET_MODEL_FRAME, PetModel3D, type PetModelFrame } from "./PetModel3D";
import { PetRenderStatsProbe } from "./PetRenderStatsProbe";
import { STARTER_PETS } from "../data/starter-pets";
import { rawPetPool } from "../data/pet-pool";
import { petElementByName } from "../data/pet-elements";
import { qaRosterBakedRetopoProofModel, qaRosterCombatModel, qaRosterProofModel, qaRosterRetopoProofModel, qaRosterRiggedProofModel } from "../lib/pet-3d-roster";
import type { PetCombatModelConfig } from "../lib/pet-3d-models";

type ModelAngle = "front" | "side" | "rear" | "threequarter";

const ANGLE_FACING: Record<ModelAngle, [number, number]> = {
    front: [0, 1],
    side: [1, 0],
    rear: [0, -1],
    threequarter: [0.7, 0.7],
};

function QaPet({ pet, x, angle, configOverride, frameOverride }: { pet: Pet; x: number; angle: ModelAngle; configOverride?: PetCombatModelConfig; frameOverride?: Partial<PetModelFrame> }) {
    const config = configOverride ?? petCombatModel(pet);
    const facing = ANGLE_FACING[angle];
    const frame = useRef<PetModelFrame>({
        ...DEFAULT_PET_MODEL_FRAME, ...frameOverride,
        faceX: facing[0], faceZ: facing[1], moveX: facing[0], moveZ: facing[1],
    });
    if (!config) return null;
    return (
        <group position={[x, 0, 0]}>
            <PetModel3D config={config} frame={frame} element={pet.element} />
        </group>
    );
}

export function PetModelQa() {
    const params = useMemo(() => new URLSearchParams(window.location.search), []);
    const legendary = params.get("legendary") === "1";
    const proofModelId = params.get("proofModel");
    const riggedProof = params.get("rigged") === "1";
    const retopoProof = params.get("retopo") === "1";
    const bakedRetopoProof = params.get("baked") === "1";
    const rosterModelId = proofModelId ?? params.get("rosterModel");
    const pets = useMemo(() => STARTER_PETS.map(({ pet }) => ({
        ...pet,
        evolutionStage: legendary ? 2 as const : 1 as const,
        rarity: legendary ? "legendary" as const : "rare" as const,
    })), [legendary]);
    const angleValue = params.get("angle");
    const angle: ModelAngle = angleValue === "front" || angleValue === "side" || angleValue === "rear" || angleValue === "threequarter" ? angleValue : "threequarter";
    const only = params.get("pet")?.toLowerCase();
    const quality = petVisualQuality();
    const motionValue = params.get("motion");
    const motion: PetModelFrame["motion"] = motionValue === "run" || motionValue === "dash" || motionValue === "dodge" || motionValue === "windup" || motionValue === "strike" || motionValue === "stagger" || motionValue === "dead" ? motionValue : "idle";
    const frameOverride: Partial<PetModelFrame> = {
        motion,
        moving: params.get("moving") === "1" || motion === "run" || motion === "dash",
        casting: params.get("casting") === "1",
        speed: Number(params.get("speed")) || (motion === "run" ? 3.1 : motion === "dash" ? 4.5 : 0),
    };
    const rosterPet = rosterModelId ? rawPetPool.find((pet) => pet.id === rosterModelId) : undefined;
    const qaRosterPet = rosterPet ? { ...rosterPet, element: rosterPet.element ?? petElementByName[rosterPet.name] } : undefined;
    const visiblePets = qaRosterPet ? [qaRosterPet] : only
        ? pets.filter((pet) => pet.element?.toLowerCase() === only || pet.id.toLowerCase() === only)
        : [...pets];
    const cameraZ = visiblePets.length > 2 ? 11.5 : 7.6;
    return (
        <div data-testid="pet-model-qa" style={{ position: "fixed", inset: 0, background: "radial-gradient(circle at 50% 38%,#28344a 0,#101726 52%,#070b12 100%)", color: "white" }}>
            <Canvas
                shadows={quality.modelShadows ? { type: THREE.PCFShadowMap } : false}
                dpr={quality.dpr}
                camera={{ position: [0, 2.7, cameraZ], fov: 38 }}
                gl={{ antialias: quality.id !== "low", powerPreference: "high-performance" }}
            >
                <color attach="background" args={["#101726"]} />
                <fog attach="fog" args={["#101726", 10, 18]} />
                <ambientLight intensity={0.72} color="#b8c8e8" />
                <directionalLight position={[4, 7, 6]} intensity={2.4} color="#fff3dd" castShadow={quality.modelShadows} shadow-mapSize-width={quality.id === "high" ? 1536 : 768} shadow-mapSize-height={quality.id === "high" ? 1536 : 768} />
                <directionalLight position={[-5, 3, -3]} intensity={1.1} color="#6aa9ff" />
                <pointLight position={[0, 2, -4]} intensity={1.4} distance={12} color="#ff7d4d" />
                {visiblePets.map((pet, index) => (
                    <QaPet
                        key={pet.id}
                        pet={pet}
                        x={(index - (visiblePets.length - 1) / 2) * 1.8}
                        angle={angle}
                        configOverride={qaRosterPet && pet.id === qaRosterPet.id
                            ? proofModelId
                                ? riggedProof
                                    ? qaRosterRiggedProofModel(qaRosterPet)
                                    : bakedRetopoProof
                                        ? qaRosterBakedRetopoProofModel(qaRosterPet)
                                        : retopoProof ? qaRosterRetopoProofModel(qaRosterPet) : qaRosterProofModel(qaRosterPet)
                                : qaRosterCombatModel(qaRosterPet)
                            : undefined}
                        frameOverride={frameOverride}
                    />
                ))}
                <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, -0.01, 0]}>
                    <circleGeometry args={[5.7, 64]} />
                    <meshStandardMaterial color="#273449" roughness={0.92} metalness={0.02} />
                </mesh>
                {quality.modelShadows && <ContactShadows position={[0, 0.01, 0]} opacity={0.55} scale={8} blur={2.5} far={5} resolution={quality.id === "high" ? 512 : 256} />}
                {quality.id === "high" && <Environment preset="city" environmentIntensity={0.18} />}
                <PetRenderStatsProbe quality={quality.id} />
                <OrbitControls makeDefault target={[0, 1.15, 0]} minDistance={4.2} maxDistance={11} enablePan={false} />
            </Canvas>
            <div style={{ position: "absolute", top: 18, left: 20, padding: "9px 12px", borderRadius: 10, background: "rgba(5,10,20,.72)", border: "1px solid rgba(148,163,184,.35)", font: "700 12px Inter,system-ui,sans-serif" }}>
                MODEL QA · {angle.toUpperCase()} · {quality.id.toUpperCase()}
            </div>
            <div style={{ position: "absolute", bottom: 18, left: "50%", transform: "translateX(-50%)", padding: "8px 13px", borderRadius: 999, background: "rgba(5,10,20,.72)", color: "#cbd5e1", font: "600 11px Inter,system-ui,sans-serif" }}>
                Drag to orbit · wheel to zoom · `pet=fire|water` · `angle=front|side|rear|threequarter` · `petQuality=low|medium|high`
            </div>
        </div>
    );
}
