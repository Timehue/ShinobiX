import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";

import { RendererRetirement } from "../../components/RendererRetirement";
import { decorativeCanvasEvents } from "../../lib/decorative-canvas-events";
import { ContactShadows, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { DEFAULT_PET_MODEL_FRAME, PetModel3D, type PetModelFrame } from "../../components/PetModel3D";
import { petCombatModel } from "../../lib/pet-3d-models";
import { PetCardSwap3D } from "../../components/PetCardSwap3D";
import { usePetSceneIsRecalling } from '../../components/PetSceneRecall';
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

// These taller starter silhouettes reach above their normalized idle bounds
// during several authored poses. Their shared camera must reserve headroom in
// every compact presentation: confirmation, companion handoff, and Academy guide.
const COMPANION_HEADROOM_IDS = new Set([
    "starter-fire",
    "starter-lightning",
    "starter-earth",
]);

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

function CompanionCardCamera({ active, closeUp, needsHeadroom, reduced }: { active: boolean; closeUp: boolean; needsHeadroom: boolean; reduced: boolean }) {
    const lookY = useRef(active && !reduced ? 2.3 : needsHeadroom && !closeUp ? .84 : .92);
    const firstFrame = useRef(true);
    useFrame(({ camera }, delta) => {
        // Pull back for the physical paper above the companion, then return to
        // its established portrait framing once the seal has retired.
        const card = active && !reduced;
        const blend = reduced || firstFrame.current && !card ? 1 : 1 - Math.exp(-Math.min(delta, .1) * 12);
        firstFrame.current = false;
        camera.position.y = THREE.MathUtils.lerp(camera.position.y, card ? 3.2 : closeUp ? 1.62 : 1.65, blend);
        camera.position.z = THREE.MathUtils.lerp(camera.position.z, card ? 10.5 : closeUp ? 3.72 : needsHeadroom ? 4.85 : 4.35, blend);
        lookY.current = THREE.MathUtils.lerp(lookY.current, card ? 2.3 : needsHeadroom && !closeUp ? .84 : .92, blend);
        camera.lookAt(0, lookY.current, 0);
    }, -1);
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
    const recalling = usePetSceneIsRecalling();
    const [settledVisual, setSettledVisual] = useState<string | null>(null);
    const [reduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const handleReady = useCallback(() => setReady(true), []);
    const config = useMemo(() => petCombatModel(pet), [pet]);
    const renderModel = enabled && Boolean(config);
    const companionVisualId = config?.identityVisualId ?? config?.visualId ?? pet.id;
    const needsHeadroom = COMPANION_HEADROOM_IDS.has(companionVisualId);
    const summoning = renderModel && settledVisual !== `${pet.id}:${companionVisualId}`;
    const cameraOptions = useMemo(() => ({ position: [0, 3.2, 10.5] as [number, number, number], fov: closeUp ? 30 : 32, near: .1, far: 30 }), [closeUp]);

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
            data-summoning={summoning}
        >
            <img className="icx-companion-fallback" src={fallbackSrc} alt="" aria-hidden="true" />
            {renderModel ? (
                <ModelBoundary>
                    <Canvas
                        key={closeUp ? "close-up" : "full-body"}
                        className="icx-companion-canvas"
                        aria-hidden="true"
                        // Decorative and aria-hidden, and the `key` above flips mid-cinematic,
                        // so this Canvas fully remounts while the intro is still advancing.
                        // Without an events override R3F binds pointer listeners in onCreated
                        // against gl.domElement.parentNode, which is already null by then —
                        // an uncaught "Cannot read properties of null (reading
                        // 'addEventListener')" in a new player's very first session.
                        events={decorativeCanvasEvents}
                        dpr={[1, 2]}
                        camera={cameraOptions}
                        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
                        onCreated={({ gl, camera }) => {
                            gl.setClearColor(new THREE.Color("#000000"), 0);
                            gl.toneMappingExposure = 0.8;
                            camera.lookAt(0, summoning && !reduced ? 2.3 : needsHeadroom && !closeUp ? 0.84 : 0.92, 0);
                        }}
                    >
                        <RendererRetirement />
                        <CompanionCardCamera active={summoning || recalling} closeUp={closeUp} needsHeadroom={needsHeadroom} reduced={reduced} />
                        <ambientLight intensity={0.68} color="#b8d8ff" />
                        <directionalLight position={[3.8, 5.5, 4.5]} intensity={1.55} color="#fff1d6" />
                        <directionalLight position={[-4, 3.2, -2.5]} intensity={0.62} color="#73c8ff" />
                        <pointLight position={[0, 1.2, 2.2]} intensity={0.28} distance={6} color="#fef3c7" />
                        <Suspense fallback={null}>
                            <PetCardSwap3D identity={`${pet.id}:${companionVisualId}`} onComplete={() => setSettledVisual(`${pet.id}:${companionVisualId}`)}>
                                <CinematicPetModel pet={pet} hero={hero} onReady={handleReady} />
                            </PetCardSwap3D>
                            <ContactShadows key={settledVisual ?? 'preparing'} position={[0, .02, 0]} opacity={.62} scale={2.75} blur={1.65} far={3.2} frames={1} resolution={256} color="#020617" />
                        </Suspense>
                    </Canvas>
                </ModelBoundary>
            ) : null}
        </div>
    );
}
