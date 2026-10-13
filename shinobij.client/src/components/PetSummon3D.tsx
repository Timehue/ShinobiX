import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Group, PointLight } from 'three';
import { advancePetCardState, createPetCardState, petCardStatePose, PET_RECALL_SECONDS, PET_SUMMON_SECONDS, type PetCardPhase, type PetCardPresence, type PetCardState } from '../lib/pet-summon-presentation';
import { PetSwitchSealFx } from './pet-showdown/pet-switch-seal-fx';
import { usePetRecallController } from './PetSceneRecall';

function CardMotion({ state: stateRef, phase, body: bodyRef, light, presence, present, playing, reduced, recallDelay, effectScale, exiting, phaseChanged }: {
    state: RefObject<PetCardState>; body: RefObject<Group | null>; light: RefObject<PointLight | null>;
    phase: PetCardPhase;
    presence?: RefObject<PetCardPresence>; present: boolean; playing: boolean; reduced: boolean;
    recallDelay: number; effectScale: number; exiting: boolean; phaseChanged: (phase: PetCardPhase) => void;
}) {
    const progress = useRef(0);
    const invalidate = useThree(state => state.invalidate);
    useEffect(() => { if (playing || exiting) invalidate(); }, [playing, exiting, invalidate]);
    useFrame((_, delta) => {
        if (!playing && !exiting) return;
        const before = stateRef.current.phase;
        const previousTimeline = stateRef.current.timeline;
        const input = exiting ? { present: false } : presence?.current ?? { present };
        advancePetCardState(stateRef.current, input, Math.min(delta, .05), exiting ? 0 : recallDelay, reduced);
        const pose = petCardStatePose(stateRef.current);
        if (bodyRef.current) {
            bodyRef.current.visible = pose.visible;
            bodyRef.current.scale.setScalar(pose.visible ? pose.scale : 0);
            bodyRef.current.position.setY(pose.lift);
        }
        progress.current = stateRef.current.elapsed / (stateRef.current.phase === 'recall' ? PET_RECALL_SECONDS : PET_SUMMON_SECONDS);
        if (before !== stateRef.current.phase) phaseChanged(stateRef.current.phase);
        const advanced = exiting || input.timeline === undefined || previousTimeline === undefined || input.timeline > previousTimeline;
        if (advanced && (stateRef.current.phase === 'summon' || stateRef.current.phase === 'holding' || stateRef.current.phase === 'recall')) invalidate();
    }, -.5);
    return phase === 'summon' || phase === 'recall'
        ? <group scale={effectScale}><PetSwitchSealFx entrance={phase === 'summon' ? progress : undefined} recall={phase === 'recall' ? progress : undefined} lightRef={light} reducedMotion={reduced} dynamicLight={false} /></group>
        : null;
}

/** Keep the actor mounted while present=false so the Beast Seal can absorb it.
 * Snapshot-driven hosts use a presence ref without per-frame React updates. */
export function PetSummon3D({ children, enabled = true, summonOnMount = true, present = true, presence, recallDelay = 0, effectScale = 1, reducedMotion = false, playing = true, dynamicLight = false, onComplete, onRecallComplete }: {
    children: ReactNode; enabled?: boolean; summonOnMount?: boolean; present?: boolean;
    presence?: RefObject<PetCardPresence>; recallDelay?: number; effectScale?: number; reducedMotion?: boolean;
    playing?: boolean; dynamicLight?: boolean; onComplete?: () => void; onRecallComplete?: () => void;
}) {
    const body = useRef<Group>(null);
    const light = useRef<PointLight>(null);
    const scope = usePetRecallController();
    const [exiting, setExiting] = useState(false);
    const exitResolve = useRef<(() => void) | null>(null);
    const [systemReduced, setSystemReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    useEffect(() => {
        const media = window.matchMedia('(prefers-reduced-motion: reduce)');
        const update = () => setSystemReduced(media.matches);
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, []);
    const reduced = reducedMotion || systemReduced;
    const [initial] = useState(() => {
        const card = createPetCardState(enabled ? presence?.current.present ?? present : true, enabled && summonOnMount && !reduced);
        return { card, phase: card.phase, pose: petCardStatePose(card) };
    });
    const state = useRef(initial.card);
    const [phase, setPhase] = useState(initial.phase);
    useEffect(() => {
        if (!scope || !enabled) return;
        const unsubscribe = scope.subscribe(() => { if (!scope.snapshot()) setExiting(false); });
        const unregister = scope.register(() => {
            let visible = !!body.current;
            for (let object = body.current?.parent; object; object = object.parent) visible = visible && object.visible;
            if (!visible || state.current.phase === 'hidden') return Promise.resolve();
            setExiting(true);
            return new Promise<void>(resolve => { exitResolve.current = resolve; });
        });
        return () => { unsubscribe(); unregister(); exitResolve.current?.(); exitResolve.current = null; };
    }, [scope, enabled]);
    const [hasLight] = useState(() => dynamicLight && enabled && !reduced);
    const notified = useRef<PetCardPhase | null>(null);
    const changed = (next: PetCardPhase) => {
        if (next !== 'settled' && next !== 'hidden') notified.current = null;
        setPhase(next);
    };
    useEffect(() => {
        if (phase === 'hidden') { exitResolve.current?.(); exitResolve.current = null; }
        if ((!playing && !exiting) || notified.current === phase) return;
        if (phase === 'settled') { notified.current = phase; onComplete?.(); }
        if (phase === 'hidden') { notified.current = phase; onRecallComplete?.(); }
    }, [phase, playing, exiting, reduced, onComplete, onRecallComplete]);
    // Seed the body once; frame updates own its transform thereafter. Keeping
    // these JSX props stable avoids resetting an in-flight card on host renders.
    const pose = initial.pose;
    return <group name="pet-card-presence" userData={{ petCardPhase: phase, petCardEnabled: enabled }}>
        <group ref={body} visible={enabled ? pose.visible : true} scale={enabled && pose.visible ? pose.scale : enabled ? 0 : 1} position={[0, enabled ? pose.lift : 0, 0]}>{children}</group>
        {/* The finite card meshes retire, but its zero-intensity light keeps
            Cinematic's shader layout stable for the rest of this fighter. */}
        {hasLight && <pointLight ref={light} color="#c4ffe7" intensity={0} distance={8} decay={2} position={[0, 2.1, 0]} />}
        {enabled && (presence !== undefined || exiting || phase !== (present ? 'settled' : 'hidden')) &&
            <CardMotion state={state} phase={phase} body={body} light={light} presence={presence} present={present} playing={playing} reduced={reduced} recallDelay={recallDelay} effectScale={effectScale} exiting={exiting} phaseChanged={changed} />}
    </group>;
}
