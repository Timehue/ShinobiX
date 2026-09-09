// Isolated QA entry loaded only by petvfx.html, never by the production app.
import { StrictMode, Suspense, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Canvas, useFrame } from "@react-three/fiber";
import { PetModel3D, DEFAULT_PET_MODEL_FRAME } from "./components/PetModel3D";
import { petCombatModel } from "./lib/pet-3d-models";
import { PET_VISUAL_QUALITY_PRESETS, type PetVisualQuality } from "./lib/pet-visual-quality";

const config = petCombatModel({ id: "starter-water", evolutionStage: 0, rarity: "standard" })!;

function Fighter({ index, quality }: { index: number; quality: PetVisualQuality }) {
    const frame = useRef({ ...DEFAULT_PET_MODEL_FRAME, motion: "run" as const, moving: true, speed: 0.4 });
    return <group position={[(index % 4 - 1.5) * 2.1, 0, index < 4 ? -1.6 : 1.6]}>
        <PetModel3D config={config} frame={frame} quality={PET_VISUAL_QUALITY_PRESETS[quality]} element="Water" showIdentity={false} />
    </group>;
}

function ResourceSample({ label }: { label: string }) {
    const frames = useRef(0);
    useFrame(({ gl }) => {
        frames.current++;
        if (frames.current < 8) return;
        const canvas = gl.domElement;
        canvas.dataset.resourceSample = label;
        canvas.dataset.resourceTextures = String(gl.info.memory.textures);
        canvas.dataset.resourceGeometries = String(gl.info.memory.geometries);
        canvas.dataset.resourceFrames = String(frames.current);
    });
    return null;
}

export function ModelLifecyclePreview() {
    const [quality, setQuality] = useState<PetVisualQuality>("medium");
    const [visible, setVisible] = useState(true);
    const [generation, setGeneration] = useState(0);
    const fighters = useMemo(() => Array.from({ length: 8 }, (_, index) => index), []);
    const label = `${generation}:${quality}:${visible}`;
    return <main style={{ background: "#101b29", color: "white", minHeight: "100vh" }}>
        <div style={{ display: "flex", gap: 8, padding: 8, flexWrap: "wrap" }}>
            <button onClick={() => setVisible(value => !value)}>{visible ? "Retire fighters" : "Mount fighters"}</button>
            <button onClick={() => setGeneration(value => value + 1)}>Replace fighters</button>
            {(["low", "medium", "high"] as const).map(value => <button key={value} onClick={() => setQuality(value)}>{value}</button>)}
            <output data-testid="model-resource-state">{label}</output>
        </div>
        {/* Resource ownership depends on the eight real rigs, not pixel count.
            Bound fill work so software GPU runners complete all six cycles. */}
        <div style={{ width: 320, maxWidth: "100%", height: 180 }}>
            <Canvas dpr={1} camera={{ position: [0, 6, 12], fov: 45 }}>
                <ambientLight intensity={2} />
                <directionalLight position={[3, 6, 4]} intensity={3} />
                <Suspense fallback={null}>
                    {visible && fighters.map(index => <Fighter key={`${generation}:${index}`} index={index} quality={quality} />)}
                    <ResourceSample key={label} label={label} />
                </Suspense>
            </Canvas>
        </div>
    </main>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><ModelLifecyclePreview /></StrictMode>);
