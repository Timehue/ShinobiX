import { WarfrontEventLayer } from './pet-warfront/event-layer';
import { type Team, TEAM_COLOR } from './pet-warfront/scene-colors';
/*
 * ⚠ THIS IS NOT THE HOLLOW WARFRONT GAME MODE ANY MORE.
 *
 * Hollow Warfront is now the RITE — four pets a side fighting at once, best of
 * three clashes (docs/hollow-warfront-rite.md, lib/pet-warfront-rite.ts). The
 * three-lane war it replaced is no longer playable: the arena lobby, co-op and
 * the dev harness all launch the Rite.
 *
 * This file survives for ONE reason: the PET LADDER's tactical ladder still
 * resolves and replays on it (api/pet-ladder/_core.ts calls runWarfrontMatch,
 * screens/PetLadder.tsx renders the replay). That is server-authoritative
 * ranked play with existing standings, so the engine cannot simply be swapped.
 *
 * Do not wire this into anything new, and do not let player-facing copy call it
 * "the Warfront" — that name belongs to the Rite.
 */
/*
 * Hollow Warfront three-lane presentation stage.
 *
 * The deterministic simulation remains in pet-warfront-sim. This component is
 * deliberately presentation-only: it projects the current snapshot onto the
 * approved battlefield plate, animated roster GLBs, Ward Totems, and the Gate
 * Warden rig. Low visual quality keeps the DOM-token renderer as a dependable
 * mobile/fallback path; medium and high use this broadcast stage.
 */
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Sparkles, useAnimations, useGLTF, useTexture } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { ArenaSlot } from "../lib/pet-arena-sim";
import { WARFRONT_TPS, type WfEvent, type WfSnapshot, type WfWardenSnap } from "../lib/pet-warfront-sim";
import { WF_LANE_IDS, WF_LANE_LABEL, WF_THEMES, type WfTheme } from "../lib/pet-warfront-map";
import { petCombatModel } from "../lib/pet-3d-models";
import { petModelVariantSurface } from "../lib/pet-visual-variant";
import {
    advanceWarfrontMotionFilter,
    createWarfrontMotionFilter,
    warfrontActorPresentationPoint,
    warfrontMotionFilterSpeed,
    warfrontWardenPresentationPoint,
} from "../lib/pet-warfront-presentation";
import { DEFAULT_PET_MODEL_FRAME, PetModel3D, type PetModelFrame } from "./PetModel3D";
import type { PetVisualQualityConfig } from "../lib/pet-visual-quality";
import battlefieldArt from "../assets/warfront-three-lane/warfront-three-lane-ground.webp";
const ROLE_LABEL: Readonly<Record<string, string>> = {
    defender: "VANGUARD",
    tracker: "RANGER",
    assassin: "STRIKER",
    sage: "MYSTIC",
};
const PROP_URLS = {
    tower: "/pet-models/ward-totem.glb",
    lantern: "/pet-models/wf-lantern.glb",
    boulder: "/pet-models/wf-boulder.glb",
    warden: "/pet-models/gate-warden-rigged.glb?v=20260729-rig-v2",
} as const;
const BATTLEFIELD_PLATE_WIDTH = 70;
const BATTLEFIELD_PLATE_HEIGHT = 39.42;
for (const url of Object.values(PROP_URLS)) useGLTF.preload(url);
const LANE_PRESENTATION_TRACKS: Readonly<Record<Team, readonly number[]>> = {
    blue: [-1.72, -1.18, -0.64, -0.1],
    red: [0.1, 0.64, 1.18, 1.72],
};
const LANTERN_PLACEMENTS = Object.freeze(WF_LANE_IDS.flatMap((lane, laneIndex) => {
    const z = [-11, 0, 11][laneIndex];
    return [-15.5, 0, 15.5].flatMap((x, index) => [
        { key: `${lane}-${index}-a`, x, z: z - 2.05, rotation: index * 0.7 },
        { key: `${lane}-${index}-b`, x, z: z + 2.05, rotation: Math.PI + index * 0.7 },
    ]);
}));
const BOULDER_PLACEMENTS = Object.freeze([
    { key: "n-left", x: -9.5, z: -8.95, rotation: 0.3, scale: 0.72 },
    { key: "n-right", x: 9.5, z: -13.05, rotation: 1.8, scale: 0.62 },
    { key: "m-left", x: -10.5, z: 2.02, rotation: 0.9, scale: 0.68 },
    { key: "m-right", x: 10.5, z: -2.02, rotation: 2.4, scale: 0.76 },
    { key: "s-left", x: -8.5, z: 13.02, rotation: 0.5, scale: 0.6 },
    { key: "s-right", x: 8.5, z: 8.98, rotation: 2.1, scale: 0.7 },
]);

function BattlefieldPlate({ quality, theme }: { quality: PetVisualQualityConfig; theme: WfTheme }) {
    const source = useTexture(battlefieldArt);
    const themeSpec = WF_THEMES[theme];
    const texture = useMemo(() => {
        const next = source.clone();
        next.colorSpace = THREE.SRGBColorSpace;
        next.anisotropy = quality.textureAnisotropy;
        next.needsUpdate = true;
        return next;
    }, [source, quality.textureAnisotropy]);
    const plateTint = useMemo(() => {
        const authoredTint = new THREE.Color().setHSL(themeSpec.tileHue, themeSpec.tileSat, 0.7);
        return new THREE.Color("#d7e2e3").lerp(authoredTint, theme === "central" ? 0.04 : 0.34);
    }, [theme, themeSpec.tileHue, themeSpec.tileSat]);
    useEffect(() => () => texture.dispose(), [texture]);
    return (
        <mesh position={[0, -0.14, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow={quality.modelShadows}>
            <planeGeometry args={[BATTLEFIELD_PLATE_WIDTH, BATTLEFIELD_PLATE_HEIGHT]} />
            <meshStandardMaterial map={texture} color={plateTint} roughness={0.96} metalness={0.02} />
        </mesh>
    );
}

function FitBattlefieldCamera() {
    const camera = useThree((state) => state.camera);
    const width = useThree((state) => state.size.width);
    const height = useThree((state) => state.size.height);
    useLayoutEffect(() => {
        if (!(camera instanceof THREE.OrthographicCamera)) return;
        // OrthographicCamera is an imperative Three.js projection controller;
        // fitting its zoom here keeps the authored battlefield edge-to-edge.
        // eslint-disable-next-line react-hooks/immutability
        camera.zoom = Math.max(width / BATTLEFIELD_PLATE_WIDTH, height / BATTLEFIELD_PLATE_HEIGHT);
        camera.updateProjectionMatrix();
    }, [camera, height, width]);
    return null;
}

function SceneReady({ onReady }: { onReady: () => void }) {
    const reported = useRef(false);
    useFrame(() => {
        if (reported.current) return;
        reported.current = true;
        onReady();
    });
    return null;
}

function normalizeAsset(
    source: THREE.Group,
    targetHeight: number,
    tint: string,
    emissiveIntensity: number,
    skinned = false,
): THREE.Group {
    const clone = (skinned ? cloneSkeleton(source) : source.clone(true)) as THREE.Group;
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = targetHeight / Math.max(0.001, size.y);
    clone.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    clone.scale.setScalar(scale);
    clone.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        const sources = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const materials = sources.map((entry) => {
            const sourceMaterial = entry as THREE.MeshStandardMaterial;
            const material = sourceMaterial.clone();
            if ((material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
                const standard = material as THREE.MeshStandardMaterial;
                standard.color.lerp(new THREE.Color(tint), 0.14);
                standard.emissive = new THREE.Color(tint);
                standard.emissiveIntensity = emissiveIntensity;
                if (standard.map) standard.map.colorSpace = THREE.SRGBColorSpace;
            }
            return material;
        });
        mesh.material = Array.isArray(mesh.material) ? materials : materials[0];
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
    });
    return clone;
}

function StaticAsset({ url, targetHeight, tint = "#ffffff", emissiveIntensity = 0.08, skinned = false }: {
    url: string;
    targetHeight: number;
    tint?: string;
    emissiveIntensity?: number;
    skinned?: boolean;
}) {
    const { scene } = useGLTF(url);
    const prepared = useMemo(
        () => normalizeAsset(scene, targetHeight, tint, emissiveIntensity, skinned),
        [scene, targetHeight, tint, emissiveIntensity, skinned],
    );
    useEffect(() => () => {
        prepared.traverse((node) => {
            const mesh = node as THREE.Mesh;
            if (!mesh.isMesh) return;
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const material of materials) material.dispose();
        });
    }, [prepared]);
    return <primitive object={prepared} />;
}

function PropFallback({ height, color }: { height: number; color: string }) {
    return (
        <mesh position={[0, height * 0.5, 0]} castShadow>
            <octahedronGeometry args={[height * 0.32, 1]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.28} roughness={0.72} />
        </mesh>
    );
}

function Tower3D({ tower }: { tower: WfSnapshot["towers"][Team]["n"] }) {
    const team = tower.team;
    const hp = tower.hp / Math.max(1, tower.maxHp);
    return (
        <group position={[tower.x, 0, tower.y]} scale={tower.alive ? 1 : 0.72}>
            <Suspense fallback={<PropFallback height={2.8} color={TEAM_COLOR[team]} />}>
                <StaticAsset url={PROP_URLS.tower} targetHeight={4.15} tint={TEAM_COLOR[team]} emissiveIntensity={tower.fractured ? 0.72 : 0.3} />
            </Suspense>
            <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[1.18, 1.54, 48]} />
                <meshBasicMaterial color={tower.exposedSecs > 0 ? "#ffbd68" : tower.guardSecs > 0 ? "#f8ec9d" : TEAM_COLOR[team]} transparent opacity={tower.alive ? tower.exposedSecs > 0 || tower.guardSecs > 0 ? 0.72 : 0.38 : 0.08} depthWrite={false} toneMapped={false} />
            </mesh>
            <pointLight color={TEAM_COLOR[team]} intensity={tower.alive ? 1.5 : 0.2} distance={7} decay={2} position={[0, 1.4, 0]} />
            {/* Keep tower plates clear of the persistent lane-status rail. The
                former 2.4-unit offset left the Azure labels underneath that
                HUD on desktop, clipping the lane name despite a healthy tower. */}
            <Html position={[team === "blue" ? 4.6 : -4.6, 4.62, 0]} center pointerEvents="none" zIndexRange={[14, 0]}>
                <div className={`wf3-worldplate wf3-worldplate--tower is-${team} is-lane-${tower.lane}${tower.fractured ? " is-fractured" : ""}${tower.exposedSecs > 0 ? " is-exposed" : ""}${tower.guardSecs > 0 ? " is-guarded" : ""}${tower.alive ? "" : " is-destroyed"}`}>
                    <span>{WF_LANE_LABEL[tower.lane]} WARD{tower.exposedSecs > 0 ? " · EXPOSED" : tower.guardSecs > 0 ? " · LAST WARD" : ""}</span>
                    <i><b style={{ width: `${Math.max(0, hp * 100)}%` }} /></i>
                </div>
            </Html>
        </group>
    );
}

function PetFallback({ height, color }: { height: number; color: string }) {
    return (
        <mesh position={[0, height * 0.48, 0]} castShadow>
            <capsuleGeometry args={[height * 0.22, height * 0.5, 5, 10]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} roughness={0.54} />
        </mesh>
    );
}

function Fighter3D({ actor, slot, displayTick, playbackTickRef, snapshots }: {
    actor: WfSnapshot["actors"][number];
    slot: ArenaSlot | undefined;
    displayTick: number;
    playbackTickRef: MutableRefObject<number>;
    snapshots: readonly WfSnapshot[];
}) {
    const pet = slot?.pet;
    const config = useMemo(() => pet ? petCombatModel(pet) : null, [pet]);
    const root = useRef<THREE.Group>(null);
    const body = useRef<THREE.Group>(null);
    const frame = useRef<PetModelFrame>({ ...DEFAULT_PET_MODEL_FRAME });
    const renderMotion = useRef(createWarfrontMotionFilter());
    const lastHp = useRef(actor.hp);
    const lastTick = useRef(displayTick);
    const team = actor.team;
    const scale = config ? Math.min(1.18, 2.7 / Math.max(0.1, config.targetHeight)) : 1;
    const renderedHeight = config ? config.targetHeight * scale : 1.7;
    const trackOffset = LANE_PRESENTATION_TRACKS[team][actor.slot] ?? 0;
    const hp = actor.hp / Math.max(1, actor.maxHp);
    const down = actor.state === "respawning";

    useFrame((_state, delta) => {
        const group = root.current;
        if (!group) return;
        const filter = renderMotion.current;
        const target = warfrontActorPresentationPoint(
            snapshots,
            actor.id,
            playbackTickRef.current,
            { x: actor.x, y: actor.y },
        );
        const targetZ = target.y + trackOffset;
        const rewound = displayTick < lastTick.current;
        const teleport = filter.initialized && Math.hypot(filter.x - target.x, filter.z - targetZ) > 7;
        advanceWarfrontMotionFilter(filter, target.x, targetZ, delta, rewound || teleport || down);
        group.position.x = filter.x;
        group.position.z = filter.z;
        const speed = warfrontMotionFilterSpeed(filter);
        const moving = !down && (actor.state === "move" || actor.state === "dash" || speed > 0.2);
        const modelFrame = frame.current;
        modelFrame.motion = down ? "dead" : actor.state === "attack" ? "strike" : actor.state === "dash" ? "dash" : moving ? "run" : "idle";
        modelFrame.moving = moving;
        modelFrame.speed = Math.min(6, speed);
        modelFrame.moveX = speed > 0.01 ? filter.vx : team === "blue" ? 1 : -1;
        modelFrame.moveZ = speed > 0.01 ? filter.vz : 0;
        modelFrame.faceX = Math.abs(actor.faceX) > 0.05 ? actor.faceX : team === "blue" ? 1 : -1;
        modelFrame.faceZ = actor.faceY;
        modelFrame.hit = actor.hp < lastHp.current ? 1 : modelFrame.hit * 0.84;
        modelFrame.impactPower = actor.state === "attack" ? 0.78 : 0.52;
        modelFrame.casting = actor.role === "sage" && actor.state === "attack";
        modelFrame.desperate = !down && hp < 0.28;
        modelFrame.statuses = actor.statuses;
        modelFrame.timeline = displayTick / 30;
        if (body.current) {
            body.current.visible = !down;
            body.current.scale.setScalar(down ? 0.01 : 1);
        }
        lastHp.current = actor.hp;
        lastTick.current = displayTick;
    });

    return (
        <group ref={root} position={[actor.x, 0, actor.y + trackOffset]}>
            <group ref={body}>
                {config && pet ? (
                    <Suspense fallback={<PetFallback height={renderedHeight} color={TEAM_COLOR[team]} />}>
                        <group scale={scale}>
                            <PetModel3D config={config} frame={frame as MutableRefObject<PetModelFrame>} element={pet.element} surfaceTreatment={petModelVariantSurface(pet)} />
                        </group>
                    </Suspense>
                ) : <PetFallback height={renderedHeight} color={TEAM_COLOR[team]} />}
                {actor.shielded ? (
                    <mesh position={[0, renderedHeight * 0.52, 0]}>
                        <sphereGeometry args={[renderedHeight * 0.68, 20, 14]} />
                        <meshBasicMaterial color={TEAM_COLOR[team]} transparent opacity={0.16} depthWrite={false} blending={THREE.AdditiveBlending} />
                    </mesh>
                ) : null}
            </group>
            <mesh position={[0, 0.018, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[0.78, 32]} />
                <meshBasicMaterial color={TEAM_COLOR[team]} transparent opacity={down ? 0.1 : 0.26} depthWrite={false} />
            </mesh>
            <Html position={[0, renderedHeight + 0.92, 0]} center pointerEvents="none" zIndexRange={[16, 0]}>
                <div className={`wf3-worldplate wf3-worldplate--fighter is-${team} is-lane-${actor.lane} is-slot-${actor.slot}${down ? " is-down" : ""}`}>
                    <div><small>{ROLE_LABEL[actor.role] ?? actor.role}</small><strong>{pet?.name ?? actor.id}</strong></div>
                    <i><b style={{ width: `${Math.max(0, hp * 100)}%` }} /></i>
                    <i className={`wf3-worldplate__ultimate${actor.ultimateReady ? " is-ready" : ""}`}><b style={{ width: `${actor.ultimateCharge}%` }} /></i>
                    {down ? <em>RETURNING · {Math.ceil(actor.respawnSecs)}s</em> : null}
                </div>
            </Html>
        </group>
    );
}

type WardenRigClip = "GW_Idle" | "GW_Walk" | "GW_Windup" | "GW_Slam" | "GW_Hit";

function AnimatedWardenAsset({ motion, tint }: { motion: WardenRigClip; tint: string }) {
    const { scene, animations } = useGLTF(PROP_URLS.warden);
    const prepared = useMemo(
        () => normalizeAsset(scene, 3.65, tint, 0.42, true),
        [scene, tint],
    );
    const { actions } = useAnimations(animations, prepared);

    useEffect(() => {
        const action = actions[motion] ?? actions.GW_Idle ?? null;
        if (!action) return;
        const oneShot = motion === "GW_Slam" || motion === "GW_Hit" || motion === "GW_Windup";
        action.reset().setLoop(oneShot ? THREE.LoopOnce : THREE.LoopRepeat, oneShot ? 1 : Infinity);
        // AnimationAction is an imperative Three.js controller owned by the mixer.
        // eslint-disable-next-line react-hooks/immutability
        action.clampWhenFinished = oneShot;
        action.fadeIn(0.1).play();
        return () => { action.fadeOut(0.12); };
    }, [actions, motion]);

    useEffect(() => () => {
        prepared.traverse((node) => {
            const mesh = node as THREE.Mesh;
            if (!mesh.isMesh) return;
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const material of materials) material.dispose();
        });
    }, [prepared]);

    return <primitive object={prepared} />;
}

function findRecentWardenEvent(events: readonly WfEvent[], displayTick: number, warden: WfWardenSnap) {
    const oldestVisibleTick = displayTick - WARFRONT_TPS * 0.9;
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event.t > displayTick) continue;
        if (event.t < oldestVisibleTick) break;
        if (
            (event.type === "wardenslam" && event.team === warden.team)
            || (event.type === "wardenhit" && event.team === warden.team)
            || (event.type === "hit" && event.actorId === `warden-${warden.team}`)
        ) return event;
    }
    return undefined;
}

function Warden3D({ warden, events, displayTick, playbackTickRef, snapshots }: {
    warden: WfWardenSnap;
    events: readonly WfEvent[];
    displayTick: number;
    playbackTickRef: MutableRefObject<number>;
    snapshots: readonly WfSnapshot[];
}) {
    const root = useRef<THREE.Group>(null);
    const renderMotion = useRef(createWarfrontMotionFilter());
    const lastTick = useRef(displayTick);
    const hp = warden.hp / Math.max(1, warden.maxHp);
    const recent = findRecentWardenEvent(events, displayTick, warden);
    const eventAge = recent ? displayTick - recent.t : Infinity;
    const motion: WardenRigClip = recent?.type === "wardenslam" && eventAge <= WARFRONT_TPS * 0.9
        ? "GW_Slam"
        : recent?.type === "wardenhit" && eventAge <= WARFRONT_TPS * 0.32
            ? "GW_Hit"
            : recent?.type === "hit" && eventAge <= WARFRONT_TPS * 0.5
                ? "GW_Windup"
                : warden.targetId !== null ? "GW_Walk" : "GW_Idle";

    useFrame((_state, delta) => {
        if (!root.current) return;
        const filter = renderMotion.current;
        const target = warfrontWardenPresentationPoint(
            snapshots,
            warden.team,
            playbackTickRef.current,
            { x: warden.x, y: warden.y },
        );
        const rewound = displayTick < lastTick.current;
        const teleport = filter.initialized && Math.hypot(filter.x - target.x, filter.z - target.y) > 7;
        advanceWarfrontMotionFilter(filter, target.x, target.y, delta, rewound || teleport);
        root.current.position.x = filter.x;
        root.current.position.z = filter.z;
        lastTick.current = displayTick;
    });
    if (!warden.active) return null;
    return (
        <group ref={root} position={[warden.x, 0, warden.y]} rotation={[0, warden.team === "blue" ? Math.PI / 2 : -Math.PI / 2, 0]}>
            <Suspense fallback={<PropFallback height={3.4} color={TEAM_COLOR[warden.team]} />}>
                <AnimatedWardenAsset motion={motion} tint={TEAM_COLOR[warden.team]} />
            </Suspense>
            <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[1.35, 1.82, 48]} />
                <meshBasicMaterial color={TEAM_COLOR[warden.team]} transparent opacity={0.5} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>
            <pointLight color={TEAM_COLOR[warden.team]} intensity={2.4} distance={8} decay={2} position={[0, 2, 0]} />
            <Html position={[0, 4.28, 0]} center pointerEvents="none" zIndexRange={[18, 0]}>
                <div className={`wf3-worldplate wf3-worldplate--warden is-${warden.team} is-lane-${warden.lane}`}>
                    <span>{warden.aspect} WARDEN · {Math.ceil(warden.secs)}s</span>
                    <i><b style={{ width: `${Math.max(0, hp * 100)}%` }} /></i>
                </div>
            </Html>
        </group>
    );
}

function SetDressing({ quality }: { quality: PetVisualQualityConfig }) {
    return (
        <group>
            {LANTERN_PLACEMENTS.map((item) => (
                <group key={item.key} position={[item.x, 0, item.z]} rotation={[0, item.rotation, 0]}>
                    <Suspense fallback={null}>
                        <StaticAsset url={PROP_URLS.lantern} targetHeight={1.42} tint="#b17e57" emissiveIntensity={0.06} />
                    </Suspense>
                    {quality.dynamicPetLight ? <pointLight color="#ff783f" intensity={0.44} distance={3.4} decay={2} position={[0, 0.9, 0]} /> : null}
                </group>
            ))}
            {BOULDER_PLACEMENTS.map((item) => (
                <group key={item.key} position={[item.x, 0, item.z]} rotation={[0, item.rotation, 0]} scale={item.scale}>
                    <Suspense fallback={null}>
                        <StaticAsset url={PROP_URLS.boulder} targetHeight={0.92} tint="#6f7d77" emissiveIntensity={0.02} />
                    </Suspense>
                </group>
            ))}
        </group>
    );
}

function WarfrontScene({ snapshot, snapshots, playbackTickRef, blue, red, quality, displayTick, events, theme, onSceneReady }: PetWarfrontStage3DProps & { onSceneReady: () => void }) {
    const themeSpec = WF_THEMES[theme];
    return (
        <>
            <FitBattlefieldCamera />
            <fog attach="fog" args={[themeSpec.fogColor, 47, 83]} />
            <ambientLight intensity={quality.id === "high" ? 1.4 : 1.72} color={themeSpec.skyLight} />
            <hemisphereLight args={[themeSpec.skyLight, themeSpec.groundLight, quality.id === "high" ? 1.35 : 1.6]} />
            <directionalLight
                position={[-17, 31, 18]}
                intensity={quality.id === "high" ? 2.3 : 1.75}
                color={themeSpec.sunColor}
                castShadow={quality.modelShadows}
                shadow-mapSize-width={quality.id === "high" ? 2048 : 512}
                shadow-mapSize-height={quality.id === "high" ? 2048 : 512}
            />
            <Suspense fallback={null}>
                <BattlefieldPlate quality={quality} theme={theme} />
                <SceneReady onReady={onSceneReady} />
            </Suspense>
            <SetDressing quality={quality} />
            {WF_LANE_IDS.flatMap((lane) => [
                <Tower3D key={`blue-${lane}`} tower={snapshot.towers.blue[lane]} />,
                <Tower3D key={`red-${lane}`} tower={snapshot.towers.red[lane]} />,
            ])}
            {snapshot.actors.map((actor) => (
                <Fighter3D key={actor.id} actor={actor} slot={(actor.team === "blue" ? blue : red)[actor.slot]} displayTick={displayTick} playbackTickRef={playbackTickRef} snapshots={snapshots} />
            ))}
            <Warden3D warden={snapshot.wardens.blue} events={events} displayTick={displayTick} playbackTickRef={playbackTickRef} snapshots={snapshots} />
            <Warden3D warden={snapshot.wardens.red} events={events} displayTick={displayTick} playbackTickRef={playbackTickRef} snapshots={snapshots} />
            <WarfrontEventLayer events={events} snapshot={snapshot} displayTick={displayTick} quality={quality} />
            {quality.id !== "low" ? <Sparkles count={quality.id === "high" ? 54 : 28} scale={[62, 4, 34]} size={1.2} speed={0.18} color={themeSpec.breachGlow} opacity={0.24} position={[0, 2.3, 0]} /> : null}
            {quality.id === "high" ? <EffectComposer><Bloom luminanceThreshold={0.78} luminanceSmoothing={0.2} intensity={0.42} mipmapBlur /></EffectComposer> : null}
        </>
    );
}

export type PetWarfrontStage3DProps = {
    snapshot: WfSnapshot;
    snapshots: readonly WfSnapshot[];
    playbackTickRef: MutableRefObject<number>;
    blue: ArenaSlot[];
    red: ArenaSlot[];
    quality: PetVisualQualityConfig;
    paused: boolean;
    displayTick: number;
    events: readonly WfEvent[];
    theme: WfTheme;
};

export function PetWarfrontStage3D(props: PetWarfrontStage3DProps) {
    const [sceneReady, setSceneReady] = useState(false);
    const markSceneReady = useCallback(() => setSceneReady(true), []);
    return (
        <div className="wf3-stage-3d" data-theme={props.theme} data-scene-ready={sceneReady ? "true" : "false"} role="img" aria-label="Three-dimensional Beastbound Warfront battlefield">
            <Canvas
                orthographic
                shadows={props.quality.modelShadows ? "percentage" : false}
                dpr={props.quality.dpr}
                frameloop={props.paused ? "demand" : "always"}
                gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
                camera={{ position: [0, 47, 18], near: 0.1, far: 110, zoom: 18 }}
                onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
            >
                <WarfrontScene {...props} onSceneReady={markSceneReady} />
            </Canvas>
        </div>
    );
}
