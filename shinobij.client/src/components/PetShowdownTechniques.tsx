import { surface, fissures, boltGeometry } from '../lib/showdown-technique-geometry';
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { VfxBeat, VfxPositions } from "./PetShowdownVfx";
import type { PetVisualQualityConfig } from "../lib/pet-visual-quality";
import { showdownAttackRhythm, showdownCastRelease } from "../lib/pet-showdown-choreography";
import { showdownBeatProgress } from "../lib/showdown-playback";
import { showdownActionTargetId, showdownContactEffectKind, showdownProjectilePath } from "../lib/showdown-contact-vfx";
import { techniquePhase } from "../lib/showdown-move-presentation";
import { vfxElementTint } from "../lib/showdown-vfx-map";

// Continuous surfaces, actual ice/stone fragments and forked bolts carry the
// primary shape. No opaque billboard borders, texture downloads or frame-time
// React spawns. One bounded resource set is reused throughout the battle.
function createResources(count: number) {
    const root = new THREE.Group(), lane = new THREE.Group(), impact = new THREE.Group();
    root.add(lane, impact);
    const flow = surface(0), shell = surface(1), ribbon = surface(2), mist = surface(3), electric = surface(4);
    electric.blending = THREE.AdditiveBlending;
    const stone = new THREE.MeshStandardMaterial({ color: "#795742", roughness: .94, flatShading: true, transparent: true });
    const ice = new THREE.MeshStandardMaterial({ color: "#a2e7fa", emissive: "#26698c", emissiveIntensity: .28, metalness: .12, roughness: .24, flatShading: true, transparent: true });
    const light = new THREE.MeshBasicMaterial({ color: "#ffe8a1", transparent: true, depthWrite: false, toneMapped: false });
    const dark = new THREE.MeshBasicMaterial({ color: "#231709", transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Group) => { const result = new THREE.Mesh(g, m); parent.add(result); return result; };
    const jet = mesh(new THREE.CylinderGeometry(.8, .17, 1, 24, 12, true), flow, lane);
    jet.rotation.x = Math.PI / 2;
    const tongues = [0, 1].map(() => mesh(jet.geometry, flow, lane));
    const orb = mesh(new THREE.IcosahedronGeometry(.58, 2), shell, lane);
    const rock = mesh(new THREE.DodecahedronGeometry(.62, 0), stone, lane);
    const blades = [0, 1].map(() => mesh(new THREE.RingGeometry(.82, 1.08, 40, 1, 0, Math.PI * 1.55), ribbon, lane));
    const wake = mesh(blades[0].geometry, mist, lane);
    const funnel = mesh(new THREE.CylinderGeometry(2.05, .5, 3.8, 32, 14, true), mist, impact);
    const column = mesh(new THREE.CylinderGeometry(.25, 1.15, 3.8, 24, 12, true), flow, impact);
    const cracks = mesh(fissures(1.6), dark, impact);
    const seamMaterial = new THREE.MeshBasicMaterial({ color: "#d99042", transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const seams = mesh(fissures(.3), seamMaterial, impact);
    seams.position.y = .008;
    const rim = mesh(new THREE.RingGeometry(.91, 1, 64), ribbon, impact);
    rim.rotation.x = -Math.PI / 2;
    const bolts = [0, 1, 2].map(i => mesh(boltGeometry(i), light, impact));
    const boltHalos = [0, 1, 2].map(i => mesh(boltGeometry(i, true), electric, impact));
    const shards = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), ice, count);
    const rubble = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), stone, count);
    shards.frustumCulled = rubble.frustumCulled = false;
    impact.add(shards, rubble);
    const pointsGeometry = new THREE.BufferGeometry();
    pointsGeometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
    const pointsMaterial = new THREE.ShaderMaterial({
        uniforms: { uOpacity: { value: 0 }, uTint: { value: new THREE.Color() }, uSize: { value: 5 } },
        vertexShader: `uniform float uSize; void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=uSize;}`,
        fragmentShader: `uniform float uOpacity;uniform vec3 uTint;void main(){float a=1.-smoothstep(.05,.5,length(gl_PointCoord-.5));gl_FragColor=vec4(uTint,a*uOpacity);}`,
        transparent: true, depthWrite: false, toneMapped: false,
    });
    const particles = new THREE.Points(pointsGeometry, pointsMaterial);
    particles.frustumCulled = false;
    root.add(particles);
    const lamp = new THREE.PointLight("#ffffff", 0, 8, 2);
    impact.add(lamp);
    root.visible = false;
    return { root, lane, impact, jet, tongues, orb, rock, blades, wake, funnel, column, cracks, seams, rim, bolts, boltHalos, shards, rubble, particles, lamp,
        flow, shell, ribbon, mist, electric, stone, ice, light, dark, seamMaterial, pointsMaterial, dummy: new THREE.Object3D(), count };
}

export function PetShowdownTechniques({ beatRef, posRef, radii, quality, reducedMotion }: {
    beatRef: React.MutableRefObject<VfxBeat>;
    posRef: React.MutableRefObject<VfxPositions>;
    radii: ReadonlyMap<string, number>;
    quality: PetVisualQualityConfig;
    reducedMotion: boolean;
}) {
    const resources = useMemo(() => createResources(Math.min(36, quality.setPieceParticles)), [quality.setPieceParticles]);
    const refs = useRef(resources);
    useEffect(() => { refs.current = resources; return () => {
        const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
        resources.root.traverse(object => {
            if (object instanceof THREE.InstancedMesh) object.dispose();
            if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
                geometries.add(object.geometry);
                for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
            }
        });
        geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
    }; }, [resources]);
    const anchor = useRef({ at: -1, fromX: 0, fromZ: 0, toX: 0, toZ: 0, targetX: 0, targetZ: 0 });
    useFrame(() => {
        const r = refs.current, beat = beatRef.current, ev = beat.event, hero = beat.presentation?.hero;
        r.root.visible = false;
        if (!hero || beat.presentation?.area || ev?.t !== "action") return;
        const targetId = showdownActionTargetId(ev);
        const actor = posRef.current.get(ev.actorId), target = targetId ? posRef.current.get(targetId) : undefined;
        if (!actor || !target) return;
        const rhythm = showdownAttackRhythm({ weight: ev.weight, superMove: ev.super, delivery: ev.delivery, moveKind: ev.moveKind });
        const progress = showdownBeatProgress(beat, performance.now());
        const release = ev.delivery === "melee" ? rhythm.contact : showdownCastRelease(rhythm);
        const end = Math.min(.96, rhythm.contact + (ev.super ? .32 : .27));
        const contactKind = showdownContactEffectKind(ev.moveKind, ev.targets.find(t => t.id === targetId && !t.splash));
        const outcome = contactKind === null ? "miss" : contactKind === "protect" ? "block" : "hit";
        // Guard's partial damage keeps its elemental impact. Only a full block
        // or dodge prevents the victim effect; both retain the aimed approach.
        const phase = techniquePhase(progress, release, rhythm.contact, end, outcome);
        if (!phase) return;
        const { travel, after, hit, age, fade, impactFade } = phase;
        if (anchor.current.at !== beat.startedAt) {
            const path = showdownProjectilePath(actor[0], actor[2], target[0], target[2], radii.get(ev.actorId) ?? .82, radii.get(targetId!) ?? .82);
            anchor.current = { at: beat.startedAt, ...path, targetX: target[0], targetZ: target[2] };
        }
        const a = anchor.current;
        const dx = a.toX - a.fromX, dz = a.toZ - a.fromZ, distance = Math.hypot(dx, dz);
        const motion = reducedMotion ? .35 : age;
        const strength = ev.super ? 1.2 : 1;
        const tint = vfxElementTint(ev.element), element = ["Fire", "Water", "Wind", "Earth", "Lightning"].indexOf(ev.element);
        r.root.visible = true;
        r.lane.position.set(a.fromX, 1.1, a.fromZ);
        r.lane.rotation.y = Math.atan2(dx, dz);
        r.impact.position.set(a.targetX, .05, a.targetZ);
        r.impact.scale.setScalar(strength);
        for (const mat of [r.flow, r.shell, r.ribbon, r.mist, r.electric]) {
            mat.uniforms.uTime.value = motion * 3;
            mat.uniforms.uOpacity.value = fade;
            mat.uniforms.uElement.value = element;
            mat.uniforms.uTint.value.set(tint);
        }
        // Primary shapes survive Low and reduced motion. Only small fragments,
        // travel oscillation and extra lights drop out of those modes.
        const jet = hero === "jet", comet = hero === "comet", blade = hero === "blade", storm = hero === "storm", eruption = hero === "eruption";
        r.jet.visible = jet && ev.element !== "Lightning";
        const reach = reducedMotion ? 1 : travel;
        const width = ev.element === "Fire" ? .9 : ev.element === "Water" ? .9 : .62;
        r.jet.position.z = distance * reach * .5;
        r.jet.scale.set(width * strength, Math.max(.01, distance * reach), width * strength);
        r.tongues.forEach((tongue, i) => {
            tongue.visible = jet && ev.element === "Fire";
            tongue.position.set((i ? -1 : 1) * .16, (i ? -.12 : .12), distance * reach * .48);
            tongue.rotation.set(Math.PI / 2, 0, (i ? -1 : 1) * .055);
            tongue.scale.set(.6, Math.max(.01, distance * reach * .94), .6);
        });
        r.orb.visible = comet && ev.element !== "Earth" && !hit;
        r.rock.visible = comet && ev.element === "Earth" && !hit;
        for (const head of [r.orb, r.rock]) {
            head.position.set(0, reducedMotion ? 0 : Math.sin(travel * Math.PI) * (ev.element === "Earth" ? 1.2 : .35), distance * travel);
            head.rotation.set(motion * 4, motion * 2, 0);
            head.scale.setScalar(strength * (ev.element === "Earth" ? 1.45 : 1));
        }
        r.blades.forEach((mesh, i) => {
            mesh.visible = blade;
            mesh.position.set((i ? -.16 : .16), .05, distance * travel);
            mesh.rotation.set(.3, i ? -.3 : .3, (i ? -1 : 1) * (motion * 1.8 + .4));
            mesh.scale.setScalar((.7 + (hit ? after : travel) * .55) * strength * (ev.element === "Wind" ? 1.45 : 1));
        });
        r.wake.visible = blade && ev.element === "Wind";
        r.wake.position.set(0, .1, distance * travel - .35);
        r.wake.rotation.set(.5, -.5, motion * -3);
        r.wake.scale.setScalar((1.2 + Math.max(0, after)) * strength);
        const quake = storm && ev.element === "Earth";
        const snow = storm && ev.element === "Water";
        const cyclone = storm && ev.element === "Wind";
        const thunder = storm && ev.element === "Lightning";
        const firestorm = storm && ev.element === "Fire";
        const rockburst = comet && ev.element === "Earth";
        const scorch = jet && ev.element === "Fire";
        r.funnel.visible = hit && (snow || cyclone);
        r.funnel.position.y = snow ? 1.1 : 1.8;
        r.funnel.scale.set(1, snow ? .6 : 1, 1);
        r.funnel.rotation.y = motion * (snow ? -2 : 3);
        r.mist.uniforms.uOpacity.value = r.wake.visible ? fade * 1.5 : impactFade * (snow ? .85 : 2.1);
        r.column.visible = hit && (firestorm || scorch || (eruption && ev.element !== "Earth"));
        const columnHeight = scorch ? .52 + Math.max(0, after) * .25 : .65 + Math.max(0, after) * .65;
        r.column.position.y = 1.8 * columnHeight;
        r.column.scale.set(1 + after * .2, columnHeight, 1 + after * .2);
        r.cracks.visible = hit && (quake || rockburst);
        r.cracks.scale.setScalar((rockburst ? .65 : 1) * (reducedMotion ? 1 : Math.min(1, Math.max(0, after) * 3.5)));
        r.seams.visible = r.cracks.visible;
        r.seams.scale.copy(r.cracks.scale);
        r.seamMaterial.opacity = impactFade * .7;
        r.dark.opacity = impactFade;
        r.rim.visible = hit && (jet || comet || quake || thunder || firestorm);
        r.rim.position.y = .02;
        const radius = reducedMotion ? 1.3 : .65 + Math.max(0, after) * (quake ? 3 : 1.7);
        r.rim.scale.setScalar(radius);
        r.bolts.forEach((mesh, i) => {
            mesh.visible = (thunder && hit) || (jet && ev.element === "Lightning");
            // Thunder descends vertically; an arc lance runs horizontally from
            // the caster's nozzle to the target surface, with forked side arcs.
            if (jet) {
                if (mesh.parent !== r.lane) r.lane.add(mesh);
                mesh.rotation.set(-Math.PI / 2, 0, 0);
                mesh.position.set(0, 0, distance * reach);
                mesh.scale.set(.6, Math.max(.01, distance * reach / 7), .6);
            } else {
                if (mesh.parent !== r.impact) r.impact.add(mesh);
                mesh.rotation.set(0, 0, 0); mesh.position.set(0, 0, 0); mesh.scale.setScalar(1);
            }
            const halo = r.boltHalos[i];
            if (halo.parent !== mesh.parent) mesh.parent!.add(halo);
            halo.visible = mesh.visible && i < quality.translucentLayers;
            halo.position.copy(mesh.position); halo.quaternion.copy(mesh.quaternion); halo.scale.copy(mesh.scale);
        });
        // One smooth discharge; no full-screen or repeated high-frequency flash.
        r.light.opacity = jet ? fade * .9 : impactFade * Math.exp(-Math.max(0, after) * 1.6);
        r.light.color.set(tint).lerp(r.ice.color, .7).multiplyScalar(1.6);
        r.electric.uniforms.uOpacity.value = r.light.opacity * .85;
        r.shards.visible = hit && snow;
        r.rubble.visible = hit && (quake || eruption || firestorm || rockburst);
        r.ice.opacity = impactFade;
        r.stone.opacity = comet ? fade : impactFade;
        r.stone.color.set(firestorm ? "#a73516" : "#795742");
        r.stone.emissive.set(firestorm ? "#b64208" : "#000000");
        r.stone.emissiveIntensity = firestorm ? .7 : 0;
        const count = reducedMotion ? 5 : Math.min(r.count, snow ? 28 : quality.impactDebris * 2);
        r.shards.count = r.rubble.count = count;
        for (let i = 0; i < count; i++) {
            const angle = i * 2.399 + (snow ? motion * -5 : 0), ring = (.6 + (i % 5) * .33) * (rockburst ? .5 + Math.max(0, after) : 1);
            const cycle = reducedMotion ? .45 : (Math.max(0, after) * (snow ? 2.4 : 1) + i * .137) % 1;
            const rise = eruption ? Math.sin(Math.min(1, Math.max(0, after) * 1.4) * Math.PI) : Math.sin(Math.max(0, after) * Math.PI);
            r.dummy.position.set(Math.cos(angle) * ring, snow ? .25 + (1 - cycle) * 2.3 : firestorm ? (1 - cycle) * 5 : .03 + rise * (eruption ? 1.3 : rockburst ? 1.7 : .22), Math.sin(angle) * ring);
            r.dummy.rotation.set(snow ? -.5 : i, angle, snow ? .5 : i * .7);
            const size = snow ? .08 + (i % 3) * .025 : .15 + (i % 4) * .07;
            r.dummy.scale.set(size * (quake ? 2 : 1), size * (snow ? 3.5 : eruption ? 5 : quake ? .45 : 1.2), size * (quake ? 1.7 : 1));
            r.dummy.updateMatrix(); r.shards.setMatrixAt(i, r.dummy.matrix); r.rubble.setMatrixAt(i, r.dummy.matrix);
        }
        r.shards.instanceMatrix.needsUpdate = r.rubble.instanceMatrix.needsUpdate = true;
        r.particles.visible = !reducedMotion;
        const positions = r.particles.geometry.getAttribute("position") as THREE.BufferAttribute;
        for (let i = 0; i < r.count; i++) {
            const t = (motion * 2 + i * .618) % 1, angle = i * 2.399;
            const spread = hit ? .4 + t * (snow || quake ? 2.5 : 1.7) : .13 + t * .35;
            const p = hit ? 1 : travel * t;
            positions.setXYZ(i, a.fromX + dx * p + Math.cos(angle) * spread,
                hit ? .15 + (firestorm ? t * 3 : snow ? (1 - t) * 2.5 : Math.sin(t * Math.PI) * 1.2) : 1.1 + Math.sin(angle) * spread,
                a.fromZ + dz * p + Math.sin(angle) * spread);
        }
        positions.needsUpdate = true;
        r.pointsMaterial.uniforms.uTint.value.set(snow ? "#d9f4ff" : tint);
        r.pointsMaterial.uniforms.uOpacity.value = hit ? impactFade * .7 : fade * .65;
        r.lamp.color.set(tint);
        r.lamp.position.y = 1.4;
        r.lamp.intensity = quality.dynamicPetLight && !reducedMotion ? impactFade * (ev.super ? 9 : 4) : 0;
    });
    return <primitive object={resources.root} dispose={null} />;
}
