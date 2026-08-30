/*
 * Hollow Warfront three-lane presentation stage.
 *
 * The deterministic simulation remains in pet-warfront-sim. This component is
 * deliberately presentation-only: it projects the current snapshot onto the
 * approved battlefield plate, animated roster GLBs, Ward Totems, and the Gate
 * Warden rig. Low visual quality keeps the DOM-token renderer as a dependable
 * mobile/fallback path; medium and high use this broadcast stage.
 */
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Sparkles, useAnimations, useGLTF, useTexture } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { ArenaSlot } from "../lib/pet-arena-sim";
import { WARFRONT_TPS, type WfEvent, type WfSnapshot, type WfWardenSnap } from "../lib/pet-warfront-sim";
import { WF_LANE_IDS, WF_LANE_LABEL, WF_LANE_Y, WF_THEMES, type WfTheme } from "../lib/pet-warfront-map";
import { petCombatModel } from "../lib/pet-3d-models";
import { petModelVariantSurface } from "../lib/pet-visual-variant";
import {
    advanceWarfrontMotionFilter,
    createWarfrontMotionFilter,
    warfrontMotionFilterSpeed,
} from "../lib/pet-warfront-presentation";
import { DEFAULT_PET_MODEL_FRAME, PetModel3D, type PetModelFrame } from "./PetModel3D";
import type { PetVisualQualityConfig } from "../lib/pet-visual-quality";
import battlefieldArt from "../assets/warfront-three-lane/warfront-three-lane-ground.webp";

type Team = "blue" | "red";

const TEAM_COLOR: Record<Team, string> = { blue: "#3bc5ff", red: "#ff536f" };
const ELEMENT_COLOR: Readonly<Record<string, string>> = {
    fire: "#ff704a",
    water: "#49c9ff",
    wind: "#71f5d0",
    lightning: "#ffe168",
    earth: "#d6a76a",
    shadow: "#bd7bff",
};
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
                <div className={`wf3-worldplate wf3-worldplate--tower is-${team}${tower.fractured ? " is-fractured" : ""}${tower.exposedSecs > 0 ? " is-exposed" : ""}${tower.guardSecs > 0 ? " is-guarded" : ""}${tower.alive ? "" : " is-destroyed"}`}>
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

function Fighter3D({ actor, slot, displayTick }: {
    actor: WfSnapshot["actors"][number];
    slot: ArenaSlot | undefined;
    displayTick: number;
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
    const targetZ = actor.y + trackOffset;
    const hp = actor.hp / Math.max(1, actor.maxHp);
    const down = actor.state === "respawning";

    useFrame((_state, delta) => {
        const group = root.current;
        if (!group) return;
        const filter = renderMotion.current;
        const rewound = displayTick < lastTick.current;
        const teleport = filter.initialized && Math.hypot(filter.x - actor.x, filter.z - targetZ) > 7;
        advanceWarfrontMotionFilter(filter, actor.x, targetZ, delta, rewound || teleport || down);
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
        <group ref={root} position={[actor.x, 0, targetZ]}>
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
                <div className={`wf3-worldplate wf3-worldplate--fighter is-${team} is-slot-${actor.slot}${down ? " is-down" : ""}`}>
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

function Warden3D({ warden, events, displayTick }: { warden: WfWardenSnap; events: readonly WfEvent[]; displayTick: number }) {
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
        const rewound = displayTick < lastTick.current;
        const teleport = filter.initialized && Math.hypot(filter.x - warden.x, filter.z - warden.y) > 7;
        advanceWarfrontMotionFilter(filter, warden.x, warden.y, delta, rewound || teleport);
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
                <div className={`wf3-worldplate wf3-worldplate--warden is-${warden.team}`}>
                    <span>{warden.aspect} WARDEN · {Math.ceil(warden.secs)}s</span>
                    <i><b style={{ width: `${Math.max(0, hp * 100)}%` }} /></i>
                </div>
            </Html>
        </group>
    );
}

type GroundPoint = Readonly<{ x: number; z: number }>;

function combatantPoint(id: string, snapshot: WfSnapshot): GroundPoint | null {
    const actor = snapshot.actors.find((entry) => entry.id === id);
    if (actor) return { x: actor.x, z: actor.y };
    const tower = /^tower-(blue|red)-(n|m|s)$/.exec(id);
    if (tower) {
        const target = snapshot.towers[tower[1] as Team][tower[2] as keyof WfSnapshot["towers"][Team]];
        return { x: target.x, z: target.y };
    }
    const warden = /^warden-(blue|red)$/.exec(id);
    if (warden) {
        const target = snapshot.wardens[warden[1] as Team];
        return { x: target.x, z: target.y };
    }
    return null;
}

function eventPoint(event: WfEvent, snapshot: WfSnapshot): GroundPoint | null {
    if (event.type === "hit" || event.type === "heal") return combatantPoint(event.targetId, snapshot);
    if (event.type === "ability") return { x: event.x, z: event.y };
    if (event.type === "ultimate") return { x: event.x, z: event.y };
    if (event.type === "ultimatearmed") return combatantPoint(event.petId, snapshot);
    if (event.type === "elemsig") return { x: event.x, z: event.y };
    if (event.type === "towerhit" || event.type === "wardenhit" || event.type === "wardenslam") return { x: event.x, z: event.y };
    if (event.type === "towerfractured" || event.type === "towerdown") {
        const tower = snapshot.towers[event.team][event.lane];
        return { x: tower.x, z: tower.y };
    }
    if (event.type === "wardensummon" || event.type === "wardendown") {
        const warden = snapshot.wardens[event.team];
        return { x: warden.x, z: warden.y };
    }
    if (event.type === "sealexposed") {
        const tower = snapshot.towers[event.team][event.lane];
        return { x: tower.x, z: tower.y };
    }
    if (event.type === "lastward") {
        const lane = event.lanes[0] ?? "m";
        const tower = snapshot.towers[event.team][lane];
        return { x: tower.x, z: tower.y };
    }
    if (event.type === "hazard") return { x: 0, z: WF_LANE_Y[event.lane] };
    if (event.type === "riftrally" || event.type === "favorsteal") return { x: event.team === "blue" ? -11 : 11, z: 0 };
    return null;
}

function eventOrigin(event: WfEvent, snapshot: WfSnapshot): GroundPoint | null {
    if (event.type === "elemsig") return { x: event.px, z: event.py };
    if (event.type === "hit" || event.type === "heal" || event.type === "towerhit" || event.type === "wardenhit") {
        return combatantPoint(event.actorId, snapshot);
    }
    return null;
}

function eventColor(event: WfEvent, snapshot: WfSnapshot): string {
    if (event.type === "heal") return "#76f2ae";
    if (event.type === "ultimate" || event.type === "ultimatearmed") return TEAM_COLOR[event.team];
    if (event.type === "hazard") return "#f4cf73";
    if (event.type === "lastward") return "#fff0a6";
    if (event.type === "sealexposed") return "#ff9c5c";
    if (event.type === "riftrally" || event.type === "favorsteal") return TEAM_COLOR[event.team];
    if (event.type === "towerfractured" || event.type === "towerdown") return "#ffd36a";
    if (event.type === "ability" && event.kind === "shield") return "#8feaff";
    if (event.type === "wardenslam" || event.type === "wardensummon" || event.type === "wardendown") return TEAM_COLOR[event.team];
    if (event.type === "hit") return ELEMENT_COLOR[String(event.element ?? "").toLowerCase()] ?? "#f5fbff";
    if (event.type === "elemsig") return ELEMENT_COLOR[event.el.toLowerCase()] ?? "#f5fbff";
    if (event.type === "towerhit" || event.type === "wardenhit") {
        const actor = snapshot.actors.find((entry) => entry.id === event.actorId);
        return ELEMENT_COLOR[String(actor?.element ?? "").toLowerCase()] ?? TEAM_COLOR[event.team === "blue" ? "red" : "blue"];
    }
    return "#d8f8ff";
}

function eventLabel(event: WfEvent): string | null {
    if (event.type === "hit") return `${event.crit ? "CRIT " : ""}-${event.dmg}`;
    if (event.type === "heal") return `+${event.amount}`;
    if (event.type === "towerhit" || event.type === "wardenhit") return `-${event.dmg}`;
    if (event.type === "towerfractured") return "WARD FRACTURED";
    if (event.type === "towerdown") return "WARD SHATTERED";
    if (event.type === "wardenslam") return "WARDEN SLAM";
    if (event.type === "wardensummon") return `${event.aspect.toUpperCase()} WARDEN`;
    if (event.type === "ultimatearmed") return `${event.name.toUpperCase()} ARMED`;
    if (event.type === "ultimate") return event.name.toUpperCase();
    if (event.type === "hazard") return `${event.label.toUpperCase()} · ${WF_LANE_LABEL[event.lane].toUpperCase()}`;
    if (event.type === "lastward") return "LAST WARD";
    if (event.type === "sealexposed") return "SEAL EXPOSED";
    if (event.type === "riftrally") return "RIFT RALLY";
    if (event.type === "favorsteal") return `FAVOR STOLEN +${Math.round(event.amount)}`;
    return null;
}

function EventBeam({ from, to, color, progress }: { from: GroundPoint; to: GroundPoint; color: string; progress: number }) {
    const geometry = useMemo(() => {
        const origin = new THREE.Vector3(from.x, 1.05, from.z);
        const target = new THREE.Vector3(to.x, 0.72, to.z);
        const direction = target.clone().sub(origin);
        const length = direction.length();
        const midpoint = origin.clone().add(target).multiplyScalar(0.5);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
        return { length, midpoint, quaternion };
    }, [from.x, from.z, to.x, to.z]);
    if (geometry.length < 1.4) return null;
    return (
        <mesh position={geometry.midpoint} quaternion={geometry.quaternion}>
            <cylinderGeometry args={[0.025, 0.09, geometry.length, 8, 1, true]} />
            <meshBasicMaterial color={color} transparent opacity={Math.max(0, 0.58 * (1 - progress))} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
    );
}

function EventPulse({ event, snapshot, displayTick, quality }: { event: WfEvent; snapshot: WfSnapshot; displayTick: number; quality: PetVisualQualityConfig }) {
    const point = eventPoint(event, snapshot);
    const origin = eventOrigin(event, snapshot);
    if (!point) return null;
    const major = event.type === "towerfractured" || event.type === "towerdown" || event.type === "wardenslam" || event.type === "wardensummon"
        || event.type === "ultimate" || event.type === "hazard" || event.type === "lastward" || event.type === "riftrally";
    const lifetime = major ? WARFRONT_TPS * 1.2 : WARFRONT_TPS * 0.62;
    const progress = Math.max(0, Math.min(1, (displayTick - event.t) / lifetime));
    const color = eventColor(event, snapshot);
    const label = eventLabel(event);
    const radius = (major ? 1.4 : 0.62) + progress * (major ? 3.2 : 1.35);
    const opacity = Math.pow(1 - progress, 1.6);
    return (
        <group position={[point.x, 0, point.z]}>
            {origin ? <EventBeam from={origin} to={point} color={color} progress={progress} /> : null}
            <mesh position={[0, 0.055, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={radius}>
                <ringGeometry args={[0.72, 1, major ? 48 : 28]} />
                <meshBasicMaterial color={color} transparent opacity={opacity * (major ? 0.72 : 0.5)} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
            </mesh>
            <mesh position={[0, 0.52 + progress * 0.7, 0]} scale={(major ? 0.9 : 0.38) + progress * 0.6}>
                <octahedronGeometry args={[1, major ? 2 : 1]} />
                <meshBasicMaterial color={color} wireframe transparent opacity={opacity * 0.38} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
            </mesh>
            {quality.dynamicPetLight ? <pointLight color={color} intensity={opacity * (major ? 3.4 : 1.4)} distance={major ? 8 : 4} decay={2} position={[0, 1.2, 0]} /> : null}
            {quality.id === "high" ? <Sparkles count={major ? 16 : 7} scale={major ? [4, 2.6, 4] : [1.8, 1.6, 1.8]} size={major ? 2 : 1.2} speed={0.7} color={color} opacity={opacity * 0.72} position={[0, 1, 0]} /> : null}
            {label ? (
                <Html position={[0, major ? 3.5 : 2.15, 0]} center pointerEvents="none" zIndexRange={[24, 0]}>
                    <span className={`wf3-float-number${major ? " is-major" : ""}`} style={{ "--event-color": color } as CSSProperties}>{label}</span>
                </Html>
            ) : null}
        </group>
    );
}

function WarfrontEventLayer({ events, snapshot, displayTick, quality }: { events: readonly WfEvent[]; snapshot: WfSnapshot; displayTick: number; quality: PetVisualQualityConfig }) {
    const oldestVisibleTick = displayTick - WARFRONT_TPS * 1.2;
    const visible: Array<{ event: WfEvent; sourceIndex: number }> = [];
    for (let sourceIndex = events.length - 1; sourceIndex >= 0; sourceIndex -= 1) {
        const event = events[sourceIndex];
        if (event.t > displayTick) continue;
        if (event.t < oldestVisibleTick) break;
        visible.push({ event, sourceIndex });
    }
    return visible.map(({ event, sourceIndex }) => (
        <EventPulse key={`${event.t}-${event.type}-${sourceIndex}`} event={event} snapshot={snapshot} displayTick={displayTick} quality={quality} />
    ));
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

function WarfrontScene({ snapshot, blue, red, quality, displayTick, events, theme, onSceneReady }: PetWarfrontStage3DProps & { onSceneReady: () => void }) {
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
                <Fighter3D key={actor.id} actor={actor} slot={(actor.team === "blue" ? blue : red)[actor.slot]} displayTick={displayTick} />
            ))}
            <Warden3D warden={snapshot.wardens.blue} events={events} displayTick={displayTick} />
            <Warden3D warden={snapshot.wardens.red} events={events} displayTick={displayTick} />
            <WarfrontEventLayer events={events} snapshot={snapshot} displayTick={displayTick} quality={quality} />
            {quality.id !== "low" ? <Sparkles count={quality.id === "high" ? 54 : 28} scale={[62, 4, 34]} size={1.2} speed={0.18} color={themeSpec.breachGlow} opacity={0.24} position={[0, 2.3, 0]} /> : null}
            {quality.id === "high" ? <EffectComposer><Bloom luminanceThreshold={0.78} luminanceSmoothing={0.2} intensity={0.42} mipmapBlur /></EffectComposer> : null}
        </>
    );
}

export type PetWarfrontStage3DProps = {
    snapshot: WfSnapshot;
    blue: ArenaSlot[];
    red: ArenaSlot[];
    quality: PetVisualQualityConfig;
    displayTick: number;
    events: readonly WfEvent[];
    theme: WfTheme;
};

export function PetWarfrontStage3D(props: PetWarfrontStage3DProps) {
    const [sceneReady, setSceneReady] = useState(false);
    const markSceneReady = useCallback(() => setSceneReady(true), []);
    return (
        <div className="wf3-stage-3d" data-theme={props.theme} data-scene-ready={sceneReady ? "true" : "false"} role="img" aria-label="Three-dimensional Hollow Warfront battlefield">
            <Canvas
                orthographic
                shadows={props.quality.modelShadows ? "percentage" : false}
                dpr={props.quality.dpr}
                gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
                camera={{ position: [0, 47, 18], near: 0.1, far: 110, zoom: 18 }}
                onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
            >
                <WarfrontScene {...props} onSceneReady={markSceneReady} />
            </Canvas>
        </div>
    );
}
