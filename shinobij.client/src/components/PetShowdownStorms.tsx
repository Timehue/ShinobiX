import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { VfxBeat, VfxPositions } from "./PetShowdownVfx";
import type { PetVisualQualityConfig } from "../lib/pet-visual-quality";
import { showdownAttackRhythm, showdownCastRelease } from "../lib/pet-showdown-choreography";
import { showdownBeatProgress } from "../lib/showdown-playback";
import { showdownActionTargetId } from "../lib/showdown-contact-vfx";
import { showdownTechniqueHitIds, techniqueEnvelope } from "../lib/showdown-move-presentation";
import { surface, fissures, boltGeometry, vortexRibbon } from "../lib/showdown-technique-geometry";

// Advected, broken fog avoids the clean horizontal rings of the cyclone
// shader: a blizzard needs turbulent sheets and gaps around visible bodies.
function stormMist() {
    const material = surface(3);
    material.fragmentShader = `uniform float uTime,uOpacity,uElement;uniform vec3 uTint;
varying vec2 vUv;varying vec3 vNormal,vView;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
void main(){vec2 p=vec2(vUv.x*9.-uTime*.7,vUv.y*7.+uTime*.15);float n=noise(p)*.6+noise(p*2.1)*.4;
float streak=noise(vec2(vUv.x*3.-uTime,vUv.y*25.+n*3.));float edge=smoothstep(0.,.15,vUv.y)*smoothstep(0.,.2,1.-vUv.y)*smoothstep(0.,.18,vUv.x)*smoothstep(0.,.18,1.-vUv.x);
float a=smoothstep(.4,.76,n*.7+streak*.3)*edge*.64*uOpacity*abs(dot(normalize(vNormal),normalize(vView)));
vec3 col=mix(uTint,vec3(.87,.97,1.),n*.7);
if(uElement<.5)col=mix(vec3(.12,.07,.065),uTint,n*.22);
if(uElement>2.5&&uElement<3.5)col=mix(uTint,vec3(.48,.35,.23),n*.6);
gl_FragColor=vec4(col,a);if(a<.008)discard;}`;
    return material;
}

// Three reusable stations share geometry/materials. Fragments are pooled across
// the formation; quality settings reduce detail without losing the main shape.
function resources(count: number) {
    const root = new THREE.Group();
    const mist = stormMist(), halo = surface(4), gustMaterial = stormMist();
    const flame = surface(0), wind = surface(2), funnelMaterial = surface(3);
    const stone = new THREE.MeshStandardMaterial({ color: "#82664f", roughness: .94, flatShading: true, transparent: true });
    const fault = new THREE.MeshBasicMaterial({ color: "#170f09", transparent: true, depthWrite: false, side: THREE.DoubleSide });
    halo.blending = THREE.AdditiveBlending;
    const ice = new THREE.MeshStandardMaterial({ color: "#bceefb", emissive: "#46778b", emissiveIntensity: .6, roughness: .25, metalness: .15, transparent: true, flatShading: true });
    const core = new THREE.MeshBasicMaterial({ color: "#e0f7ff", transparent: true, depthWrite: false, toneMapped: false });
    const frost = new THREE.MeshBasicMaterial({ color: "#a8eaff", transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const cloudGeometry = new THREE.SphereGeometry(1, 24, 12);
    const mistGeometry = new THREE.PlaneGeometry(5.2, 3.8);
    const ringGeometry = new THREE.RingGeometry(.93, 1, 64);
    const frostGeometry = fissures(.8);
    const faultGeometry = fissures(2.5), helixGeometry = vortexRibbon();
    const flameGeometry = new THREE.CylinderGeometry(.12, 1.15, 5.8, 24, 16, true);
    const funnelGeometry = new THREE.CylinderGeometry(2.3, .3, 6.4, 32, 16, true);
    const bolts = [0, 1, 2].map(i => boltGeometry(i));
    const halos = [0, 1, 2].map(i => boltGeometry(i, true));
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D) => { const object = new THREE.Mesh(g, m); parent.add(object); return object; };
    const stations = Array.from({ length: 3 }, () => {
        const group = new THREE.Group(); root.add(group);
        const cloud = mesh(cloudGeometry, mist, group);
        const veil = mesh(mistGeometry, mist, group);
        const ground = mesh(frostGeometry, frost, group);
        const cracks = mesh(faultGeometry, fault, group); cracks.position.y = -.01;
        const flames = [0, 1, 2].map(() => mesh(flameGeometry, flame, group));
        const ribbons = [0, 1].map(() => mesh(helixGeometry, wind, group));
        const funnel = mesh(funnelGeometry, funnelMaterial, group); funnel.position.y = 3.2;
        const ring = mesh(ringGeometry, frost, group); ring.rotation.x = -Math.PI / 2;
        const strikes = bolts.map(g => mesh(g, core, group));
        const glows = halos.map(g => mesh(g, halo, group));
        return { group, cloud, veil, ground, cracks, flames, ribbons, funnel, ring, strikes, glows };
    });
    const gust = mesh(new THREE.CylinderGeometry(3.6, .28, 1, 32, 12, true), gustMaterial, root);
    const shards = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), ice, count);
    shards.frustumCulled = false; root.add(shards);
    const debris = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), stone, count);
    debris.frustumCulled = false; root.add(debris);
    const flakeGeometry = new THREE.BufferGeometry();
    flakeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(count * 3 * 3), 3));
    const flakeMaterial = new THREE.ShaderMaterial({ uniforms: { opacity: { value: 0 }, tint: { value: new THREE.Color() } },
        vertexShader: `void main(){vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(65./max(1.,-p.z),2.,7.);}`,
        fragmentShader: `uniform float opacity;uniform vec3 tint;void main(){vec2 p=gl_PointCoord-.5;float a=1.-smoothstep(.1,.5,length(p));gl_FragColor=vec4(tint,a*opacity);}`,
        transparent: true, depthWrite: false, toneMapped: false });
    const flakes = new THREE.Points(flakeGeometry, flakeMaterial); flakes.frustumCulled = false; root.add(flakes);
    const lamp = new THREE.PointLight("#8ddcff", 0, 18, 2); root.add(lamp);
    root.visible = false;
    return { root, stations, gust, shards, debris, flakes, lamp, mist, halo, gustMaterial, flame, wind, funnelMaterial, stone, fault, ice, core, frost, flakeMaterial, dummy: new THREE.Object3D(), count };
}

export function PetShowdownStorms({ beatRef, posRef, quality, reducedMotion }: {
    beatRef: React.MutableRefObject<VfxBeat>;
    posRef: React.MutableRefObject<VfxPositions>;
    quality: PetVisualQualityConfig;
    reducedMotion: boolean;
}) {
    const pool = useMemo(() => resources(Math.min(108, quality.setPieceParticles * 3)), [quality.setPieceParticles]);
    const refs = useRef(pool);
    useEffect(() => { refs.current = pool; return () => {
        const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
        pool.root.traverse(object => {
            if (object instanceof THREE.InstancedMesh) object.dispose();
            if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
                geometries.add(object.geometry);
                for (const m of Array.isArray(object.material) ? object.material : [object.material]) materials.add(m);
            }
        });
        geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
    }; }, [pool]);
    const anchors = useRef({ at: -1, caster: [0, 0, 0] as readonly number[], aim: [0, 0, 0] as readonly number[], hits: [] as (readonly number[])[] });
    useFrame(() => {
        const r = refs.current;
        r.root.visible = false;
        const beat = beatRef.current, ev = beat.event;
        if (!beat.presentation?.area || ev?.t !== "action") return;
        const snow = ev.element === "Water";
        const fire = ev.element === "Fire", earth = ev.element === "Earth", wind = ev.element === "Wind", thunder = ev.element === "Lightning";
        const element = ["Fire", "Water", "Wind", "Earth", "Lightning"].indexOf(ev.element);
        const tint = snow ? "#9bdbf3" : fire ? "#f89432" : earth ? "#b69a73" : wind ? "#a4dfb2" : "#4976bd";
        const rhythm = showdownAttackRhythm({ weight: ev.weight, superMove: ev.super, delivery: ev.delivery, moveKind: ev.moveKind });
        const p = showdownBeatProgress(beat, performance.now()), release = showdownCastRelease(rhythm);
        const end = Math.min(.97, rhythm.contact + .36);
        if (p < release || p >= end) return;
        if (anchors.current.at !== beat.startedAt) {
            const hits = showdownTechniqueHitIds(beat.presentation, ev).map(id => posRef.current.get(id)).filter((v): v is [number, number, number] => !!v).slice(0, 3);
            const caster = posRef.current.get(ev.actorId), targetId = showdownActionTargetId(ev);
            const aim = (targetId ? posRef.current.get(targetId) : undefined) ?? hits[0];
            if (!caster || !aim) return;
            anchors.current = { at: beat.startedAt, caster: [...caster], aim: [...aim], hits: hits.map(v => [...v]) };
        }
        const a = anchors.current, after = (p - rhythm.contact) / (end - rhythm.contact);
        const travel = Math.min(1, Math.max(0, (p - release) / (rhythm.contact - release)));
        if (after >= 0 && !a.hits.length) return;
        const impact = after >= 0 ? techniqueEnvelope(after) : 0;
        const age = (p - release) / (end - release), motion = reducedMotion ? .4 : age;
        r.root.visible = true;
        for (const material of [r.mist, r.halo, r.gustMaterial, r.flame, r.wind, r.funnelMaterial]) {
            material.uniforms.uElement.value = element;
            material.uniforms.uTint.value.set(tint);
            material.uniforms.uTime.value = motion * 5;
            material.uniforms.uOpacity.value = impact;
        }
        // A cold front rolls out of the planted caster. It opens into falling
        // ice over the enemy formation instead of dragging the creature there.
        const dx = a.aim[0] - a.caster[0], dz = a.aim[2] - a.caster[2], length = Math.hypot(dx, dz) || 1;
        const reach = reducedMotion ? 1 : travel;
        r.gust.visible = snow && after < .3;
        r.gust.position.set(a.caster[0] + dx * reach * .5, 1.45, a.caster[2] + dz * reach * .5);
        r.gust.rotation.set(Math.PI / 2, 0, -Math.atan2(dx, dz));
        r.gust.scale.set(1, Math.max(.01, length * reach), 1);
        r.gustMaterial.uniforms.uOpacity.value = Math.sin(travel * Math.PI * .7) * (after < 0 ? 1.5 : Math.max(0, 1 - after / .3));
        r.mist.uniforms.uOpacity.value = impact * (snow ? 1.65 : .7);
        r.flame.uniforms.uOpacity.value = impact * 1.6;
        r.wind.uniforms.uOpacity.value = impact * .85;
        r.funnelMaterial.uniforms.uOpacity.value = impact * 1.6;
        r.core.opacity = impact * .95;
        r.halo.uniforms.uOpacity.value = impact * 1.15;
        r.frost.opacity = impact * (snow ? .7 : earth ? .5 : .9);
        r.frost.color.set(earth ? "#8c6140" : "#a8eaff");
        r.fault.opacity = impact;
        r.stone.opacity = impact;
        r.stone.color.set(fire ? "#883211" : wind ? "#629345" : "#82664f");
        r.stone.emissive.set(fire ? "#ed590e" : "#000000");
        r.stone.emissiveIntensity = fire ? 1.8 : 0;
        const rise = reducedMotion ? .85 : Math.min(1, Math.max(0, after) * 5);
        const hits = a.hits;
        r.stations.forEach((s, i) => {
            const at = hits[i]; s.group.visible = !!at && after >= 0;
            if (!at) return;
            s.group.position.set(at[0], .055, at[2]);
            s.cloud.visible = !wind;
            s.cloud.position.set(0, snow ? 4.4 : thunder ? 7.6 : fire ? 5.2 : earth ? 1 : 3, 0);
            s.cloud.scale.set(snow ? 3.3 : 3.1, snow ? 1.1 : fire ? 1.4 : earth ? 1 : .6, 2.6);
            s.cloud.rotation.y = motion * -.8 + i;
            s.veil.visible = snow;
            s.veil.position.y = 1.9;
            s.veil.rotation.set(0, Math.atan2(a.caster[0] - at[0], a.caster[2] - at[2]), -.15);
            s.ground.visible = snow || earth;
            s.ground.scale.setScalar((earth ? 1.5 : 1) * (reducedMotion ? .9 : Math.min(1, Math.max(0, after) * 4)));
            s.cracks.visible = earth; s.cracks.scale.copy(s.ground.scale);
            s.flames.forEach((flame, j) => {
                flame.visible = fire;
                const angle = j * 2.1 + i;
                flame.position.set(Math.cos(angle) * .95, 2.8 * rise, Math.sin(angle) * .95);
                flame.rotation.set(Math.sin(angle) * .14, angle, Math.cos(angle) * .14);
                flame.scale.set(.95 + j * .08, rise * (1 + j * .12), .95 + j * .08);
            });
            s.funnel.visible = wind; s.funnel.scale.y = rise; s.funnel.position.y = 3.2 * rise;
            s.funnel.rotation.y = motion * 4 + i;
            s.ribbons.forEach((ribbon, j) => {
                ribbon.visible = wind;
                ribbon.rotation.y = motion * 5 + i + j * Math.PI;
                ribbon.scale.set(1, rise, 1);
            });
            s.ring.visible = thunder;
            s.ring.scale.setScalar(reducedMotion ? 2.2 : 1 + Math.max(0, after) * 3.5);
            s.strikes.forEach((strike, j) => {
                strike.visible = thunder;
                // One sustained discharge, with large off-axis forks. Every
                // struck enemy gets a sky connection, never just a floor ring.
                strike.scale.set(j ? 1.45 : 1.15, j ? 1.85 : 1.2, j ? 1.45 : 1.15);
                strike.rotation.y = i * 1.8 + j;
                const glow = s.glows[j]; glow.visible = thunder && j < quality.translucentLayers;
                glow.scale.copy(strike.scale); glow.quaternion.copy(strike.quaternion);
            });
        });
        r.shards.visible = snow && after >= 0 && hits.length > 0;
        r.ice.opacity = impact;
        const count = reducedMotion ? Math.min(r.count, hits.length * 6) : r.count;
        r.shards.count = count;
        for (let i = 0; snow && i < count && hits.length; i++) {
            const at = hits[i % hits.length], angle = i * 2.399;
            const cycle = reducedMotion ? (i * .137) % 1 : (Math.max(0, after) * 2.1 + i * .137) % 1;
            const radius = .6 + (i % 7) * .27;
            r.dummy.position.set(at[0] + Math.cos(angle) * radius + (cycle - .5) * 1.6, .2 + (1 - cycle) * 4.4, at[2] + Math.sin(angle) * radius);
            r.dummy.rotation.set(-.7, angle, .65);
            const size = .07 + (i % 4) * .025;
            r.dummy.scale.set(size, size * 3.6, size);
            r.dummy.updateMatrix(); r.shards.setMatrixAt(i, r.dummy.matrix);
        }
        r.shards.instanceMatrix.needsUpdate = true;
        r.debris.visible = !snow && !thunder && after >= 0;
        r.debris.count = earth ? Math.min(count, hits.length * 18) : count;
        for (let i = 0; r.debris.visible && i < r.debris.count && hits.length; i++) {
            const at = hits[i % hits.length], local = Math.floor(i / hits.length);
            const cycle = reducedMotion ? .45 : (Math.max(0, after) * 1.4 + i * .137) % 1;
            const angle = i * 2.399 + (wind ? motion * 6 : 0);
            const slab = earth && local < 6;
            const radius = earth ? 1.1 + (local % 3) * .55 : wind ? .3 + cycle * 2.1 : .5 + (i % 6) * .3;
            const lift = reducedMotion ? .6 : Math.sin(Math.max(0, after) * Math.PI);
            const height = earth ? -.3 + rise * .5 + lift * (slab ? 1.1 : 2.6) : wind ? cycle * 6.3 : (1 - cycle) * 6;
            r.dummy.position.set(at[0] + Math.cos(angle) * radius, height, at[2] + Math.sin(angle) * radius);
            r.dummy.rotation.set(earth ? Math.cos(angle) * lift * .4 : cycle * 4, angle, earth ? Math.sin(angle) * lift * .45 : i);
            const size = earth ? slab ? .6 + (local % 3) * .16 : .16 + (local % 4) * .06 : fire ? .05 + (i % 4) * .025 : .045;
            r.dummy.scale.set(size * (earth ? 1.9 : wind ? 2.5 : 1), size * (slab ? .6 : wind ? .25 : 1.8), size * (slab ? 1.3 : 1));
            r.dummy.updateMatrix(); r.debris.setMatrixAt(i, r.dummy.matrix);
        }
        r.debris.instanceMatrix.needsUpdate = true;
        r.flakes.visible = !thunder && !reducedMotion && after >= 0;
        const positions = r.flakes.geometry.getAttribute("position") as THREE.BufferAttribute;
        for (let i = 0; r.flakes.visible && i < positions.count && hits.length; i++) {
            const at = hits[i % hits.length], cycle = (Math.max(0, after) * 1.8 + i * .618) % 1;
            const angle = i * 2.399 + (wind ? motion * 7 : 0), radius = wind ? .3 + cycle * 2.1 : .3 + (i % 11) * .22;
            positions.setXYZ(i, at[0] + Math.cos(angle) * radius + (snow ? (cycle - .5) * 2 : 0),
                .3 + (snow ? (1 - cycle) * 4.7 : earth ? Math.sin(cycle * Math.PI) * .9 : cycle * 6.4), at[2] + Math.sin(angle) * radius);
        }
        positions.needsUpdate = true;
        r.flakeMaterial.uniforms.opacity.value = impact * .9;
        if (snow) r.flakeMaterial.uniforms.tint.value.setRGB(.8, .95, 1);
        else r.flakeMaterial.uniforms.tint.value.set(tint);
        r.lamp.position.set(a.aim[0], 3.8, a.aim[2]);
        r.lamp.color.set(snow || thunder ? "#8ddcff" : tint);
        r.lamp.intensity = quality.dynamicPetLight && !reducedMotion ? impact * (snow ? 11 : thunder ? 24 : fire ? 18 : 6) : 0;
    });
    return <primitive object={pool.root} dispose={null} />;
}
