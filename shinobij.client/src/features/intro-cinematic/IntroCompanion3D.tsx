import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { DEFAULT_PET_MODEL_FRAME, PetModel3D, type PetModelFrame } from "../../components/PetModel3D";
import { petCombatModel } from "../../lib/pet-3d-models";
import type { Pet } from "../../types/pet";
import "./intro-companion-3d.css";

type IntroCompanion3DProps = {
    pet: Pet;
    fallbackSrc: string;
    label: string;
    className?: string;
    hero?: boolean;
    closeUp?: boolean;
    enabled?: boolean;
};

type ModelBoundaryProps = {
    children: ReactNode;
};

type ModelBoundaryState = {
    failed: boolean;
};

class ModelBoundary extends Component<ModelBoundaryProps, ModelBoundaryState> {
    state: ModelBoundaryState = { failed: false };

    static getDerivedStateFromError(): ModelBoundaryState {
        return { failed: true };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.warn("[intro-cinematic] Companion model fallback", error, info.componentStack);
    }

    render() {
        return this.state.failed ? null : this.props.children;
    }
}

function ReadySignal({ onReady }: { onReady: () => void }) {
    useEffect(onReady, [onReady]);
    return null;
}

function CinematicPetModel({ pet, hero, onReady }: { pet: Pet; hero: boolean; onReady: () => void }) {
    const config = useMemo(() => petCombatModel(pet), [pet]);
    const isAvian = config?.profile === "avian";
    const frame = useRef<PetModelFrame>({
        ...DEFAULT_PET_MODEL_FRAME,
        faceX: 0.25,
        faceZ: 1,
        moveX: 0.25,
        moveZ: 1,
        victorious: hero,
    });

    useEffect(() => {
        frame.current.victorious = hero;
    }, [hero]);

    if (!config) return null;

    return (
        <>
            <group position={[0, isAvian ? -0.05 : 0.03, 0]}>
                <PetModel3D config={config} frame={frame} element={pet.element} showIdentity={false} />
            </group>
            <ContactShadows
                position={[0, 0.02, 0]}
                opacity={0.62}
                scale={2.75}
                blur={1.65}
                far={3.2}
                frames={1}
                resolution={256}
                color="#020617"
            />
            <ReadySignal onReady={onReady} />
        </>
    );
}

// Kept beside the renderer so model lookup and preload behavior cannot drift.
// eslint-disable-next-line react-refresh/only-export-components
export function preloadIntroCompanion3D(pet: Pet): void {
    const config = petCombatModel(pet);
    if (config) useGLTF.preload(config.url);
}

export function IntroCompanion3D({
    pet,
    fallbackSrc,
    label,
    className = "",
    hero = false,
    closeUp = false,
    enabled = true,
}: IntroCompanion3DProps) {
    const [ready, setReady] = useState(false);
    const handleReady = useCallback(() => setReady(true), []);
    const config = useMemo(() => petCombatModel(pet), [pet]);
    const renderModel = enabled && Boolean(config);

    return (
        <div
            className={`icx-companion-render ${ready ? "is-model-ready" : ""} ${className}`}
            role="img"
            aria-label={label}
            data-pet-id={pet.id}
            data-pet-rarity={pet.rarity}
            data-pet-stage={pet.evolutionStage ?? "unset"}
            data-model-enabled={enabled ? "true" : "false"}
            data-model-visual={config?.visualId ?? "none"}
        >
            <img className="icx-companion-fallback" src={fallbackSrc} alt="" aria-hidden="true" />
            {renderModel ? (
                <ModelBoundary>
                    <Canvas
                        className="icx-companion-canvas"
                        aria-hidden="true"
                        dpr={[1, 2]}
                        camera={{
                            position: closeUp ? [0, 1.62, 3.72] : [0, 1.65, 4.35],
                            fov: closeUp ? 30 : 32,
                            near: 0.1,
                            far: 30,
                        }}
                        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
                        onCreated={({ gl, camera }) => {
                            gl.setClearColor(new THREE.Color("#000000"), 0);
                            gl.toneMappingExposure = 0.8;
                            camera.lookAt(0, 0.92, 0);
                        }}
                    >
                        <ambientLight intensity={0.68} color="#b8d8ff" />
                        <directionalLight position={[3.8, 5.5, 4.5]} intensity={1.55} color="#fff1d6" />
                        <directionalLight position={[-4, 3.2, -2.5]} intensity={0.62} color="#73c8ff" />
                        <pointLight position={[0, 1.2, 2.2]} intensity={0.28} distance={6} color="#fef3c7" />
                        <Suspense fallback={null}>
                            <CinematicPetModel pet={pet} hero={hero} onReady={handleReady} />
                        </Suspense>
                    </Canvas>
                </ModelBoundary>
            ) : null}
        </div>
    );
}
