import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { TacticsMove } from '../../../shared/pet-tactics-contract';
import type { Pet } from '../types/pet';
import { petCloseupPresentationModel } from '../lib/pet-3d-models';
import { warfrontPetModelConfig } from '../lib/pet-warfront-model-lod';
import { PET_VISUAL_QUALITY_PRESETS } from '../lib/pet-visual-quality';
import { petHeroMoveStyle } from '../lib/pet-hero-moves';
import { petModelVariantSurface } from '../lib/pet-visual-variant';
import { CHROMATIC_PET_SURFACE } from '../lib/pet-model-surface';
import { petCareReaction, type PetAppearancePreview, type PetCareCue } from '../lib/pet-yard-interactions';
import { PetCollarAura } from './PetCollarAura';
import { PetModel3D, DEFAULT_PET_MODEL_FRAME, type PetModelMotion } from './PetModel3D';
import { RendererRetirement } from './RendererRetirement';

/** This isolated inspection canvas renders at most 24 animation frames/sec.
 * It stops scheduling frames when paused, offscreen, or in a hidden tab. */
function PreviewClock({ paused }: { paused: boolean }) {
    const { invalidate, gl, setFrameloop } = useThree();
    useEffect(() => {
        let timer: number | undefined;
        let inView = true;
        const sync = () => {
            if (timer !== undefined) window.clearInterval(timer);
            timer = undefined;
            setFrameloop(inView && !document.hidden ? 'demand' : 'never');
            if (inView && !document.hidden) invalidate();
            if (!paused && inView && !document.hidden) timer = window.setInterval(invalidate, 1000 / 24);
        };
        const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
            inView = entries[0]?.isIntersecting ?? false;
            sync();
        });
        observer?.observe(gl.domElement);
        document.addEventListener('visibilitychange', sync);
        sync();
        return () => {
            if (timer !== undefined) window.clearInterval(timer);
            observer?.disconnect();
            document.removeEventListener('visibilitychange', sync);
        };
    }, [paused, invalidate, gl, setFrameloop]);
    return null;
}

function Fighter({ pet, paused, turn, take, move, onReady, careCue, baselineCareSerial, collarId, appearance }: {
    pet: Pet; paused: boolean; turn: number; take: number; move?: TacticsMove; onReady: () => void;
    careCue?: PetCareCue; baselineCareSerial: number; collarId: string; appearance: PetAppearancePreview;
}) {
    const config = useMemo(() => warfrontPetModelConfig(petCloseupPresentationModel({ id: pet.id, templateId: pet.templateId,
        name: pet.name, evolutionStage: pet.evolutionStage, rarity: pet.rarity }), true),
        [pet.id, pet.templateId, pet.name, pet.evolutionStage, pet.rarity]);
    const frame = useRef({ ...DEFAULT_PET_MODEL_FRAME });
    const elapsed = useRef(0);
    const phrase = useRef({ take, start: 0 });
    const care = useRef({ serial: baselineCareSerial, start: -100 });
    useEffect(onReady, [onReady]);
    useFrame((state, delta) => {
        if (!paused && !document.hidden) elapsed.current += Math.min(delta, .06);
        if (phrase.current.take !== take) phrase.current = { take, start: elapsed.current };
        if (careCue && care.current.serial !== careCue.serial) care.current = { serial: careCue.serial, start: elapsed.current };
        const age = elapsed.current - phrase.current.start;
        const attacking = take > 0 && age < 1.4;
        let motion: PetModelMotion = attacking ? age < .38 ? 'windup' : age < .64 ? 'strike' : 'recover' : 'idle';
        if (attacking && move?.kind === 'protect') motion = 'guard';
        if (attacking && move?.kind === 'heal') motion = 'rest';
        const reaction = careCue ? petCareReaction(careCue.kind, elapsed.current - care.current.start) : null;
        if (reaction?.active) motion = reaction.motion;
        const progress = motion === 'windup' ? age / .38 : motion === 'strike' ? (age - .38) / .26 : (age - .64) / .76;
        Object.assign(frame.current, {
            motion, timeline: elapsed.current, faceX: 0, faceZ: 1,
            moveName: attacking && !reaction?.active ? move?.name : undefined,
            moveStyle: petHeroMoveStyle({ petId: config?.visualId, petName: pet.name, move: move?.name, profile: config?.profile }),
            casting: attacking && !reaction?.active && move?.cls !== 'physical', contactPose: motion === 'strike',
            attackPhaseProgress: attacking && !reaction?.active ? Math.max(0, Math.min(1, progress)) : undefined,
            victorious: reaction?.victorious ?? false,
        });
        const canvas = state.gl.domElement;
        canvas.dataset.previewFrames = String(Number(canvas.dataset.previewFrames ?? 0) + 1);
        canvas.dataset.previewTime = String(elapsed.current);
        canvas.dataset.previewMotion = motion;
        canvas.dataset.previewCalls = String(state.gl.info.render.calls);
        canvas.dataset.previewTriangles = String(state.gl.info.render.triangles);
        canvas.dataset.previewModel = config?.url ?? '';
        canvas.dataset.previewCare = reaction?.active ? careCue?.kind ?? '' : '';
        canvas.dataset.previewCareSerial = String(care.current.serial);
        canvas.dataset.previewAppearance = appearance;
        canvas.dataset.previewCollar = collarId;
    }, -1);
    if (!config) return null;
    const surface = appearance === 'chromatic' ? CHROMATIC_PET_SURFACE : appearance === 'original' ? undefined : petModelVariantSurface(pet);
    // These birds rise and extend toward the camera during their authored strike.
    // Reserve that full motion envelope in the fixed inspection camera.
    const previewHeight = config.visualId === 'rare-27' ? 1.8 : config.visualId === 'starter-wind' || config.visualId === 'legendary-6' || config.visualId === 'legendary-10' || config.visualId === 'mythic-5' ? 1.8 : 2.15;
    return <><group scale={previewHeight / config.targetHeight} rotation={[0, turn, 0]}>
        <PetModel3D config={config} frame={frame} element={pet.element} quality={PET_VISUAL_QUALITY_PRESETS.low}
            showIdentity={false} silhouette="surface-ink" surfaceTreatment={surface} />
    </group><PetCollarAura collarId={collarId} timeline={elapsed} /></>;
}

export const PetYardModelStage = memo(function PetYardModelStage({ pet, paused, turn, take, move, onFail, careCue, appearance, collarId }: {
    pet: Pet; paused: boolean; turn: number; take: number; move?: TacticsMove; onFail: () => void;
    careCue?: PetCareCue; appearance: PetAppearancePreview; collarId: string;
}) {
    const [ready, setReady] = useState(false);
    const onReady = useCallback(() => setReady(true), []);
    const config = petCloseupPresentationModel(pet);
    const [baselineCareSerial] = useState(careCue?.serial ?? 0);
    useEffect(() => { if (!config) onFail(); }, [config, onFail]);
    if (!config) return null;
    return <>
        {!ready && <p className="pet-yard-inspector-loading" role="status">Loading companion…</p>}
        <Canvas frameloop="demand" dpr={1} shadows={false} gl={{ antialias: false, powerPreference: 'low-power' }}
            camera={{ position: [0, 1.65, 6.7], fov: 36 }}
            onCreated={({ camera, gl }) => {
                camera.lookAt(0, 1, 0);
                gl.domElement.addEventListener('webglcontextlost', onFail, { once: true });
            }}>
            <RendererRetirement />
            <PreviewClock paused={paused} />
            <color attach="background" args={['#111b26']} />
            <ambientLight intensity={1.65} />
            <directionalLight position={[3, 5, 4]} intensity={2} />
            <Suspense fallback={null}><Fighter pet={pet} paused={paused} turn={turn} take={take} move={move} careCue={careCue}
                baselineCareSerial={baselineCareSerial} appearance={appearance} collarId={collarId} onReady={onReady} /></Suspense>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -.02, 0]}>
                <circleGeometry args={[1.4, 32]} /><meshBasicMaterial color="#263242" />
            </mesh>
        </Canvas>
    </>;
}, (previous, next) => previous.paused === next.paused && previous.turn === next.turn && previous.take === next.take
    && previous.move === next.move && previous.careCue === next.careCue && previous.appearance === next.appearance
    && previous.collarId === next.collarId && previous.onFail === next.onFail
    // Server polling can replace a pet object without changing its model. Care
    // and equipment cues are separate props, so those actions still redraw.
    && previous.pet.id === next.pet.id && previous.pet.templateId === next.pet.templateId
    && previous.pet.name === next.pet.name && previous.pet.element === next.pet.element
    && previous.pet.evolutionStage === next.pet.evolutionStage && previous.pet.rarity === next.pet.rarity
    && previous.pet.paletteVariantId === next.pet.paletteVariantId);
