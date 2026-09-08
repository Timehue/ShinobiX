import { type Team, TEAM_COLOR, ELEMENT_COLOR } from './scene-colors';
import {
    type WfSnapshot,
    type WfEvent,
    WARFRONT_TPS,
} from "../../lib/pet-warfront-sim";
import {
    WF_LANE_Y,
    WF_LANE_LABEL,
} from "../../lib/pet-warfront-map";
import {
    useMemo,
    type CSSProperties,
} from "react";
import * as THREE from "three";
import {
    type PetVisualQualityConfig,
} from "../../lib/pet-visual-quality";
import {
    Sparkles,
    Html,
} from "@react-three/drei";

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
    let minorCount = 0;
    const minorLimit = quality.id === "high" ? 9 : 5;
    for (let sourceIndex = events.length - 1; sourceIndex >= 0; sourceIndex -= 1) {
        const event = events[sourceIndex];
        if (event.t > displayTick) continue;
        if (event.t < oldestVisibleTick) break;
        const major = event.type === "towerfractured" || event.type === "towerdown" || event.type === "wardenslam" || event.type === "wardensummon"
            || event.type === "ultimate" || event.type === "hazard" || event.type === "lastward" || event.type === "riftrally";
        if (!major && minorCount++ >= minorLimit) continue;
        visible.push({ event, sourceIndex });
    }
    return visible.map(({ event, sourceIndex }) => (
        <EventPulse key={`${event.t}-${event.type}-${sourceIndex}`} event={event} snapshot={snapshot} displayTick={displayTick} quality={quality} />
    ));
}

export {
    WarfrontEventLayer,
};
