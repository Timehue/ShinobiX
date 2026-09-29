import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group, PointLight } from 'three';
import { PET_SUMMON_SECONDS, petSummonPose } from '../lib/pet-summon-presentation';
import { PetSwitchSealFx } from './pet-showdown/pet-switch-seal-fx';

function Entrance({ body, light, finish }: { body: RefObject<Group | null>; light: RefObject<PointLight | null>; finish: () => void }) {
    const time = useRef(0);
    const progress = useRef(0);
    useFrame((_, delta) => {
        time.current += Math.min(delta, .05);
        const pose = petSummonPose(time.current);
        progress.current = time.current / PET_SUMMON_SECONDS;
        if (body.current) {
            body.current.scale.setScalar(pose.visible ? pose.scale : 0);
            body.current.position.setY(pose.lift);
        }
        if (time.current >= PET_SUMMON_SECONDS) finish();
    }, -1);
    return <PetSwitchSealFx entrance={progress} lightRef={light} reducedMotion={false} />;
}

/** Finite card summon; once settled, release the effect meshes AND frame callback. */
export function PetSummon3D({ children, enabled = true, reducedMotion = false, playing = true, dynamicLight = false, onComplete }: { children: ReactNode; enabled?: boolean; reducedMotion?: boolean; playing?: boolean; dynamicLight?: boolean; onComplete?: () => void }) {
    const body = useRef<Group>(null);
    const light = useRef<PointLight>(null);
    const [hasLight] = useState(() => dynamicLight && enabled && !reducedMotion);
    const notified = useRef(false);
    const [done, setDone] = useState(() => !enabled || reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    useEffect(() => {
        if (!done || !playing || notified.current) return;
        notified.current = true;
        onComplete?.();
    }, [done, playing, onComplete]);
    return <group>
        <group ref={body}>{children}</group>
        {/* The finite card meshes retire, but its zero-intensity light keeps
            Cinematic's shader layout stable for the rest of this fighter. */}
        {hasLight && <pointLight ref={light} color="#c4ffe7" intensity={0} distance={8} decay={2} position={[0, 2.1, 0]} />}
        {!done && playing && <Entrance body={body} light={light} finish={() => setDone(true)} />}
    </group>;
}
