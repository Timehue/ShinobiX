import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Environment } from "@react-three/drei";
import * as THREE from "three";
import type { Pet } from "../types/pet";
import { petCombatModel } from "../lib/pet-3d-models";
import { petVisualQuality } from "../lib/pet-visual-quality";
import { DEFAULT_PET_MODEL_FRAME, PetModel3D, type PetModelFrame } from "./PetModel3D";
import { PetRenderStatsProbe } from "./PetRenderStatsProbe";
import { PetOrbitControls } from "./PetOrbitControls";
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

const MOTION_SHEET_ENTRIES: ReadonlyArray<{
    id: string;
    frame: Partial<PetModelFrame>;
}> = [
    { id: "IDLE", frame: { motion: "idle", moving: false, speed: 0, victorious: false } },
    { id: "RUN", frame: { motion: "run", moving: true, speed: 4.2, victorious: false } },
    { id: "ATTACK", frame: { motion: "strike", moving: false, speed: 0, victorious: false } },
    { id: "DODGE", frame: { motion: "dodge", moving: false, speed: 0, victorious: false } },
    { id: "HIT", frame: { motion: "stagger", moving: false, speed: 0, victorious: false } },
    { id: "VICTORY", frame: { motion: "idle", moving: false, speed: 0, victorious: true } },
    { id: "DEATH", frame: { motion: "dead", moving: false, speed: 0, victorious: false } },
];

type QaRenderEntry = {
    pet: Pet;
    angle: ModelAngle;
    label: string;
    frameOverride: Partial<PetModelFrame>;
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

function qaModelUrlOverride(config: PetCombatModelConfig | null | undefined, url: string | undefined): PetCombatModelConfig | undefined {
    return url && config ? { ...config, url } : undefined;
}

function QaReadySignal({ signature }: { signature: string }) {
    const frames = useRef(0);
    useFrame(() => {
        frames.current += 1;
        if (frames.current === 2) document.documentElement.dataset.petModelReady = signature;
    });
    useEffect(() => {
        return () => {
            delete document.documentElement.dataset.petModelReady;
        };
    }, [signature]);
    return null;
}

export function PetModelQa() {
    const params = useMemo(() => new URLSearchParams(window.location.search), []);
    const baseForms = params.get("base") === "1";
    const legendary = params.get("legendary") === "1";
    const proofModelId = params.get("proofModel");
    const riggedProof = params.get("rigged") === "1";
    const retopoProof = params.get("retopo") === "1";
    const bakedRetopoProof = params.get("baked") === "1";
    const rosterModelId = proofModelId ?? params.get("rosterModel");
    const pets = useMemo(() => STARTER_PETS.map(({ pet }) => ({
        ...pet,
        evolutionStage: baseForms ? 0 as const : legendary ? 2 as const : 1 as const,
        rarity: baseForms ? "standard" as const : legendary ? "legendary" as const : "rare" as const,
    })), [baseForms, legendary]);
    const angleValue = params.get("angle");
    const angle: ModelAngle = angleValue === "front" || angleValue === "side" || angleValue === "rear" || angleValue === "threequarter" ? angleValue : "threequarter";
    const allAngles = params.get("allAngles") === "1";
    const motionSheet = params.get("motionSheet") === "1";
    const requestedModelUrl = params.get("modelUrl");
    const qaModelUrl = requestedModelUrl?.startsWith("/pet-models/") ? requestedModelUrl : undefined;
    const only = params.get("pet")?.toLowerCase();
    const quality = petVisualQuality();
    const motionValue = params.get("motion");
    const motion: PetModelFrame["motion"] = motionValue === "run" || motionValue === "dash" || motionValue === "dodge" || motionValue === "windup" || motionValue === "strike" || motionValue === "stagger" || motionValue === "dead" ? motionValue : "idle";
    const victorious = params.get("victorious") === "1";
    const frameOverride: Partial<PetModelFrame> = {
        motion,
        moving: params.get("moving") === "1" || motion === "run" || motion === "dash",
        casting: params.get("casting") === "1",
        speed: Number(params.get("speed")) || (motion === "run" ? 3.1 : motion === "dash" ? 4.5 : 0),
        victorious,
    };
    const rosterPet = rosterModelId ? rawPetPool.find((pet) => pet.id === rosterModelId) : undefined;
    const qaRosterPet = rosterPet ? { ...rosterPet, element: rosterPet.element ?? petElementByName[rosterPet.name] } : undefined;
    const baseQaRosterConfig = qaRosterPet
        ? proofModelId
            ? riggedProof
                ? qaRosterRiggedProofModel(qaRosterPet)
                : bakedRetopoProof
                    ? qaRosterBakedRetopoProofModel(qaRosterPet)
                    : retopoProof ? qaRosterRetopoProofModel(qaRosterPet) : qaRosterProofModel(qaRosterPet)
            : qaRosterCombatModel(qaRosterPet)
        : undefined;
    const qaRosterConfig = qaModelUrlOverride(baseQaRosterConfig, qaModelUrl) ?? baseQaRosterConfig;
    const visiblePets = qaRosterPet ? [qaRosterPet] : only
        ? pets.filter((pet) => pet.element?.toLowerCase() === only || pet.id.toLowerCase() === only)
        : [...pets];
    const displayedAngles: ModelAngle[] = allAngles ? ["front", "threequarter", "side", "rear"] : [angle];
    const renderEntries: QaRenderEntry[] = visiblePets.flatMap<QaRenderEntry>((pet) => motionSheet
        ? MOTION_SHEET_ENTRIES.map((entry) => ({
            pet,
            angle: "threequarter" as const,
            label: entry.id,
            frameOverride: { ...frameOverride, ...entry.frame },
        }))
        : displayedAngles.map((displayAngle) => ({
            pet,
            angle: displayAngle,
            label: displayAngle,
            frameOverride,
        })));
    const cameraZ = motionSheet ? 16 : allAngles ? 14.5 : renderEntries.length > 2 ? 11.5 : 7.6;
    const readySignature = `${qaRosterPet?.id ?? only ?? "starters"}:${baseForms ? "base" : legendary ? "legendary" : "rare"}:${motionSheet ? "motion-sheet" : allAngles ? "all" : angle}:${victorious ? "victory" : motion}:${quality.id}`;
    const modelLabel = qaRosterPet ? `${qaRosterPet.id} · ${qaRosterPet.name}` : only ? `${only} starter` : baseForms ? "base starter roster" : "starter roster";
    return (
        <div data-testid="pet-model-qa" style={{ position: "fixed", inset: 0, background: "radial-gradient(circle at 50% 38%,#28344a 0,#101726 52%,#070b12 100%)", color: "white" }}>
            <Canvas
                shadows={quality.modelShadows ? { type: THREE.PCFShadowMap } : false}
                dpr={quality.dpr}
                camera={{ position: [0, 2.7, cameraZ], fov: 38 }}
                gl={{ antialias: quality.id !== "low", powerPreference: "high-performance" }}
            >
                <color attach="background" args={["#101726"]} />
                <fog attach="fog" args={["#101726", Math.max(10, cameraZ + 2), cameraZ + 12]} />
                <ambientLight intensity={0.72} color="#b8c8e8" />
                <directionalLight position={[4, 7, 6]} intensity={2.4} color="#fff3dd" castShadow={quality.modelShadows} shadow-mapSize-width={quality.id === "high" ? 1536 : 768} shadow-mapSize-height={quality.id === "high" ? 1536 : 768} />
                <directionalLight position={[-5, 3, -3]} intensity={1.1} color="#6aa9ff" />
                <pointLight position={[0, 2, -4]} intensity={1.4} distance={12} color="#ff7d4d" />
                <Suspense fallback={null}>
                    {renderEntries.map(({ pet, angle: displayAngle, label, frameOverride: entryFrame }, index) => (
                        <QaPet
                            key={`${pet.id}-${label}`}
                            pet={pet}
                            x={(index - (renderEntries.length - 1) / 2) * (motionSheet ? 1.55 : allAngles ? 2.25 : 1.8)}
                            angle={displayAngle}
                            configOverride={qaRosterPet && pet.id === qaRosterPet.id
                                ? qaRosterConfig
                                : qaModelUrlOverride(petCombatModel(pet), qaModelUrl)}
                            frameOverride={entryFrame}
                        />
                    ))}
                    <QaReadySignal signature={readySignature} />
                </Suspense>
                <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, -0.01, 0]}>
                    <circleGeometry args={[7, 64]} />
                    <meshStandardMaterial color="#273449" roughness={0.92} metalness={0.02} />
                </mesh>
                {quality.modelShadows && <ContactShadows position={[0, 0.01, 0]} opacity={0.55} scale={10} blur={2.5} far={5} resolution={quality.id === "high" ? 512 : 256} />}
                {quality.id === "high" && <Environment preset="city" environmentIntensity={0.18} />}
                <PetRenderStatsProbe quality={quality.id} />
                <PetOrbitControls target={[0, 1.15, 0]} minDistance={4.2} maxDistance={cameraZ + 2} />
            </Canvas>
            <div style={{ position: "absolute", top: 18, left: 20, padding: "9px 12px", borderRadius: 10, background: "rgba(5,10,20,.72)", border: "1px solid rgba(148,163,184,.35)", font: "700 12px Inter,system-ui,sans-serif" }}>
                MODEL QA · {modelLabel.toUpperCase()} · {motionSheet ? "7-MOTION DEFORMATION" : allAngles ? "4-ANGLE CERTIFICATION" : angle.toUpperCase()} · {quality.id.toUpperCase()}
            </div>
            <div style={{ position: "absolute", bottom: 18, left: "50%", transform: "translateX(-50%)", padding: "8px 13px", borderRadius: 999, background: "rgba(5,10,20,.72)", color: "#cbd5e1", font: "600 11px Inter,system-ui,sans-serif" }}>
                {motionSheet ? MOTION_SHEET_ENTRIES.map((entry) => entry.id).join(" · ") : allAngles ? "FRONT · THREE-QUARTER · SIDE · REAR" : "Drag to orbit · wheel to zoom · `pet=fire|water` · `angle=front|side|rear|threequarter` · `petQuality=low|medium|high`"}
            </div>
        </div>
    );
}
