/*
 * ── Hollow Warfront — the lane-war match renderer + shell ────────────────────
 * Plays a pet-warfront-sim match as a true-3D MOBA broadcast on the themed
 * battlefield: GLB pets on the walkmask floor, Guardian Totems + Ward Seals,
 * the Hollow Gate breach with its Gate Warden and hollow-spawn, two Lesser
 * Wardens, a follow camera + corner PiP chase cam, a canvas minimap, and the
 * 30-second WAR COUNCIL buy popup (or silent auto-buy when a policy is set).
 *
 * The sim is chunked and interactive: the shell advances one 30 s round at a
 * time, pausing at each boundary for the player's powerup spending. With an
 * auto-buy policy the match is a pure function of (teams, seed, policies) — the
 * shape shared co-op replays will use. Rendering never feeds the sim.
 */
import { Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, Html, Sparkles, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { Pet } from "../types/pet";
import type { ArenaSlot } from "../lib/pet-arena-sim";
import {
    startWarfrontMatch, wfVerdictScore, WARFRONT_TPS, WF_MAX_SECONDS, WF_POWERUPS, WF_STACK_CAP, WF_STANCES,
    type WarfrontChoice, type WarfrontResult, type WfBuyPolicy, type WfSnapshot, type WfStance, type WfDoctrine,
} from "../lib/pet-warfront-sim";
import {
    WF_MASK, WF_COLS, WF_ROWS, WF_X, WF_Y, WF_BUSHES, WF_CELL_X, WF_CELL_Y, WF_LAIR, WF_LANES, WF_MINI_NAMES, WF_PADS, WF_SPAWNS, WF_THEMES,
    wfCellWalkable, wfInsideField, wfLaneDistance,
    type WfTheme,
} from "../lib/pet-warfront-map";
import { walkTilesFromMask, arenaCameraDist, arenaModelHeight, arenaModelMotion, A3D_FOV, A3D_PITCH } from "../lib/pet-arena-3d";
import { radialTexture3d, Fx3D, Shot3D, Floater3D } from "./PetArena3DStage";
import { petCombatModel, type PetCombatModelConfig } from "../lib/pet-3d-models";
import { DEFAULT_PET_MODEL_FRAME, PetModel3D, type PetModelFrame } from "./PetModel3D";
import { petVisualQuality } from "../lib/pet-visual-quality";
import { projectileVisual, type ProjectileVisual } from "../lib/pet-projectile-vfx";
import { bundledJutsuFxFrames } from "../lib/jutsu-fx-assets";
import { elementVfxKey } from "../lib/pet-battle-anim";
import { lerp } from "../lib/pet-coliseum-scene";

const GROUND_TEX_URL = new URL("../assets/warfront/warfront-ground.png", import.meta.url).href;
let _groundTex: THREE.Texture | null = null;
function groundTexture(): THREE.Texture {
    if (_groundTex) return _groundTex;
    const t = new THREE.TextureLoader().load(GROUND_TEX_URL);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 8;
    _groundTex = t;
    return t;
}
const GATE_WARDEN_GLB = "/pet-models/gate-warden.glb";   // fal-generated from the Warden's own art
// Hand-painted foliage atlas (fal flux → birefnet cutouts): 2×2 tiles —
// 0 ancient pine · 1 tall autumn pine · 2 jade spirit tree · 3 broadleaf.
const FOLIAGE_URL = new URL("../assets/warfront/foliage-atlas.png", import.meta.url).href;
let _foliageTex: THREE.Texture | null = null;
function foliageTexture(): THREE.Texture {
    if (_foliageTex) return _foliageTex;
    const t = new THREE.TextureLoader().load(FOLIAGE_URL);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 8;
    _foliageTex = t;
    return t;
}
/** Crossed-plane "tree card" geometry (two quads at 90°, bottom-anchored),
 * UV-mapped to one tile of the foliage atlas. The industry-standard stylized
 * forest — and cheaper to draw than the old cone stacks. */
function treeCardGeometry(tile: number): THREE.BufferGeometry {
    const u0 = (tile % 2) * 0.5, v0 = tile < 2 ? 0.5 : 0;
    const geos: THREE.BufferGeometry[] = [];
    for (const rot of [0, Math.PI / 2]) {
        const g = new THREE.PlaneGeometry(1, 1);
        g.translate(0, 0.5, 0);
        g.rotateY(rot);
        const uv = g.getAttribute("uv") as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * 0.5, v0 + uv.getY(i) * 0.5);
        geos.push(g);
    }
    // Tiny manual merge (avoids pulling BufferGeometryUtils for two quads).
    const merged = new THREE.BufferGeometry();
    const pos: number[] = [], norm: number[] = [], uvs: number[] = [], idx: number[] = [];
    let base = 0;
    for (const g of geos) {
        const p = g.getAttribute("position"), n = g.getAttribute("normal"), u = g.getAttribute("uv");
        for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); norm.push(n.getX(i), n.getY(i), n.getZ(i)); uvs.push(u.getX(i), u.getY(i)); }
        const ix = g.getIndex()!;
        for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
        base += p.count;
        g.dispose();
    }
    merged.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    merged.setAttribute("normal", new THREE.Float32BufferAttribute(norm, 3));
    merged.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    merged.setIndex(idx);
    return merged;
}
const CLIFF_TEX_URL = new URL("../assets/warfront/warfront-cliff.png", import.meta.url).href;   // codex-painted mossy granite
let _cliffTex: THREE.Texture | null = null;
function cliffTexture(): THREE.Texture {
    if (_cliffTex) return _cliffTex;
    const t = new THREE.TextureLoader().load(CLIFF_TEX_URL);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    _cliffTex = t;
    return t;
}

type Vec3 = [number, number, number];
type Team = "blue" | "red";
// slow = seconds of remaining hit-stop (playback runs at quarter speed while
// it drains — pure presentation, the sim ticks underneath are untouched).
type WfClockRef = MutableRefObject<{ t: number; playing: boolean; slow: number }>;
// A director-ordered camera target: the broadcast cuts here until match-tick
// untilT (priority arbitrates simultaneous stories; kills < objectives).
type WfStoryCam = { x: number; z: number; untilT: number; span: number; prio: number };
// Spectator camera modes: broadcast = the auto-director with story cuts;
// calm = wide and steady, only the big objective cuts; team = locked to the
// player's squad. Dragging always enters free-cam on top of any of them.
type WfCamMode = "broadcast" | "calm" | "team";

const TEAM_COLOR: Record<Team, string> = { blue: "#3b82f6", red: "#ef4444" };
const TEAM_SOFT: Record<Team, string> = { blue: "#93c5fd", red: "#fca5a5" };
const ROLE_TAG: Record<string, string> = { defender: "DEF", tracker: "TRK", assassin: "ASN", sage: "SGE" };
const ELEMENT_TINT: Record<string, string> = { fire: "#fb923c", water: "#38bdf8", wind: "#86efac", lightning: "#fde047", earth: "#d3a05f" };
const tintOf = (el?: string | null) => ELEMENT_TINT[String(el ?? "").toLowerCase()] ?? "#a5f3fc";

let wfSeq = 0;   // cosmetic FX keys — module-scoped so spawn closures stay ref-free

const WARDEN_URLS = {
    idle: new URL("../assets/coliseum/warden-idle.webp", import.meta.url).href,
    walk: new URL("../assets/coliseum/warden-walk.webp", import.meta.url).href,
    windup: new URL("../assets/coliseum/warden-windup.webp", import.meta.url).href,
    slam: new URL("../assets/coliseum/warden-slam.webp", import.meta.url).href,
} as const;
type WardenFrameKey = keyof typeof WARDEN_URLS;
const _wardenTex: Partial<Record<WardenFrameKey, THREE.Texture>> = {};
function wardenTex(f: WardenFrameKey): THREE.Texture {
    const hit = _wardenTex[f]; if (hit) return hit;
    const t = new THREE.TextureLoader().load(WARDEN_URLS[f]);
    t.colorSpace = THREE.SRGBColorSpace;
    _wardenTex[f] = t;
    return t;
}

const snapAt = (result: WarfrontResult, clock: WfClockRef): WfSnapshot => {
    const snaps = result.snapshots;
    return snaps[Math.max(0, Math.min(snaps.length - 1, Math.floor(clock.current.t)))];
};

// ── Floor + set dressing ─────────────────────────────────────────────────────
function WfFloor({ theme }: { theme: WfTheme }) {
    const spec = WF_THEMES[theme];
    const tiles = useMemo(() => walkTilesFromMask(WF_MASK, WF_COLS, WF_ROWS, WF_X, WF_Y), []);
    const instMesh = useMemo(() => {
        const geo = new THREE.BoxGeometry((WF_X * 2 / WF_COLS) * 0.995, 0.22, (WF_Y * 2 / WF_ROWS) * 0.99);
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.04, map: groundTexture() });
        // Sample the painted flagstones by WORLD position — one continuous
        // hand-painted ground across all instanced tiles instead of a repeat
        // per 0.4-unit box face.
        mat.onBeforeCompile = (s) => {
            s.vertexShader = s.vertexShader
                .replace("#include <common>", "#include <common>\nvarying vec3 vWfWorld;")
                .replace("#include <begin_vertex>", "#include <begin_vertex>\n{ vec4 wfw = instanceMatrix * vec4(position, 1.0); vWfWorld = (modelMatrix * wfw).xyz; }");
            s.fragmentShader = s.fragmentShader
                .replace("#include <common>", "#include <common>\nvarying vec3 vWfWorld;")
                .replace("#include <map_fragment>", "{ vec2 wfUv = vec2((vWfWorld.x + 44.0) / 88.0, 1.0 - (vWfWorld.z + 24.0) / 48.0); vec4 sampledDiffuseColor = texture2D( map, wfUv ); diffuseColor *= sampledDiffuseColor; }");
        };
        const m = new THREE.InstancedMesh(geo, mat, tiles.length);
        const mat4 = new THREE.Matrix4();
        const col = new THREE.Color();
        tiles.forEach((t, i) => {
            mat4.makeTranslation(t.x, -0.11 - (t.edge ? 0.02 : 0), t.z);
            m.setMatrixAt(i, mat4);
            col.setHSL(spec.tileHue, 0.05, 0.66 + t.shade * 0.3);   // near-neutral: the painted map is authoritative
            m.setColorAt(i, col);
        });
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        m.receiveShadow = true;
        return m;
    }, [tiles, spec]);
    // Cliff skirts: edge tiles extrude downward so the paths read as real ledges
    // floating over the chasm instead of paper-thin planks.
    const skirtMesh = useMemo(() => {
        const edges = tiles.filter((t) => t.edge);
        const geo = new THREE.BoxGeometry((WF_X * 2 / WF_COLS) * 0.998, 1.7, (WF_Y * 2 / WF_ROWS) * 0.995);
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.98, metalness: 0.02 });
        const m = new THREE.InstancedMesh(geo, mat, edges.length);
        const mat4 = new THREE.Matrix4();
        const col = new THREE.Color();
        edges.forEach((t, i) => {
            mat4.makeTranslation(t.x, -1.06, t.z);
            m.setMatrixAt(i, mat4);
            col.setHSL(spec.tileHue, spec.tileSat * 0.8, Math.max(0.02, (spec.tileLight - 0.06) * 0.55 + t.shade * 0.1));
            m.setColorAt(i, col);
        });
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        return m;
    }, [tiles, spec]);
    useEffect(() => () => {
        instMesh.geometry.dispose();
        (instMesh.material as THREE.Material).dispose();
        instMesh.dispose();
        skirtMesh.geometry.dispose();
        (skirtMesh.material as THREE.Material).dispose();
        skirtMesh.dispose();
    }, [instMesh, skirtMesh]);
    const wallMesh = useMemo(() => {
        const cells: Array<{ x: number; z: number; h: number; shade: number }> = [];
        for (let r = 0; r < WF_ROWS; r++) {
            for (let c = 0; c < WF_COLS; c++) {
                const x = (c + 0.5) * (WF_X * 2 / WF_COLS) - WF_X, z = (r + 0.5) * (WF_Y * 2 / WF_ROWS) - WF_Y;
                if (wfCellWalkable(c, r) || !wfInsideField(x, z)) continue;
                if (Math.hypot(x - WF_LAIR.x, z - WF_LAIR.y) <= WF_LAIR.pitR + 0.6) continue;   // the arena pit is a HOLE, not a rock tower
                const hsh = ((c * 51721) ^ (r * 88301)) >>> 0;
                // SMOOTH mesa heights — neighbours share a low-frequency swell, so
                // the jungle reads as carved rock formations, not random steps.
                const swell = (Math.sin(x * 0.31) + Math.cos(z * 0.43) + Math.sin((x + z) * 0.19)) / 3;
                cells.push({ x, z, h: 1.6 + swell * 0.55 + ((hsh % 23) / 23) * 0.12, shade: (hsh % 89) / 89 });
            }
        }
        const geo = new THREE.BoxGeometry((WF_X * 2 / WF_COLS) * 1.001, 1, (WF_Y * 2 / WF_ROWS) * 1.001);
        // The faint emissive floor keeps shadow-side faces from reading as
        // holes; the shader adds a base-AO gradient so mesas sit IN the ground.
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0.02, map: cliffTexture(), emissive: new THREE.Color("#0d110c"), emissiveIntensity: 0.5 });
        mat.onBeforeCompile = (s) => {
            s.vertexShader = s.vertexShader
                .replace("#include <common>", "#include <common>\nvarying vec3 vWfWall;")
                .replace("#include <begin_vertex>", "#include <begin_vertex>\n{ vec4 wfw = instanceMatrix * vec4(position, 1.0); vWfWall = (modelMatrix * wfw).xyz; }");
            s.fragmentShader = s.fragmentShader
                .replace("#include <common>", "#include <common>\nvarying vec3 vWfWall;")
                .replace("#include <map_fragment>", "{ vec4 sampledDiffuseColor = texture2D( map, vWfWall.xz * 0.16 + vWfWall.y * 0.05 ); diffuseColor *= sampledDiffuseColor; diffuseColor.rgb *= (0.68 + 0.32 * smoothstep(0.0, 1.1, vWfWall.y)); }");
        };
        const m = new THREE.InstancedMesh(geo, mat, cells.length);
        const o = new THREE.Object3D();
        const col = new THREE.Color();
        cells.forEach((cel, i) => {
            o.position.set(cel.x, cel.h / 2 - 0.1, cel.z);
            o.scale.set(1, cel.h, 1);
            o.rotation.set(0, 0, 0);
            o.updateMatrix();
            m.setMatrixAt(i, o.matrix);
            col.setHSL(spec.tileHue, spec.tileSat * 0.7, 0.3 + cel.shade * 0.14);   // lighter — the cliff texture multiplies it down
            m.setColorAt(i, col);
        });
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        m.receiveShadow = true;   // casts skipped — the wall shadow pass was a frame hog
        return m;
    }, [spec]);
    const canopyMesh = useMemo(() => {
        const spots: Array<{ x: number; z: number; h: number; s: number; hsh: number }> = [];
        for (let r = 0; r < WF_ROWS; r++) {
            for (let c = 0; c < WF_COLS; c++) {
                const x = (c + 0.5) * (WF_X * 2 / WF_COLS) - WF_X, z = (r + 0.5) * (WF_Y * 2 / WF_ROWS) - WF_Y;
                if (wfCellWalkable(c, r) || !wfInsideField(x, z)) continue;
                if (Math.hypot(x - WF_LAIR.x, z - WF_LAIR.y) <= WF_LAIR.pitR + 0.6) continue;
                const hsh = ((c * 40503) ^ (r * 69061)) >>> 0;
                if (hsh % 100 >= 8) continue;   // sparser groves — the painted ground breathes
                const swell = (Math.sin(x * 0.31) + Math.cos(z * 0.43) + Math.sin((x + z) * 0.19)) / 3;
                spots.push({ x, z, h: 1.6 + swell * 0.55, s: 0.8 + (hsh % 37) / 37 * 0.6, hsh });
            }
        }
        // HAND-PAINTED TREE CARDS (crossed alpha planes off the foliage atlas)
        // — the LoL/Unite forest technique, replacing the old cone stacks.
        // Four variants → four instanced draw calls for the whole jungle.
        const group = new THREE.Group();
        const tex = foliageTexture();
        const byTile: Record<number, Array<{ x: number; z: number; h: number; s: number; hsh: number }>> = { 0: [], 1: [], 2: [], 3: [] };
        for (const sp of spots) {
            const tile = sp.hsh % 12 === 0 ? 2 : [0, 1, 3][sp.hsh % 3];   // jade spirit trees stay rare
            byTile[tile].push(sp);
        }
        const o = new THREE.Object3D();
        const col = new THREE.Color();
        for (const tile of [0, 1, 2, 3]) {
            const list = byTile[tile];
            if (!list.length) continue;
            const mat = new THREE.MeshBasicMaterial({
                map: tex, alphaTest: 0.42, side: THREE.DoubleSide,
                // The sprites carry their own painted lighting — basic material
                // keeps them consistent; fog still applies for depth.
            });
            const m = new THREE.InstancedMesh(treeCardGeometry(tile), mat, list.length);
            list.forEach((sp, i) => {
                const size = (2.5 + ((sp.hsh % 29) / 29) * 1.9) * (tile === 2 ? 1.08 : 1);
                o.position.set(sp.x, Math.max(0, sp.h - 0.15), sp.z);
                o.scale.set(size, size, size);
                o.rotation.set(0, ((sp.hsh % 71) / 71) * Math.PI, 0);
                o.updateMatrix();
                m.setMatrixAt(i, o.matrix);
                // Sit the paintings into the scene: slight per-tree dimming
                // (canopy shade) with the spirit trees left luminous.
                const dim = tile === 2 ? 0.98 : 0.74 + ((sp.hsh % 17) / 17) * 0.2;
                col.setRGB(dim, dim, dim * (tile === 2 ? 1.02 : 0.97));
                m.setColorAt(i, col);
            });
            m.instanceMatrix.needsUpdate = true;
            if (m.instanceColor) m.instanceColor.needsUpdate = true;
            group.add(m);
        }
        return group;
    }, []);
    useEffect(() => () => {
        wallMesh.geometry.dispose(); (wallMesh.material as THREE.Material).dispose(); wallMesh.dispose();
        canopyMesh.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (mesh.isMesh) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
        });
    }, [wallMesh, canopyMesh]);
    return (
        <group>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.8, 0]}>
                <planeGeometry args={[220, 130]} />
                <meshBasicMaterial color={spec.voidColor} />
            </mesh>
            <primitive object={instMesh} />
            <primitive object={skirtMesh} />
            <primitive object={wallMesh} />
            <primitive object={canopyMesh} />
            {/* The Hollow Gate breach — a dark maw + glowing rim at the centre. */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[WF_LAIR.x, 0.02, WF_LAIR.y]}>
                <circleGeometry args={[2.35, 40]} />
                <meshBasicMaterial color="#05030a" />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[WF_LAIR.x, 0.03, WF_LAIR.y]}>
                <ringGeometry args={[2.4, 2.95, 48]} />
                <meshBasicMaterial color={spec.breachGlow} transparent opacity={0.55} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>
            <Sparkles count={26} scale={[3.4, 2.6, 3.4]} position={[WF_LAIR.x, 1.2, WF_LAIR.y]} size={2.4} speed={0.35} opacity={0.5} color={spec.breachGlow} noise={2} />
            {/* Lesser-Warden shrine pads + team spawn rings. */}
            {WF_PADS.map(([x, y], i) => (
                <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.02, y]}>
                    <ringGeometry args={[1.15, 1.45, 40]} />
                    <meshBasicMaterial color={spec.breachGlow} transparent opacity={0.24} depthWrite={false} />
                </mesh>
            ))}
            {(["blue", "red"] as const).map((team) => (
                <mesh key={team} rotation={[-Math.PI / 2, 0, 0]} position={[WF_SPAWNS[team][0][0] + (team === "blue" ? 0.9 : -0.9), 0.02, 0]}>
                    <ringGeometry args={[1.3, 1.6, 44]} />
                    <meshBasicMaterial color={TEAM_COLOR[team]} transparent opacity={0.35} depthWrite={false} />
                </mesh>
            ))}
        </group>
    );
}

/** Instanced scatter of a fal-generated prop GLB (largest mesh, normalized to
 * targetH, albedo-emissive lift like WfArtGlb so Hunyuan textures read in our
 * light). One draw call per prop kind. */
function WfPropInstances({ url, items, targetH, lift = 0.34 }: { url: string; items: ReadonlyArray<{ x: number; z: number; s: number; r: number }>; targetH: number; lift?: number }) {
    const gltf = useGLTF(url);
    const mesh = useMemo(() => {
        let src: THREE.Mesh | null = null;
        gltf.scene.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            const count = (m.geometry.getAttribute("position")?.count ?? 0);
            if (!src || count > (src.geometry.getAttribute("position")?.count ?? 0)) src = m;
        });
        const srcMesh = src as THREE.Mesh | null;
        if (!srcMesh) return null;
        const geo = srcMesh.geometry;
        geo.computeBoundingBox();
        const bb = geo.boundingBox!;
        const k = targetH / Math.max(0.001, bb.max.y - bb.min.y);
        const mat = (srcMesh.material as THREE.MeshStandardMaterial).clone();
        if (mat.map) { mat.emissive = new THREE.Color("#ffffff"); mat.emissiveMap = mat.map; mat.emissiveIntensity = lift; }
        const inst = new THREE.InstancedMesh(geo, mat, items.length);
        const o = new THREE.Object3D();
        items.forEach((it, i) => {
            o.position.set(it.x, -bb.min.y * k * it.s, it.z);
            o.scale.setScalar(k * it.s);
            o.rotation.set(0, it.r, 0);
            o.updateMatrix();
            inst.setMatrixAt(i, o.matrix);
        });
        inst.instanceMatrix.needsUpdate = true;
        return inst;
    }, [gltf, items, targetH, lift]);
    if (!mesh) return null;
    return <primitive object={mesh} />;
}
useGLTF.preload("/pet-models/wf-boulder.glb");
useGLTF.preload("/pet-models/wf-lantern.glb");

// ── Set dressing — rim rocks, lane lanterns, breach crystals, base banners ───
// All deterministic (hash-sampled from the mask) and instanced: a handful of
// draw calls dresses the whole valley without touching gameplay or the sim.
function WfSetDressing({ theme }: { theme: WfTheme }) {
    const spec = WF_THEMES[theme];
    const data = useMemo(() => {
        const rocks: Array<{ x: number; z: number; s: number; r: number }> = [];
        const lanterns: Array<{ x: number; z: number }> = [];
        for (let r = 0; r < WF_ROWS; r++) {
            for (let c = 0; c < WF_COLS; c++) {
                const h = ((c * 92821) ^ (r * 68917)) >>> 0;
                const wx = (c + 0.5) * WF_CELL_X - WF_X, wz = (r + 0.5) * WF_CELL_Y - WF_Y;
                const walk = wfCellWalkable(c, r);
                const nearPath = wfCellWalkable(c - 1, r) || wfCellWalkable(c + 1, r) || wfCellWalkable(c, r - 1) || wfCellWalkable(c, r + 1);
                if (!walk && nearPath && h % 100 < 8 && Math.hypot(wx, wz) > WF_LAIR.r + 2 && wfInsideField(wx, wz)) {
                    rocks.push({ x: wx, z: wz, s: 0.55 + (h % 37) / 37 * 1.1, r: (h % 71) / 71 * Math.PI * 2 });
                } else if (walk && !nearPathAll(c, r) && Math.abs(wz) > 4.5 && h % 100 < 3) {
                    lanterns.push({ x: wx, z: wz });
                }
            }
        }
        function nearPathAll(c: number, r: number): boolean {
            return wfCellWalkable(c - 1, r) && wfCellWalkable(c + 1, r) && wfCellWalkable(c, r - 1) && wfCellWalkable(c, r + 1);
        }
        const crystals = Array.from({ length: 10 }, (_, i) => {
            const a = (i / 10) * Math.PI * 2 + 0.3;
            const h = ((i * 48271) % 89) / 89;
            return { x: Math.cos(a) * (WF_LAIR.r + 0.7), z: Math.sin(a) * (WF_LAIR.r + 0.7) * 0.92, s: 1.1 + h * 1.4, r: a };
        });
        return { rocks, lanterns, crystals };
    }, []);
    const rockMesh = useMemo(() => {
        const geo = new THREE.DodecahedronGeometry(0.42, 0);
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.96 });
        const m = new THREE.InstancedMesh(geo, mat, data.rocks.length);
        const o = new THREE.Object3D();
        const col = new THREE.Color();
        data.rocks.forEach((rk, i) => {
            o.position.set(rk.x, 0.16 * rk.s, rk.z);
            o.scale.setScalar(rk.s);
            o.rotation.set(rk.r, rk.r * 1.7, 0);
            o.updateMatrix();
            m.setMatrixAt(i, o.matrix);
            col.setHSL(spec.tileHue, spec.tileSat * 0.7, 0.08 + (i % 5) * 0.015);
            m.setColorAt(i, col);
        });
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        return m;
    }, [data, spec]);
    const crystalMesh = useMemo(() => {
        // Jade breach crystals: sharper spires, hot emissive core, and a soft
        // additive glow pool at the base — they read as MAGIC now, not as
        // untextured wedges.
        const geo = new THREE.ConeGeometry(0.3, 1.15, 5);
        const mat = new THREE.MeshStandardMaterial({ color: "#0d1b16", emissive: new THREE.Color(spec.breachGlow), emissiveIntensity: 0.55, roughness: 0.25, metalness: 0.1 });
        const m = new THREE.InstancedMesh(geo, mat, data.crystals.length);
        const o = new THREE.Object3D();
        data.crystals.forEach((cr, i) => {
            o.position.set(cr.x, 0.42 * cr.s, cr.z);
            o.scale.set(cr.s * 0.55, cr.s * 0.7, cr.s * 0.55);
            o.rotation.set(Math.sin(cr.r) * 0.24, cr.r, Math.cos(cr.r) * -0.24);
            o.updateMatrix();
            m.setMatrixAt(i, o.matrix);
        });
        m.instanceMatrix.needsUpdate = true;
        return m;
    }, [data, spec]);
    const crystalGlowMesh = useMemo(() => {
        const geo = new THREE.PlaneGeometry(1, 1);
        const mat = new THREE.MeshBasicMaterial({ map: radialTexture3d(), color: new THREE.Color(spec.breachGlow), transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
        const m = new THREE.InstancedMesh(geo, mat, data.crystals.length);
        const o = new THREE.Object3D();
        data.crystals.forEach((cr, i) => {
            o.position.set(cr.x, 0.06, cr.z);
            o.rotation.set(-Math.PI / 2, 0, 0);
            o.scale.setScalar(2.2 * cr.s);
            o.updateMatrix();
            m.setMatrixAt(i, o.matrix);
        });
        m.instanceMatrix.needsUpdate = true;
        m.renderOrder = 2;
        return m;
    }, [data, spec]);
    // Lanterns are instanced too (two draw calls for every way-marker on the map).
    const lanternMeshes = useMemo(() => {
        const poleGeo = new THREE.CylinderGeometry(0.045, 0.06, 1.0, 6);
        const poleMat = new THREE.MeshStandardMaterial({ color: "#39304a", roughness: 0.8 });
        const lampGeo = new THREE.BoxGeometry(0.2, 0.24, 0.2);
        const lampMat = new THREE.MeshStandardMaterial({ color: "#1c1526", emissive: new THREE.Color(spec.sunColor), emissiveIntensity: 1.6 });
        const poles = new THREE.InstancedMesh(poleGeo, poleMat, data.lanterns.length);
        const lamps = new THREE.InstancedMesh(lampGeo, lampMat, data.lanterns.length);
        const o = new THREE.Object3D();
        data.lanterns.forEach((l, i) => {
            o.position.set(l.x, 0.5, l.z); o.rotation.set(0, 0, 0); o.scale.setScalar(1); o.updateMatrix();
            poles.setMatrixAt(i, o.matrix);
            o.position.set(l.x, 1.06, l.z); o.updateMatrix();
            lamps.setMatrixAt(i, o.matrix);
        });
        poles.instanceMatrix.needsUpdate = true;
        lamps.instanceMatrix.needsUpdate = true;
        return [poles, lamps] as const;
    }, [data, spec]);
    // Warm glow halos floating at each lamp (one instanced additive quad,
    // gently flickering) — the "bloom" a postprocessing stack would give us,
    // at a price the mobile budget can afford.
    const lanternGlowMesh = useMemo(() => {
        const geo = new THREE.PlaneGeometry(1, 1);
        const mat = new THREE.MeshBasicMaterial({ map: radialTexture3d(), color: new THREE.Color(spec.sunColor), transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
        const m = new THREE.InstancedMesh(geo, mat, data.lanterns.length);
        const o = new THREE.Object3D();
        data.lanterns.forEach((l, i) => {
            o.position.set(l.x, 1.12, l.z);
            o.rotation.set(-Math.PI / 2, 0, 0);
            o.scale.setScalar(1.5 + (i % 3) * 0.2);
            o.updateMatrix();
            m.setMatrixAt(i, o.matrix);
        });
        m.instanceMatrix.needsUpdate = true;
        m.renderOrder = 2;
        return m;
    }, [data, spec]);
    useEffect(() => () => {
        for (const m of [rockMesh, crystalMesh, crystalGlowMesh, lanternGlowMesh, ...lanternMeshes]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); m.dispose(); }
    }, [rockMesh, crystalMesh, crystalGlowMesh, lanternGlowMesh, lanternMeshes]);
    const lanternItems = useMemo(() => data.lanterns.map((l, i) => ({ x: l.x, z: l.z, s: 0.95 + (i % 3) * 0.08, r: (i * 2.39996) % (Math.PI * 2) })), [data]);
    return (
        <group>
            {/* fal-generated props (mossy boulder / stone toro lantern) with
                the old primitives as loading fallbacks. */}
            <Suspense fallback={<primitive object={rockMesh} />}>
                <WfPropInstances url="/pet-models/wf-boulder.glb" items={data.rocks} targetH={0.9} lift={0.12} />
            </Suspense>
            <Suspense fallback={(
                <group>
                    <primitive object={lanternMeshes[0]} />
                    <primitive object={lanternMeshes[1]} />
                </group>
            )}>
                <WfPropInstances url="/pet-models/wf-lantern.glb" items={lanternItems} targetH={1.35} lift={0.45} />
            </Suspense>
            <primitive object={crystalMesh} />
            <primitive object={crystalGlowMesh} />
            <primitive object={lanternGlowMesh} />
        </group>
    );
}

// ── One pet fighter (GLB driven from the warfront snapshot stream) ───────────
function WfFighter3D({ result, clock, id, pet, config }: {
    result: WarfrontResult; clock: WfClockRef; id: string; pet: Pet; config: PetCombatModelConfig | null;
}) {
    const root = useRef<THREE.Group>(null);
    const body = useRef<THREE.Group>(null);
    const aura = useRef<THREE.Mesh>(null);
    const auraMat = useRef<THREE.MeshBasicMaterial>(null);
    const shadow = useRef<THREE.Mesh>(null);
    const hpFill = useRef<HTMLDivElement>(null);
    const nameWrap = useRef<HTMLDivElement>(null);
    const reviveRef = useRef<HTMLDivElement>(null);
    const markRef = useRef<HTMLSpanElement>(null);
    const shieldRef = useRef<THREE.Mesh>(null);
    const stacksRef = useRef<HTMLSpanElement>(null);
    const levelRef = useRef<HTMLSpanElement>(null);
    const modelFrame = useRef<PetModelFrame>({ ...DEFAULT_PET_MODEL_FRAME });
    const lastPos = useRef<[number, number]>([0, 0]);
    const smX = useRef<number | null>(null);
    const smZ = useRef<number | null>(null);
    const smSpd = useRef(0);
    const wasMoving = useRef(false);
    const prevDown = useRef(false);
    const prevState = useRef("");
    const strikeAt = useRef(-10);
    const flash = useRef(0);
    const prevHp = useRef(Number.POSITIVE_INFINITY);
    const faceSm = useRef<[number, number]>([id.startsWith("blue") ? 1 : -1, 0]);
    const travel = useRef<[number, number]>([1, 0]);
    const team: Team = id.startsWith("blue") ? "blue" : "red";
    // A pet with no approved GLB (a custom/unapproved pet) still renders — a
    // team-tinted capsule placeholder, NEVER null/invisible. Everything below
    // (nameplate, HP, level, statuses, death/respawn) is model-independent.
    const targetH = config ? config.targetHeight : 1.6;
    const h = arenaModelHeight(targetH) * 1.15;   // the Warfront field is huge — pets read a touch bigger
    const s = config ? h / Math.max(0.001, targetH) : 1;
    const tint = useMemo(() => tintOf(pet.element), [pet.element]);
    const role = useMemo(() => result.snapshots[0]?.actors.find((a) => a.id === id)?.role ?? "tracker", [result, id]);

    useFrame((state, delta) => {
        const g = root.current; if (!g) return;
        const snaps = result.snapshots;
        const tf = Math.max(0, Math.min(snaps.length - 1, clock.current.t));
        const i0 = Math.floor(tf), i1 = Math.min(snaps.length - 1, i0 + 1), f = tf - i0;
        const a0 = snaps[i0].actors.find((a) => a.id === id); if (!a0) return;
        const a1 = snaps[i1].actors.find((a) => a.id === id) ?? a0;
        const down = a0.state === "respawning";
        const tdx = a1.x - a0.x, tdz = a1.y - a0.y;
        const teleport = tdx * tdx + tdz * tdz > 9;
        const ff = teleport ? (f < 0.5 ? 0 : 1) : f;
        const px = lerp(a0.x, a1.x, ff), pz = lerp(a0.y, a1.y, ff);
        const justBack = prevDown.current && !down;
        if (smX.current === null || smZ.current === null || teleport || down || justBack) { smX.current = px; smZ.current = pz; }
        else { smX.current += (px - smX.current) * 0.38; smZ.current += (pz - smZ.current) * 0.38; }
        const dx = smX.current - lastPos.current[0], dz = smZ.current - lastPos.current[1];
        const spd = (down || justBack) ? 0 : Math.hypot(dx, dz);
        lastPos.current = [smX.current, smZ.current];
        const moving = !down && (wasMoving.current ? spd > 0.005 : spd > 0.014);
        wasMoving.current = moving;
        prevDown.current = down;
        g.position.set(smX.current, 0, smZ.current);
        if (body.current) body.current.visible = !down;

        const now = state.clock.elapsedTime;
        if (a0.state === "attack" && prevState.current !== "attack") strikeAt.current = now;
        prevState.current = a0.state;
        const striking = now - strikeAt.current < 0.3;

        // While MOVING, face where you are going (sim facing is for combat) —
        // mismatched face/travel made pets moonwalk sideways.
        let fx = a0.faceX, fz = a0.faceY;
        if (moving && spd > 1e-5) { fx = dx / spd; fz = dz / spd; }
        else if (Math.hypot(fx, fz) < 0.1) { fx = faceSm.current[0]; fz = faceSm.current[1]; }
        faceSm.current[0] = lerp(faceSm.current[0], fx, 0.35);
        faceSm.current[1] = lerp(faceSm.current[1], fz, 0.35);
        const flen = Math.hypot(faceSm.current[0], faceSm.current[1]) || 1;
        if (moving && spd > 1e-5) travel.current = [dx / spd, dz / spd];

        if (a0.hp < prevHp.current - 0.5) flash.current = 1;
        prevHp.current = a0.hp;
        flash.current *= 0.86;
        const frac = a0.hp / Math.max(1, a0.maxHp);

        const mf = modelFrame.current;
        mf.motion = arenaModelMotion(a0.state === "respawning" ? "respawning" : a0.state === "dash" ? "dash" : a0.state === "attack" ? "attack" : "idle", moving, striking);
        mf.moving = moving;
        smSpd.current = lerp(smSpd.current, spd / Math.max(1e-3, delta), 0.3);
        mf.speed = Math.min(6, smSpd.current);   // real units/second — the rigs gallop at >= 2.65
        mf.moveX = travel.current[0];
        mf.moveZ = travel.current[1];
        mf.faceX = faceSm.current[0] / flen;
        mf.faceZ = faceSm.current[1] / flen;
        mf.hit = flash.current < 0.02 ? 0 : flash.current;
        mf.casting = false;
        mf.desperate = !down && frac > 0 && frac < 0.26;
        mf.statuses = a0.statuses;

        if (aura.current && auraMat.current) {
            aura.current.visible = !down;
            aura.current.position.set(smX.current, 0.03, smZ.current);
            auraMat.current.color.set(TEAM_COLOR[team]);
        }
        if (shadow.current) { shadow.current.visible = !down; shadow.current.position.set(smX.current, 0.045, smZ.current); }
        if (hpFill.current) hpFill.current.style.width = `${Math.max(0, Math.min(100, frac * 100))}%`;
        if (nameWrap.current) nameWrap.current.style.opacity = down ? "0.55" : "1";
        if (reviveRef.current) {
            const show = down && a0.respawnSecs > 0;
            reviveRef.current.style.opacity = show ? "1" : "0";
            if (show) reviveRef.current.textContent = `↻ ${a0.respawnSecs}s`;
        }
        if (stacksRef.current) stacksRef.current.textContent = a0.stacksTotal > 0 ? `▲${a0.stacksTotal}` : "";
        if (markRef.current) markRef.current.textContent = a0.statuses.includes("mark") ? " 🎯" : "";
        if (shieldRef.current) {
            shieldRef.current.visible = !down && a0.shielded;
            const pulse = 1 + Math.sin(now * 5) * 0.04;
            shieldRef.current.scale.setScalar(pulse);
        }
        if (levelRef.current) levelRef.current.textContent = a0.wlevel > 1 ? `★${a0.wlevel}` : "";
        if (body.current) {
            const grow = 1 + (a0.wlevel - 1) * 0.08;   // Unite-style: levels physically GROW the pet
            body.current.scale.x += (grow - body.current.scale.x) * 0.1;
            body.current.scale.y += (grow - body.current.scale.y) * 0.1;
            body.current.scale.z += (grow - body.current.scale.z) * 0.1;
        }
    });

    return (
        <group>
            <group ref={root}>
                <group ref={body}>
                    {config ? (
                        <Suspense fallback={(
                            <mesh position={[0, h * 0.5, 0]}>
                                <capsuleGeometry args={[h * 0.24, h * 0.5, 4, 10]} />
                                <meshStandardMaterial color={tint} emissive={tint} emissiveIntensity={0.4} transparent opacity={0.9} />
                            </mesh>
                        )}>
                            <group scale={s}>
                                <PetModel3D config={config} frame={modelFrame} element={pet.element} />
                            </group>
                        </Suspense>
                    ) : (
                        // No approved model — a visible team-tinted placeholder.
                        <mesh position={[0, h * 0.5, 0]}>
                            <capsuleGeometry args={[h * 0.26, h * 0.52, 6, 12]} />
                            <meshStandardMaterial color={tint} emissive={tint} emissiveIntensity={0.35} />
                        </mesh>
                    )}
                    {/* Shield bubble — the defender/Aegis shields finally READ. */}
                    <mesh ref={shieldRef} visible={false} position={[0, h * 0.55, 0]} renderOrder={3}>
                        <sphereGeometry args={[h * 0.72, 18, 14]} />
                        <meshBasicMaterial color={TEAM_COLOR[team]} transparent opacity={0.16} depthWrite={false} blending={THREE.AdditiveBlending} />
                    </mesh>
                </group>
                <Html position={[0, h + 0.5, 0]} center distanceFactor={10} pointerEvents="none" zIndexRange={[6, 0]}>
                    <div ref={nameWrap} style={{ textAlign: "center", font: "700 11px Inter, system-ui, sans-serif", whiteSpace: "nowrap", userSelect: "none" }}>
                        <div style={{ color: "#fff", textShadow: "0 1px 3px #000", marginBottom: 2 }}>
                            <span style={{ color: TEAM_SOFT[team], fontSize: 8, fontWeight: 800, marginRight: 3 }}>{ROLE_TAG[role] ?? ""}</span>
                            {pet.name}
                            <span ref={levelRef} style={{ marginLeft: 3, color: "#6ee7b7", fontSize: 9, fontWeight: 900 }} />
                            <span ref={stacksRef} style={{ marginLeft: 3, color: "#fde047", fontSize: 9 }} /><span ref={markRef} style={{ color: "#f87171", fontSize: 9 }} />
                        </div>
                        <div style={{ position: "relative", width: 58, height: 5, margin: "0 auto", background: "#0b1020", borderRadius: 4, border: "1px solid #000", overflow: "hidden" }}>
                            <div ref={hpFill} style={{ position: "absolute", left: 0, top: 0, height: "100%", width: "100%", background: TEAM_COLOR[team] }} />
                        </div>
                        <div ref={reviveRef} style={{ opacity: 0, color: "#fde047", fontSize: 10, fontWeight: 800, marginTop: 1 }} />
                    </div>
                </Html>
            </group>
            <mesh ref={aura} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
                <planeGeometry args={[1.6, 1.6]} />
                <meshBasicMaterial ref={auraMat} map={radialTexture3d()} transparent opacity={0.3} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
            </mesh>
            <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[0.95, 0.7]} />
                <meshBasicMaterial map={radialTexture3d()} color="#000000" transparent opacity={0.36} depthWrite={false} />
            </mesh>
        </group>
    );
}

// ── Hollow-spawn — the ABYSSAL ONI HOUND (roster mythic-4: the user's hollow
// beast, already an approved rigged GLB) in a fixed pool. Each slot drives its
// own PetModelFrame so the hounds RUN their skeletal gait along the lanes; a
// small wisp stands in while the model streams. Pool is imperative — waves
// never re-render React.
const HOLLOW_POOL = 6;    // = sim MOB_CAP (was 4 → up to 2 breach raiders rendered invisible)
const MINION_POOL = 24;   // = sim MINION_CAP (12) × 2 teams — exact once the cap-overflow bug is fixed
const HOLLOW_BEAST_ID = "mythic-4";   // Abyssal Oni Hound — the Hollow Gate beast

/** One pooled hound slot: owns its refs (compiler-safe) and drives itself from
 * snap.mobs[index] every frame. Mounted once; waves never re-render React. */
function WfMinionSlot({ result, clock, index, config }: { result: WarfrontResult; clock: WfClockRef; index: number; config: PetCombatModelConfig }) {
    const group = useRef<THREE.Group>(null);
    const frame = useRef<PetModelFrame>({ ...DEFAULT_PET_MODEL_FRAME });
    const prev = useRef<[number, number]>([0, 0]);
    const [side, setSide] = useState<"blue" | "red">("blue");
    const scale = 0.55 / Math.max(0.001, config.targetHeight);
    useFrame((_state, delta) => {
        const g = group.current;
        if (!g) return;
        const minions = snapAt(result, clock).mobs.filter((m) => m.side !== "hollow");
        const m = minions[index];
        if (!m) { g.visible = false; return; }
        g.visible = true;
        if (m.side !== side && (m.side === "blue" || m.side === "red")) setSide(m.side);
        const [px, pz] = prev.current;
        const dx = m.x - px, dz = m.y - pz;
        const spd = Math.hypot(dx, dz);
        prev.current = [m.x, m.y];
        g.position.set(m.x, 0, m.y);
        g.scale.setScalar(m.elite ? 1.3 : 1);   // Gate's Wrath elites LOOM
        const f = frame.current;
        const moving = spd > 1e-4;
        f.motion = moving ? "run" : "idle";
        f.moving = moving;
        f.speed = Math.min(6, spd / Math.max(1e-3, delta));
        if (moving && spd > 1e-6) { f.moveX = dx / spd; f.moveZ = dz / spd; f.faceX = dx / spd; f.faceZ = dz / spd; }
        f.desperate = m.hp / Math.max(1, m.maxHp) < 0.35;
    });
    // Perf valve: the first 12 minion slots get the full rigged hound; overflow
    // slots render as light spirit-wisps (30+ skinned rigs is asking for jank).
    const rich = index < 8;   // rig budget: ~24 skinned models total on screen
    return (
        <group ref={group} visible={false}>
            {/* Team ground-glow: minions read at a glance even in deep jungle. */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.045, 0]} renderOrder={1}>
                <planeGeometry args={[1.05, 1.05]} />
                <meshBasicMaterial map={radialTexture3d()} color={side === "blue" ? "#4f8cf5" : "#f26a6a"} transparent opacity={0.42} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>
            {rich ? (
                <Suspense fallback={(
                    <mesh position={[0, 0.3, 0]}>
                        <sphereGeometry args={[0.22, 8, 8]} />
                        <meshStandardMaterial color={side === "blue" ? "#2547a8" : "#a83232"} emissive={side === "blue" ? "#60a5fa" : "#f87171"} emissiveIntensity={0.8} />
                    </mesh>
                )}>
                    <group scale={scale}>
                        <PetModel3D config={config} frame={frame} element={side === "blue" ? "Water" : "Fire"} />
                    </group>
                </Suspense>
            ) : (
                <mesh position={[0, 0.3, 0]} castShadow>
                    <sphereGeometry args={[0.22, 8, 8]} />
                    <meshStandardMaterial color={side === "blue" ? "#2547a8" : "#a83232"} emissive={side === "blue" ? "#60a5fa" : "#f87171"} emissiveIntensity={0.8} />
                </mesh>
            )}
        </group>
    );
}

function WfMobSlot({ result, clock, index, config, scale, glow }: {
    result: WarfrontResult; clock: WfClockRef; index: number;
    config: PetCombatModelConfig; scale: number; glow: string;
}) {
    const group = useRef<THREE.Group>(null);
    const frame = useRef<PetModelFrame>({ ...DEFAULT_PET_MODEL_FRAME });
    const prev = useRef<[number, number]>([0, 0]);
    useFrame((_state, delta) => {
        const g = group.current;
        if (!g) return;
        const m = snapAt(result, clock).mobs.filter((q) => q.side === "hollow")[index];
        if (!m) { g.visible = false; return; }
        g.visible = true;
        const [px, pz] = prev.current;
        const dx = m.x - px, dz = m.y - pz;
        const spd = Math.hypot(dx, dz);
        prev.current = [m.x, m.y];
        g.position.set(m.x, 0, m.y);
        const f = frame.current;
        const moving = spd > 1e-4;
        f.motion = moving ? "run" : "idle";
        f.moving = moving;
        f.speed = Math.min(6, spd / Math.max(1e-3, delta));   // real units/second for the clip picker
        if (moving && spd > 1e-6) { f.moveX = dx / spd; f.moveZ = dz / spd; f.faceX = dx / spd; f.faceZ = dz / spd; }
        f.desperate = m.hp / Math.max(1, m.maxHp) < 0.35;
    });
    return (
        <group ref={group} visible={false}>
            {/* Hollow-purple ground-glow — raiders stop vanishing into the dark. */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.045, 0]} renderOrder={1}>
                <planeGeometry args={[1.15, 1.15]} />
                <meshBasicMaterial map={radialTexture3d()} color="#a855f7" transparent opacity={0.4} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>
            <Suspense fallback={(
                <mesh position={[0, 0.35, 0]}>
                    <sphereGeometry args={[0.28, 10, 8]} />
                    <meshStandardMaterial color="#171126" emissive={glow} emissiveIntensity={0.9} roughness={0.6} />
                </mesh>
            )}>
                <group scale={scale}>
                    <PetModel3D config={config} frame={frame} element="Shadow" />
                </group>
            </Suspense>
        </group>
    );
}

function WfMobPool({ result, clock, glow }: { result: WarfrontResult; clock: WfClockRef; glow: string }) {
    const config = useMemo(() => petCombatModel({ id: HOLLOW_BEAST_ID } as Pet), []);
    if (!config) return null;
    const scale = 0.55 / Math.max(0.001, config.targetHeight);
    return (
        <group>
            {Array.from({ length: HOLLOW_POOL }, (_, i) => (
                <WfMobSlot key={i} result={result} clock={clock} index={i} config={config} scale={scale} glow={glow} />
            ))}
            {Array.from({ length: MINION_POOL }, (_, i) => (
                <WfMinionSlot key={`w${i}`} result={result} clock={clock} index={i} config={config} />
            ))}
        </group>
    );
}

// ── Structures: Guardian Totems + Ward Seals ─────────────────────────────────
function WfStatue({ result, clock, team, idx }: { result: WarfrontResult; clock: WfClockRef; team: Team; idx: number }) {
    const grp = useRef<THREE.Group>(null);
    const rubble = useRef<THREE.Group>(null);
    const hpFill = useRef<HTMLDivElement>(null);
    const wrap = useRef<HTMLDivElement>(null);
    const first = result.snapshots[0].structures[team].statues[idx];
    useFrame(() => {
        const s = snapAt(result, clock).structures[team].statues[idx];
        if (grp.current) grp.current.visible = s.alive;
        if (rubble.current) rubble.current.visible = !s.alive;
        if (hpFill.current) hpFill.current.style.width = `${Math.max(0, Math.min(100, (s.hp / s.maxHp) * 100))}%`;
        if (wrap.current) wrap.current.style.opacity = s.alive ? "1" : "0";
    });
    return (
        <group position={[first.x, 0, first.y]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.021, 0]}>
                <circleGeometry args={[0.8, 28]} />
                <meshBasicMaterial color="#0c0f1c" transparent opacity={0.8} depthWrite={false} />
            </mesh>
            <group ref={grp}>
                <Suspense fallback={(
                    <mesh castShadow position={[0, 1.1, 0]}>
                        <cylinderGeometry args={[0.55, 0.72, 2.2, 8]} />
                        <meshStandardMaterial color="#4c5670" roughness={0.85} />
                    </mesh>
                )}>
                    <WfArtGlb url="/pet-models/ward-totem.glb" targetH={2.7} />
                </Suspense>
                {/* Team-light crown so ownership reads from the broadcast camera. */}
                <mesh position={[0, 2.95, 0]}>
                    <octahedronGeometry args={[0.24]} />
                    <meshStandardMaterial color={TEAM_COLOR[team]} emissive={TEAM_COLOR[team]} emissiveIntensity={1.4} roughness={0.3} />
                </mesh>
                <Html position={[0, 2.9, 0]} center distanceFactor={11} pointerEvents="none" zIndexRange={[7, 0]}>
                    <div ref={wrap} style={{ textAlign: "center", font: "800 9px Inter, system-ui, sans-serif", whiteSpace: "nowrap" }}>
                        <div style={{ color: TEAM_SOFT[team], textShadow: "0 1px 3px #000", marginBottom: 1 }}>⛩ Totem</div>
                        <div style={{ position: "relative", width: 54, height: 5, margin: "0 auto", background: "#0b1020", borderRadius: 4, border: "1px solid #000", overflow: "hidden" }}>
                            <div ref={hpFill} style={{ position: "absolute", left: 0, top: 0, height: "100%", width: "100%", background: TEAM_COLOR[team] }} />
                        </div>
                    </div>
                </Html>
            </group>
            {/* Shattered aftermath — rubble instead of a bare dark socket. */}
            <group ref={rubble} visible={false}>
                <mesh position={[0.32, 0.16, 0.1]} rotation={[0.4, 0.8, 0.2]}>
                    <dodecahedronGeometry args={[0.32]} />
                    <meshStandardMaterial color="#565b68" roughness={0.95} />
                </mesh>
                <mesh position={[-0.34, 0.1, -0.16]} rotation={[0.2, 0.3, 0.7]}>
                    <dodecahedronGeometry args={[0.24]} />
                    <meshStandardMaterial color="#454a58" roughness={0.95} />
                </mesh>
                <mesh position={[-0.05, 0.28, 0.28]} rotation={[1.25, 0.5, 0.3]}>
                    <cylinderGeometry args={[0.17, 0.22, 0.9, 6]} />
                    <meshStandardMaterial color="#50556b" roughness={0.9} />
                </mesh>
            </group>
        </group>
    );
}

function WfCore({ result, clock, team }: { result: WarfrontResult; clock: WfClockRef; team: Team }) {
    const gem = useRef<THREE.Mesh>(null);
    const shield = useRef<THREE.Mesh>(null);
    const grp = useRef<THREE.Group>(null);
    const hpFill = useRef<HTMLDivElement>(null);
    const label = useRef<HTMLDivElement>(null);
    const first = result.snapshots[0].structures[team].core;
    useFrame((state) => {
        const c = snapAt(result, clock).structures[team].core;
        if (grp.current) grp.current.visible = c.alive;
        if (gem.current) {
            gem.current.rotation.y = state.clock.elapsedTime * 0.8;
            gem.current.position.y = 1.15 + Math.sin(state.clock.elapsedTime * 1.6) * 0.1;
        }
        if (shield.current) shield.current.visible = c.alive && !c.exposed;
        if (hpFill.current) hpFill.current.style.width = `${Math.max(0, Math.min(100, (c.hp / c.maxHp) * 100))}%`;
        if (label.current) label.current.textContent = c.alive ? (c.exposed ? "🔮 Ward Seal — EXPOSED" : "🔮 Ward Seal") : "";
    });
    return (
        <group position={[first.x, 0, first.y]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.021, 0]}>
                <circleGeometry args={[1.0, 32]} />
                <meshBasicMaterial color="#0c0f1c" transparent opacity={0.85} depthWrite={false} />
            </mesh>
            <group ref={grp}>
                <mesh castShadow position={[0, 0.22, 0]}>
                    <cylinderGeometry args={[0.85, 1.0, 0.44, 10]} />
                    <meshStandardMaterial color="#39415a" roughness={0.85} />
                </mesh>
                <mesh ref={gem} castShadow position={[0, 1.15, 0]}>
                    <octahedronGeometry args={[0.62]} />
                    <meshStandardMaterial color={TEAM_COLOR[team]} emissive={TEAM_COLOR[team]} emissiveIntensity={1.1} roughness={0.25} />
                </mesh>
                <mesh ref={shield} position={[0, 1.1, 0]}>
                    <sphereGeometry args={[1.05, 18, 14]} />
                    <meshBasicMaterial color={TEAM_SOFT[team]} transparent opacity={0.16} depthWrite={false} blending={THREE.AdditiveBlending} />
                </mesh>
                <Html position={[0, 2.45, 0]} center distanceFactor={12} pointerEvents="none" zIndexRange={[8, 0]}>
                    <div style={{ textAlign: "center", font: "800 10px Inter, system-ui, sans-serif", whiteSpace: "nowrap" }}>
                        <div ref={label} style={{ color: TEAM_SOFT[team], textShadow: "0 1px 3px #000", marginBottom: 1 }}>🔮 Ward Seal</div>
                        <div style={{ position: "relative", width: 70, height: 6, margin: "0 auto", background: "#0b1020", borderRadius: 4, border: "1px solid #000", overflow: "hidden" }}>
                            <div ref={hpFill} style={{ position: "absolute", left: 0, top: 0, height: "100%", width: "100%", background: TEAM_COLOR[team] }} />
                        </div>
                    </div>
                </Html>
            </group>
        </group>
    );
}

// ── The Gate Warden + Lesser Wardens (billboards, snapshot-driven) ───────────
/** A static art GLB (fal image-to-3D), normalized to stand on the floor at a
 * target height. Used for the Gate Warden (generated from his own artwork). */
function WfArtGlb({ url, targetH }: { url: string; targetH: number }) {
    const { scene } = useGLTF(url);
    const prepared = useMemo(() => {
        const c = scene.clone(true);
        const box = new THREE.Box3().setFromObject(c);
        const size = new THREE.Vector3();
        box.getSize(size);
        const scale = targetH / Math.max(0.001, size.y);
        const center = new THREE.Vector3();
        box.getCenter(center);
        c.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
        c.scale.setScalar(scale);
        c.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            // fal GLBs arrive with dim PBR settings — rebuild the material around
            // the baked albedo and lift shadows with a soft self-illumination so
            // the art reads under the valley's moody lighting.
            const orig = mesh.material as THREE.MeshStandardMaterial;
            const map = orig && orig.map ? orig.map : null;
            const nm = new THREE.MeshStandardMaterial({ map, roughness: 0.8, metalness: 0.05 });
            if (map) {
                map.colorSpace = THREE.SRGBColorSpace;
                nm.emissive = new THREE.Color("#9a9a9a");
                nm.emissiveMap = map;
                nm.emissiveIntensity = 0.38;
            }
            mesh.material = nm;
            mesh.castShadow = true;
        });
        const holder = new THREE.Group();
        holder.add(c);
        return holder;
    }, [scene, targetH]);
    return <primitive object={prepared} />;
}

function WfWarden({ result, clock }: { result: WarfrontResult; clock: WfClockRef }) {
    const root = useRef<THREE.Group>(null);
    const hpWrap = useRef<HTMLDivElement>(null);
    const hpFill = useRef<HTMLDivElement>(null);
    const lastXY = useRef<[number, number]>([0, 0]);
    const body = useRef<THREE.Group>(null);
    const H = 3.4;
    useFrame((state) => {
        const w = snapAt(result, clock).warden;
        const now = state.clock.elapsedTime;
        if (root.current) {
            root.current.visible = w.alive;
            const moving = Math.hypot(w.x - lastXY.current[0], w.y - lastXY.current[1]) > 0.004;
            lastXY.current = [w.x, w.y];
            const bob = moving && w.alive ? Math.abs(Math.sin(now * 6)) * 0.12 : 0;
            root.current.position.set(w.x, bob, w.y);
            if (body.current) {
                // Face the quarry; REAR UP through the slam wind-up; breathe always.
                const targetYaw = w.faceX < 0 ? Math.PI : 0;
                body.current.rotation.y += (targetYaw - body.current.rotation.y) * 0.15;
                const breathe = 1 + Math.sin(now * 1.7) * 0.022;
                const rear = (w.winding ? 1.13 : 1) * breathe;
                body.current.scale.y += (rear - body.current.scale.y) * 0.2;
                body.current.scale.x += (2 - breathe - body.current.scale.x) * 0.2;
                body.current.scale.z += (2 - breathe - body.current.scale.z) * 0.2;
                body.current.rotation.x += ((w.winding ? -0.12 : 0) - body.current.rotation.x) * 0.2;
            }
        }
        if (hpWrap.current) hpWrap.current.style.opacity = w.alive ? "1" : "0";
        if (hpFill.current) hpFill.current.style.width = `${Math.max(0, Math.min(100, (w.hp / w.maxHp) * 100))}%`;
    });
    return (
        <group ref={root} visible={false}>
            <group ref={body}>
                <Suspense fallback={(
                    <Billboard lockX lockZ>
                        <mesh position={[0, H * 0.5, 0]}>
                            <planeGeometry args={[H, H]} />
                            <meshBasicMaterial map={wardenTex("idle")} transparent alphaTest={0.03} depthWrite={false} toneMapped={false} />
                        </mesh>
                    </Billboard>
                )}>
                    <WfArtGlb url={GATE_WARDEN_GLB} targetH={H} />
                </Suspense>
            </group>
            <Html position={[0, H + 0.4, 0]} center pointerEvents="none" distanceFactor={12} zIndexRange={[8, 0]}>
                <div ref={hpWrap} style={{ textAlign: "center", font: "800 10px Inter, system-ui, sans-serif", whiteSpace: "nowrap" }}>
                    <div style={{ color: "#c084fc", textShadow: "0 1px 3px #000", marginBottom: 2 }}>⛰ Gate Warden</div>
                    <div style={{ position: "relative", width: 110, height: 6, margin: "0 auto", background: "#0b1020", borderRadius: 4, border: "1px solid #000", overflow: "hidden" }}>
                        <div ref={hpFill} style={{ position: "absolute", left: 0, top: 0, height: "100%", width: "100%", background: "#a78bfa" }} />
                    </div>
                </div>
            </Html>
        </group>
    );
}

function WfMini({ result, clock, idx, name, glow }: { result: WarfrontResult; clock: WfClockRef; idx: number; name: string; glow: string }) {
    const root = useRef<THREE.Group>(null);
    const hpWrap = useRef<HTMLDivElement>(null);
    const hpFill = useRef<HTMLDivElement>(null);
    const allyRing = useRef<THREE.Mesh>(null);
    const allyMat = useRef<THREE.MeshBasicMaterial>(null);
    // Each camp keeps a distinct LEGENDARY body with an element recolor:
    // Ancient Golem/Earth, Crystal Behemoth/Water, Void Stalker/Shadow, Rift Devourer/Fire.
    const CAMP_BOSS: ReadonlyArray<{ id: string; el: string }> = [
        { id: "legendary-2", el: "Earth" }, { id: "legendary-6", el: "Water" },
        { id: "legendary-10", el: "Shadow" }, { id: "legendary-14", el: "Fire" },
    ];
    const camp = CAMP_BOSS[idx % 4];
    const config = useMemo(() => petCombatModel({ id: camp.id } as Pet), [camp.id]);
    const frameRef = useRef<PetModelFrame>({ ...DEFAULT_PET_MODEL_FRAME });
    const prevPos = useRef<[number, number]>([0, 0]);
    const H = 2.1;
    const scale = config ? H / Math.max(0.001, config.targetHeight) : 1;
    const [aliveUi, setAliveUi] = useState(false);
    useFrame((_state, delta) => {
        const m = snapAt(result, clock).minis[idx];
        if (!m) return;
        if (m.alive !== aliveUi) setAliveUi(m.alive);   // unmount the rig while the camp is empty
        if (root.current) {
            root.current.visible = m.alive;
            root.current.position.set(m.x, 0, m.y);
        }
        const [ppx, ppz] = prevPos.current;
        const dx = m.x - ppx, dz = m.y - ppz;
        const spd = Math.hypot(dx, dz);
        prevPos.current = [m.x, m.y];
        const f = frameRef.current;
        const moving = m.alive && spd > 1e-4;
        f.motion = moving ? "run" : "idle";
        f.moving = moving;
        f.speed = Math.min(6, spd / Math.max(1e-3, delta));
        if (moving && spd > 1e-6) { f.moveX = dx / spd; f.moveZ = dz / spd; f.faceX = dx / spd; f.faceZ = dz / spd; }
        else { f.faceX = m.faceX; f.faceZ = 0.001; f.moveX = m.faceX; f.moveZ = 0.001; }
        f.desperate = m.alive && m.hp / Math.max(1, m.maxHp) < 0.4;
        if (hpWrap.current) hpWrap.current.style.opacity = m.alive ? "1" : "0";
        if (hpFill.current) { hpFill.current.style.width = `${Math.max(0, Math.min(100, (m.hp / m.maxHp) * 100))}%`; hpFill.current.style.background = m.ally ? TEAM_COLOR[m.ally] : "#c084fc"; }
        // Recruited → a team-colored ground ring marks it as fighting for a side.
        if (allyRing.current) { allyRing.current.visible = m.alive && !!m.ally; if (m.ally && allyMat.current) allyMat.current.color.set(TEAM_COLOR[m.ally]); }
    });
    if (!config) return null;
    return (
        <group ref={root} visible={false}>
            {aliveUi && <Suspense fallback={(
                <mesh position={[0, 0.9, 0]}>
                    <sphereGeometry args={[0.8, 12, 10]} />
                    <meshStandardMaterial color="#171126" emissive={glow} emissiveIntensity={0.5} roughness={0.6} />
                </mesh>
            )}>
                <group scale={scale}>
                    <PetModel3D config={config} frame={frameRef} element={camp.el} />
                </group>
            </Suspense>}
            <Html position={[0, H + 0.6, 0]} center pointerEvents="none" distanceFactor={11} zIndexRange={[7, 0]}>
                <div ref={hpWrap} style={{ textAlign: "center", font: "800 9px Inter, system-ui, sans-serif", whiteSpace: "nowrap" }}>
                    <div style={{ color: "#d8b4fe", textShadow: "0 1px 3px #000", marginBottom: 1 }}>👹 {name}</div>
                    <div style={{ position: "relative", width: 60, height: 5, margin: "0 auto", background: "#0b1020", borderRadius: 4, border: "1px solid #000", overflow: "hidden" }}>
                        <div ref={hpFill} style={{ position: "absolute", left: 0, top: 0, height: "100%", width: "100%", background: "#c084fc" }} />
                    </div>
                </div>
            </Html>
            <mesh ref={allyRing} visible={false} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]} renderOrder={-1}>
                <ringGeometry args={[1.15, 1.6, 28]} />
                <meshBasicMaterial ref={allyMat} transparent opacity={0.5} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
            </mesh>
        </group>
    );
}

// ── Lane SENTINELS — recolored MYTHIC pets on turret duty (Unite-style) ──────
function WfGuardian({ result, clock, team, idx }: { result: WarfrontResult; clock: WfClockRef; team: Team; idx: number }) {
    const root = useRef<THREE.Group>(null);
    const rubble = useRef<THREE.Group>(null);
    const hpWrap = useRef<HTMLDivElement>(null);
    const hpFill = useRef<HTMLDivElement>(null);
    const frame = useRef<PetModelFrame>({ ...DEFAULT_PET_MODEL_FRAME });
    // Two distinct mythic bodies per team (top / bottom lane) with team recolors.
    const config = useMemo(() => petCombatModel({ id: idx === 0 ? "mythic-0" : "mythic-2" } as Pet), [idx]);
    const first = result.snapshots[0].guardians[team][idx];
    const H = 1.75;
    const scale = config ? H / Math.max(0.001, config.targetHeight) : 1;
    useFrame(() => {
        const g = snapAt(result, clock).guardians[team][idx];
        if (!g) return;
        if (root.current) {
            root.current.visible = g.alive;
            root.current.position.set(g.x, 0, g.y);
        }
        if (rubble.current) rubble.current.visible = !g.alive;
        const f = frame.current;
        f.motion = "idle";
        f.faceX = g.faceX; f.faceZ = 0.001;
        f.moveX = g.faceX; f.moveZ = 0.001;
        f.desperate = g.alive && g.hp / g.maxHp < 0.35;
        if (hpWrap.current) hpWrap.current.style.opacity = g.alive ? "1" : "0";
        if (hpFill.current) hpFill.current.style.width = `${Math.max(0, Math.min(100, (g.hp / g.maxHp) * 100))}%`;
    });
    if (!config) return null;
    return (
        <>
        <group ref={root} visible={false}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} renderOrder={-1}>
                <ringGeometry args={[1.0, 1.3, 40]} />
                <meshBasicMaterial color={TEAM_COLOR[team]} transparent opacity={0.38} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>
            <Suspense fallback={(
                <mesh position={[0, 0.85, 0]}>
                    <capsuleGeometry args={[0.4, 0.9, 4, 10]} />
                    <meshStandardMaterial color={TEAM_COLOR[team]} emissive={TEAM_COLOR[team]} emissiveIntensity={0.5} />
                </mesh>
            )}>
                <group scale={scale}>
                    <PetModel3D config={config} frame={frame} element={team === "blue" ? "Water" : "Fire"} />
                </group>
            </Suspense>
            <Html position={[0, H + 0.55, 0]} center pointerEvents="none" distanceFactor={11} zIndexRange={[7, 0]}>
                <div ref={hpWrap} style={{ textAlign: "center", font: "800 9px Inter, system-ui, sans-serif", whiteSpace: "nowrap" }}>
                    <div style={{ color: TEAM_SOFT[team], textShadow: "0 1px 3px #000", marginBottom: 1 }}>🛡 Lane Sentinel</div>
                    <div style={{ position: "relative", width: 64, height: 5, margin: "0 auto", background: "#0b1020", borderRadius: 4, border: "1px solid #000", overflow: "hidden" }}>
                        <div ref={hpFill} style={{ position: "absolute", left: 0, top: 0, height: "100%", width: "100%", background: TEAM_COLOR[team] }} />
                    </div>
                </div>
            </Html>
        </group>
        {/* Fallen-post rubble — a sibling, since the root hides when dead. */}
        <group ref={rubble} visible={false} position={[first.x, 0, first.y]}>
            <mesh position={[0.28, 0.14, 0.06]} rotation={[0.5, 0.7, 0.1]}>
                <dodecahedronGeometry args={[0.28]} />
                <meshStandardMaterial color="#525764" roughness={0.95} />
            </mesh>
            <mesh position={[-0.28, 0.1, -0.2]} rotation={[0.1, 0.4, 0.8]}>
                <dodecahedronGeometry args={[0.2]} />
                <meshStandardMaterial color="#41465a" roughness={0.95} />
            </mesh>
        </group>
        </>
    );
}

// ── Camera + clock ───────────────────────────────────────────────────────────
const WF_CAM_MAX_SPAN = 22;   // hard cap: the broadcast NEVER frames the whole valley
// All lane polyline points, flattened — the quiet-map fallback leans toward
// the nearest road so idle moments frame painted stone, not treetops.
const WF_ROAD_PTS: ReadonlyArray<readonly [number, number]> = [...WF_LANES.n, ...WF_LANES.m, ...WF_LANES.s];
/** Frame the BEST CLUSTER of action — never the global centroid. Averaging two
 * far-apart fights used to aim the camera at the empty jungle between them
 * with both fights clipped at the frame edges. `px/pz` = current camera focus,
 * used as a tie-break so near-equal clusters do not flip-flop the shot. */
function wfCameraFocus(snap: WfSnapshot, px = 0, pz = 0): { fx: number; fz: number; span: number } {
    const frame = (pts: Array<[number, number]>, wts?: number[]): { fx: number; fz: number; span: number } => {
        let bi = 0, bs = -1;
        for (let i = 0; i < pts.length; i++) {
            let s = 0;
            for (let j = 0; j < pts.length; j++) if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) < 9) s += wts ? wts[j] : 1;
            if (Math.hypot(pts[i][0] - px, pts[i][1] - pz) < 12) s += 0.75;   // shot stability
            if (s > bs) { bs = s; bi = i; }
        }
        const members = pts.filter((q) => Math.hypot(pts[bi][0] - q[0], pts[bi][1] - q[1]) < 9);
        let mx = 0, mz = 0;
        for (const [x, z] of members) { mx += x; mz += z; }
        mx /= members.length; mz /= members.length;
        let spread = 0;
        for (const [x, z] of members) { const d = Math.hypot(x - mx, z - mz); if (d > spread) spread = d; }
        return { fx: mx, fz: mz, span: Math.min(WF_CAM_MAX_SPAN, Math.max(12, spread * 2 + 9)) };
    };
    // A contested Warden is ALWAYS the shot — centered between the pit and his
    // attackers so the boss fight never hugs a frame corner.
    if (snap.warden.alive) {
        let n = 0, ax = 0, az = 0;
        for (const a of snap.actors) {
            if (a.state !== "respawning" && Math.hypot(a.x - snap.warden.x, a.y - snap.warden.y) < 6.5) { ax += a.x; az += a.y; n++; }
        }
        if (n) return { fx: (snap.warden.x + ax / n) / 2, fz: (snap.warden.y + az / n) / 2, span: 15 };
    }
    // 1) Pet-vs-pet engagements, WEIGHTED by urgency — a fight where someone is
    // about to die, or a base about to fall, wins the shot over a bigger but
    // lower-stakes brawl. The camera cuts to the money, not just the crowd.
    const fights: Array<[number, number]> = [];
    const fightW: number[] = [];
    for (const a of snap.actors) {
        if (a.team !== "blue" || a.state === "respawning") continue;
        for (const b of snap.actors) {
            if (b.team !== "red" || b.state === "respawning") continue;
            if (Math.hypot(a.x - b.x, a.y - b.y) < 7) {
                fights.push([(a.x + b.x) / 2, (a.y + b.y) / 2]);
                const low = Math.min(a.hp / Math.max(1, a.maxHp), b.hp / Math.max(1, b.maxHp));
                fightW.push(low < 0.3 ? 2.5 : 1);   // imminent kill = this is the shot
            }
        }
    }
    // A base under active siege (structure <45% with an enemy on it) is a money
    // moment — fold it in at high weight so the camera can catch the Seal fall.
    for (const team of ["blue", "red"] as const) {
        const foe: Team = team === "blue" ? "red" : "blue";
        const siege = (x: number, y: number, hp: number, mhp: number) => {
            if (hp / Math.max(1, mhp) >= 0.45) return;
            if (!snap.actors.some((a) => a.team === foe && a.state !== "respawning" && Math.hypot(a.x - x, a.y - y) < 4)) return;
            fights.push([x, y]); fightW.push(3);
        };
        for (const s of snap.structures[team].statues) if (s.alive) siege(s.x, s.y, s.hp, s.maxHp);
        const c = snap.structures[team].core;
        if (c.alive) siege(c.x, c.y, c.hp, c.maxHp);
    }
    if (fights.length) return frame(fights, fightW);
    // 2) Pets at WORK (on an enemy structure or wave — stable per-frame signal).
    const busy: Array<[number, number]> = [];
    for (const a of snap.actors) {
        if (a.state === "respawning") continue;
        const foe: Team = a.team === "blue" ? "red" : "blue";
        const fs = snap.structures[foe];
        const working = fs.statues.some((s) => s.alive && Math.hypot(s.x - a.x, s.y - a.y) < 4)
            || (fs.core.alive && Math.hypot(fs.core.x - a.x, fs.core.y - a.y) < 4)
            || snap.guardians[foe].some((g) => g.alive && Math.hypot(g.x - a.x, g.y - a.y) < 4.2)
            || snap.mobs.some((m) => m.side !== a.team && Math.hypot(m.x - a.x, m.y - a.y) < 3);
        if (working) busy.push([a.x, a.y]);
    }
    if (busy.length) return frame(busy);
    // 3) The biggest minion clash.
    const clashes: Array<[number, number]> = [];
    for (const m of snap.mobs) {
        if (m.side === "red") continue;
        for (const o of snap.mobs) {
            if (o.side === m.side) continue;
            if (Math.hypot(m.x - o.x, m.y - o.y) < 3) { clashes.push([(m.x + o.x) / 2, (m.y + o.y) / 2]); break; }
        }
    }
    if (clashes.length) return frame(clashes);
    // 4) Truly quiet → ride with YOUR squad, leaned toward the nearest road.
    let n = 0, mx = 0, mz = 0;
    for (const a of snap.actors) { if (a.team === "blue" && a.state !== "respawning") { mx += a.x; mz += a.y; n++; } }
    if (!n) for (const a of snap.actors) { if (a.state !== "respawning") { mx += a.x; mz += a.y; n++; } }
    if (!n) return { fx: 0, fz: 0, span: 16 };
    mx /= n; mz /= n;
    let rx = mx, rz = mz, rd = Infinity;
    for (const [x, z] of WF_ROAD_PTS) { const d = Math.hypot(x - mx, z - mz); if (d < rd) { rd = d; rx = x; rz = z; } }
    return { fx: mx * 0.55 + rx * 0.45, fz: mz * 0.55 + rz * 0.45, span: 15 };
}

export type WfCamCtl = { mode: "follow" | "free"; fx: number; fz: number; dist: number };

function WfCameraRig({ result, clock, shake, camViewRef, camCtlRef, storyRef, modeRef, focusPetRef }: {
    result: WarfrontResult; clock: WfClockRef; shake: MutableRefObject<number>;
    camViewRef: MutableRefObject<{ x: number; z: number; half: number }>;
    camCtlRef: MutableRefObject<WfCamCtl>;
    storyRef: MutableRefObject<WfStoryCam | null>;
    modeRef: MutableRefObject<WfCamMode>;
    focusPetRef: MutableRefObject<string | null>;
}) {
    const sm = useRef({ fx: 0, fz: 0, d: 18, init: true });
    useFrame((state) => {
        const s = sm.current;
        const ctl = camCtlRef.current;
        if (ctl.mode === "free") {
            // Player-driven spectator cam — glide toward the requested view.
            const k = s.init ? 1 : 0.22;
            s.fx += (ctl.fx - s.fx) * k;
            s.fz += (ctl.fz - s.fz) * k;
            s.d += (ctl.dist - s.d) * k;
        } else {
            // A FEATURED PET (clicked mini-screen) owns the main camera
            // outright; otherwise mode-aware focus — broadcast chases the
            // director's story cuts, calm rides wide, team locks to the squad.
            const mode = modeRef.current;
            let focus: { fx: number; fz: number; span: number } | null = null;
            let k0: number | null = null;
            const lockedPet = focusPetRef.current;
            if (lockedPet) {
                const snap = snapAt(result, clock);
                const a = snap.actors.find((x) => x.id === lockedPet);
                if (a) { focus = { fx: a.x, fz: a.y, span: 13 }; k0 = s.init ? 1 : 0.09; }
            }
            if (focus === null) focus = ((): { fx: number; fz: number; span: number } => {
                if (mode === "team") {
                    const snap = snapAt(result, clock);
                    let n = 0, mx = 0, mz = 0;
                    for (const a of snap.actors) if (a.team === "blue" && a.state !== "respawning") { mx += a.x; mz += a.y; n++; }
                    if (!n) return wfCameraFocus(snap, s.fx, s.fz);
                    mx /= n; mz /= n;
                    let spread = 0;
                    for (const a of snap.actors) {
                        if (a.team !== "blue" || a.state === "respawning") continue;
                        const d = Math.hypot(a.x - mx, a.y - mz);
                        if (d > spread) spread = d;
                    }
                    // Widen with the squad's spread so split lanes still show
                    // everyone instead of an empty centroid.
                    return { fx: mx, fz: mz, span: Math.min(26, Math.max(15, spread * 2 + 7)) };
                }
                const f0 = wfCameraFocus(snapAt(result, clock), s.fx, s.fz);
                return mode === "calm" ? { fx: f0.fx, fz: f0.fz, span: Math.min(26, f0.span + 6) } : f0;
            })();
            let k = k0 ?? (s.init ? 1 : mode === "calm" ? 0.03 : 0.045);
            const story = storyRef.current;
            if (story) {
                const t = clock.current.t;
                if (t <= story.untilT && t >= story.untilT - WARFRONT_TPS * 4) {
                    if (!lockedPet && (mode === "broadcast" || (mode === "calm" && story.prio >= 4))) {
                        focus = { fx: story.x, fz: story.z, span: mode === "calm" ? story.span + 4 : story.span };
                        k = s.init ? 1 : 0.11;   // cut faster than the ambient drift
                    }
                } else storyRef.current = null;   // expired (or the clock rewound)
            }
            // Keep the frame FULL of battlefield: bias edge fights toward the
            // map so the void beyond the rim never eats a third of the screen.
            // (North needs the most margin — the tilted camera shows far past
            // the focus on that side.)
            const fx2 = Math.max(-WF_X + focus.span * 0.42, Math.min(WF_X - focus.span * 0.42, focus.fx));
            const fz2 = Math.max(-WF_Y + focus.span * 0.5, Math.min(WF_Y - focus.span * 0.32, focus.fz));
            const aspect = state.size.width / Math.max(1, state.size.height);
            const targetD = Math.min(mode === "calm" ? 24 : 20, arenaCameraDist(focus.span, aspect));
            // A far-away story means a broadcast CUT (instant), never a long
            // swoosh across the whole valley — the pro-production rule.
            if (!s.init && Math.hypot(fx2 - s.fx, fz2 - s.fz) > 16) {
                s.fx = fx2; s.fz = fz2; s.d = targetD;
            } else {
                s.fx += (fx2 - s.fx) * k;
                s.fz += (fz2 - s.fz) * k;
                s.d += (targetD - s.d) * k;
            }
            ctl.fx = s.fx; ctl.fz = s.fz; ctl.dist = s.d;   // free-cam starts from here
        }
        s.init = false;
        camViewRef.current = { x: s.fx, z: s.fz, half: s.d * 0.62 };
        let ox = 0, oy = 0;
        const amp = shake.current;
        if (amp > 0.01) { ox = Math.sin(state.clock.elapsedTime * 92) * amp * 0.18; oy = Math.cos(state.clock.elapsedTime * 77) * amp * 0.13; }
        state.camera.position.set(s.fx + ox, Math.sin(A3D_PITCH) * s.d + oy, s.fz + Math.cos(A3D_PITCH) * s.d);
        state.camera.lookAt(s.fx + ox, 0, s.fz);
    });
    return null;
}

/** Drag-to-pan + wheel-zoom spectator controls on the canvas. Any interaction
 * switches to free-cam (the Follow chip returns to the broadcast). */
function WfCameraControls({ camCtlRef, onModeChange }: {
    camCtlRef: MutableRefObject<WfCamCtl>; onModeChange: (mode: "follow" | "free") => void;
}) {
    const gl = useThree((s) => s.gl);
    const sizeRef = useRef({ w: 1, h: 1 });
    useFrame((state) => { sizeRef.current = { w: state.size.width, h: state.size.height }; });
    useEffect(() => {
        const el = gl.domElement;
        let dragging = false, lastX = 0, lastY = 0, moved = 0;
        const clampView = () => {
            const c = camCtlRef.current;
            c.fx = Math.max(-WF_X - 6, Math.min(WF_X + 6, c.fx));
            c.fz = Math.max(-WF_Y - 6, Math.min(WF_Y + 6, c.fz));
            c.dist = Math.max(9, Math.min(48, c.dist));
        };
        const down = (e: PointerEvent) => { dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; };
        const move = (e: PointerEvent) => {
            if (!dragging) return;
            const dx = e.clientX - lastX, dy = e.clientY - lastY;
            lastX = e.clientX; lastY = e.clientY;
            moved += Math.abs(dx) + Math.abs(dy);
            if (moved < 6) return;
            const c = camCtlRef.current;
            if (c.mode !== "free") { c.mode = "free"; onModeChange("free"); }
            // World units per CSS pixel at the current zoom.
            const worldPerPx = (2 * c.dist * Math.tan(((A3D_FOV / 2) * Math.PI) / 180) * (sizeRef.current.w / Math.max(1, sizeRef.current.h))) / Math.max(1, sizeRef.current.w);
            c.fx -= dx * worldPerPx;
            c.fz -= dy * worldPerPx / Math.sin(A3D_PITCH);
            clampView();
        };
        const up = () => { dragging = false; };
        const wheel = (e: WheelEvent) => {
            e.preventDefault();
            const c = camCtlRef.current;
            if (c.mode !== "free") { c.mode = "free"; onModeChange("free"); }
            c.dist *= 1 + Math.sign(e.deltaY) * 0.09;
            clampView();
        };
        el.addEventListener("pointerdown", down);
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        el.addEventListener("wheel", wheel, { passive: false });
        return () => {
            el.removeEventListener("pointerdown", down);
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            el.removeEventListener("wheel", wheel);
        };
    }, [gl, camCtlRef, onModeChange]);
    return null;
}

function WfTicker({ result, clockRef, shakeRef, onFrontier, pumpRef }: {
    result: WarfrontResult; clockRef: WfClockRef; shakeRef: MutableRefObject<number>;
    onFrontier: MutableRefObject<() => void>;
    pumpRef: MutableRefObject<() => void>;
}) {
    useFrame((_s, delta) => {
        if (shakeRef.current > 0.01) shakeRef.current *= 0.85;
        // STREAM the sim: a couple of ms of ticks per frame keeps the frontier
        // ahead of the clock — the old synchronous 90 s chunk froze the main
        // thread for ~1 s at every council boundary.
        pumpRef.current();
        const frontier = result.snapshots.length - 1;
        const c = clockRef.current;
        if (!c.playing) return;
        // Hit-stop: kills briefly drop playback to quarter speed (pure
        // presentation — the recorded sim underneath is untouched).
        const rate = c.slow > 0 ? 0.25 : 1;
        if (c.slow > 0) c.slow = Math.max(0, c.slow - delta);
        c.t = Math.min(frontier, c.t + delta * rate * WARFRONT_TPS);
        if (c.t >= frontier) onFrontier.current();
    });
    return null;
}

// ── PiP chase cam (render takeover, same pattern as the arena stage) ─────────
function WfMultiCam({ result, clock, petIds, tileW, tileH, margin, gap, statusRefs, hpRefs, tileRefs, selectedRef, camViewRef }: {
    result: WarfrontResult; clock: WfClockRef; petIds: string[];
    tileW: number; tileH: number; margin: number; gap: number;
    statusRefs: MutableRefObject<Array<HTMLSpanElement | null>>;
    hpRefs: MutableRefObject<Array<HTMLDivElement | null>>;
    tileRefs: MutableRefObject<Array<HTMLDivElement | null>>;
    selectedRef: MutableRefObject<string | null>;
    camViewRef: MutableRefObject<{ x: number; z: number; half: number }>;
}) {
    const cams = useRef<THREE.PerspectiveCamera[]>([]);
    const sm = useRef<Array<{ x: number; z: number; init: boolean }>>([]);
    // STAGGERED WALL: each frame renders the main view plus ONE tile into a
    // cached texture (tiles refresh at ~15 fps, plenty for monitor screens).
    // Cost: 2 scene renders per frame instead of 5 — the same GPU price as a
    // single corner cam, with all four screens kept.
    const rig = useRef<{ rts: THREE.WebGLRenderTarget[]; scene: THREE.Scene; cam: THREE.OrthographicCamera; quads: THREE.Mesh[] } | null>(null);
    const frameNo = useRef(0);
    useEffect(() => () => {
        const r = rig.current;
        if (!r) return;
        for (const rt of r.rts) rt.dispose();
        for (const q of r.quads) { q.geometry.dispose(); (q.material as THREE.Material).dispose(); }
        rig.current = null;
    }, []);
    useFrame((state) => {
        const { gl, scene, camera, size } = state;
        // Shadow maps refresh at 30 Hz — invisible for a fixed sun, and it
        // halves the priciest fixed cost of the frame.
        gl.shadowMap.autoUpdate = false;
        if (frameNo.current % 2 === 0) gl.shadowMap.needsUpdate = true;
        gl.setScissorTest(false);
        gl.setViewport(0, 0, size.width, size.height);
        gl.autoClear = true;
        gl.render(scene, camera);
        const snap = snapAt(result, clock);
        const selected = selectedRef.current;
        const view = camViewRef.current;
        if (!rig.current) {
            const dpr = gl.getPixelRatio();
            const cscene = new THREE.Scene();
            const ccam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
            const rts: THREE.WebGLRenderTarget[] = [];
            const quads: THREE.Mesh[] = [];
            for (let i = 0; i < petIds.length; i++) {
                const rt = new THREE.WebGLRenderTarget(Math.max(2, Math.round(tileW * dpr)), Math.max(2, Math.round(tileH * dpr)));
                rts.push(rt);
                const q = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: rt.texture }));
                quads.push(q);
                cscene.add(q);
            }
            rig.current = { rts, scene: cscene, cam: ccam, quads };
        }
        const r = rig.current;
        // Render exactly one tile's world this frame (round-robin).
        const i = frameNo.current % Math.max(1, petIds.length);
        frameNo.current++;
        const id = petIds[i];
        const a = snap.actors.find((x) => x.id === id);
        if (a) {
            if (!cams.current[i]) cams.current[i] = new THREE.PerspectiveCamera(46, tileW / Math.max(1, tileH), 0.4, 80);
            const cam = cams.current[i];
            cam.aspect = tileW / Math.max(1, tileH);
            cam.updateProjectionMatrix();
            if (selected === id) {
                // SWAPPED: this pet owns the MAIN screen — its tile carries the
                // broadcast so the director's view is never lost.
                const f = wfCameraFocus(snap, view.x, view.z);
                const d2 = Math.min(20, arenaCameraDist(f.span, tileW / Math.max(1, tileH)));
                cam.position.set(f.fx, Math.sin(A3D_PITCH) * d2, f.fz + Math.cos(A3D_PITCH) * d2);
                cam.lookAt(f.fx, 0, f.fz);
            } else {
                if (!sm.current[i]) sm.current[i] = { x: a.x, z: a.y, init: true };
                const s = sm.current[i];
                const jump = Math.hypot(a.x - s.x, a.y - s.z) > 5;
                if (s.init || jump) { s.x = a.x; s.z = a.y; s.init = false; }
                else { s.x += (a.x - s.x) * 0.5; s.z += (a.y - s.z) * 0.5; }
                // Same terrain-clearing drone framing as the old chase cam.
                cam.position.set(s.x, 6.8, s.z + 4.6);
                cam.lookAt(s.x, 0.6, s.z);
            }
            // Tiles reuse the shadow map the MAIN render just produced — no
            // second shadow pass for the monitor wall.
            const shadowAuto = gl.shadowMap.autoUpdate;
            gl.shadowMap.autoUpdate = false;
            gl.setRenderTarget(r.rts[i]);
            gl.setClearColor("#05070f", 1);
            gl.clear(true, true);
            gl.render(scene, cam);
            gl.setRenderTarget(null);
            gl.shadowMap.autoUpdate = shadowAuto;
        }
        // Composite all four cached tiles (one trivial quad pass).
        r.cam.right = size.width;
        r.cam.top = size.height;
        r.cam.updateProjectionMatrix();
        petIds.forEach((pid, j) => {
            const q = r.quads[j];
            const x0 = margin + j * (tileW + gap);
            q.position.set(x0 + tileW / 2, margin + tileH / 2, 0);
            q.scale.set(tileW, tileH, 1);
        });
        gl.autoClear = false;
        gl.render(r.scene, r.cam);
        gl.autoClear = true;
        // Tile chrome updates EVERY frame for every pet (DOM writes are cheap).
        petIds.forEach((pid, j) => {
            const aj = snap.actors.find((x) => x.id === pid);
            if (!aj) return;
            const el = statusRefs.current[j];
            if (el) {
                const t = aj.state === "respawning" && aj.respawnSecs > 0 ? `↻ ${aj.respawnSecs}s` : "";
                if (el.textContent !== t) el.textContent = t;
            }
            const hp = hpRefs.current[j];
            if (hp) {
                const frac = Math.max(0, Math.min(1, aj.hp / Math.max(1, aj.maxHp)));
                hp.style.width = `${Math.round(frac * 100)}%`;
                hp.style.background = frac < 0.35 ? "#f87171" : "#60a5fa";
            }
            const tile = tileRefs.current[j];
            if (tile) {
                const offscreen = Math.abs(aj.x - view.x) > view.half * 1.45 || Math.abs(aj.y - view.z) > view.half;
                const inFight = aj.state !== "respawning" && snap.actors.some((b) => b.team !== aj.team && b.state !== "respawning" && Math.hypot(b.x - aj.x, b.y - aj.y) < 6);
                const hurt = aj.state !== "respawning" && aj.hp / Math.max(1, aj.maxHp) < 0.35;
                const pulse = selected !== pid && offscreen && (inFight || hurt) ? "wfTilePulse 0.9s ease-in-out infinite" : "";
                if (tile.style.animation !== pulse) tile.style.animation = pulse;
            }
        });
    }, 1);
    return null;
}

// ── The broadcast director (events → FX/feed/banners) ────────────────────────
type WfFxItem = { id: number; frames: string[]; pos: Vec3; scale: number; dur: number };
type WfShotItem = { id: number; from: Vec3; to: Vec3; visual: ProjectileVisual; dur: number; arc: number };
type WfFloatItem = { id: number; pos: Vec3; text: string; color: string; big: boolean };

// Broadcast colors for the elemental signature moves.
const WF_EL_COLORS: Record<string, string> = {
    Fire: "#fb923c", Water: "#38bdf8", Earth: "#d3a44a", Wind: "#6ee7b7", Lightning: "#fde047",
};

function WfDirector({ result, clockRef, nameOf, pushFeed, pushBanner, triggerFlash, shakeRef, spawnFx, spawnShot, spawnFloater, storyRef, camViewRef, onEnd }: {
    result: WarfrontResult; clockRef: WfClockRef;
    nameOf: (id: string) => string;
    pushFeed: (text: string, color: string) => void;
    pushBanner: (text: string, color: string, big?: boolean) => void;
    triggerFlash: (color: string) => void;
    shakeRef: MutableRefObject<number>;
    spawnFx: (x: number, z: number, key: string | null, element: string | null | undefined, scale: number, dur: number) => void;
    spawnShot: (fromX: number, fromY: number, toX: number, toY: number, element: string | null | undefined, charged: boolean) => void;
    spawnFloater: (x: number, z: number, text: string, color: string, big: boolean) => void;
    storyRef: MutableRefObject<WfStoryCam | null>;
    camViewRef: MutableRefObject<{ x: number; z: number; half: number }>;
    onEnd: () => void;
}) {
    const lastTick = useRef(-1);
    const ended = useRef(false);
    // Announcer memory: first blood fired, each pet's current kill spree, and
    // which structures already raised their under-siege alarm.
    const firstBlood = useRef(false);
    const sprees = useRef(new Map<string, number>());
    const siegeWarned = useRef(new Set<string>());
    const isPet = (id: string) => id.startsWith("blue-") || id.startsWith("red-");
    useFrame(() => {
        const cur = Math.floor(clockRef.current.t);
        // Rewind (replay) resets ALL director-local memory — including `ended`,
        // which otherwise stayed true and stopped onEnd() from firing on replay.
        if (cur < lastTick.current) { lastTick.current = -1; firstBlood.current = false; sprees.current.clear(); siegeWarned.current.clear(); ended.current = false; }
        // The director orders a camera cut to a story beat; higher priority (or
        // an expired story) always wins the slot.
        const cut = (t: number, x: number, z: number, span: number, prio: number, secs: number) => {
            const s = storyRef.current;
            if (!s || clockRef.current.t > s.untilT || prio >= s.prio) storyRef.current = { x, z, untilT: t + WARFRONT_TPS * secs, span, prio };
        };
        if (cur > lastTick.current) {
            const snaps = result.snapshots;
            for (const e of result.events) {
                if (e.t <= lastTick.current || e.t > cur) continue;
                const snap = snaps[Math.min(snaps.length - 1, e.t)];
                const actorPos = (id: string) => snap.actors.find((a) => a.id === id);
                if (e.type === "hit") {
                    const tgt = actorPos(e.targetId);
                    if (tgt) {
                        spawnFx(tgt.x, tgt.y, null, e.element, e.crit ? 1.35 : 0.8, 260);
                        spawnFloater(tgt.x, tgt.y, `${e.dmg}`, e.crit ? "#fde047" : "#fecaca", e.crit);
                        const src = actorPos(e.actorId);
                        if (src && Math.hypot(src.x - tgt.x, src.y - tgt.y) >= 1.8) spawnShot(src.x, src.y, tgt.x, tgt.y, e.element, e.crit);
                        else if (e.actorId.startsWith("guard-")) {
                            // Sentinel fire now reads: a bolt to the target + a muzzle
                            // flash at the post, and its charged shots (crit) fire big.
                            const [, gTeam, gIdx] = e.actorId.split("-");
                            const gg = snap.guardians[gTeam as Team]?.[Number(gIdx)];
                            if (gg) { spawnShot(gg.x, gg.y, tgt.x, tgt.y, gTeam === "blue" ? "Water" : "Fire", e.crit); spawnFx(gg.x, gg.y, "spark", null, e.crit ? 1.1 : 0.55, 200); }
                        }
                        if (e.crit) shakeRef.current = Math.max(shakeRef.current, 0.5);
                        // A pet in danger is the story — nudge the camera there.
                        if (tgt.hp / Math.max(1, tgt.maxHp) < 0.35) cut(e.t, tgt.x, tgt.y, 14, 1, 1.2);
                    }
                } else if (e.type === "heal") {
                    const tgt = actorPos(e.targetId);
                    if (tgt) { spawnFx(tgt.x, tgt.y, "heal", null, 1.3, 420); spawnFloater(tgt.x, tgt.y, `+${e.amount}`, "#86efac", false); }
                } else if (e.type === "kill") {
                    const tgt = actorPos(e.targetId);
                    if (tgt) {
                        spawnFx(tgt.x, tgt.y, "spark", null, 2.6, 560);
                        spawnFloater(tgt.x, tgt.y, "☠", "#f8fafc", true);
                        cut(e.t, tgt.x, tgt.y, 12, 3, 2.2);   // the broadcast cuts to the takedown
                    }
                    pushFeed(`☠ ${nameOf(e.targetId)} — slain by ${nameOf(e.actorId)}`, e.team === "blue" ? "#60a5fa" : "#f87171");
                    shakeRef.current = Math.max(shakeRef.current, 1.3);
                    clockRef.current.slow = Math.max(clockRef.current.slow, 0.3);   // hit-stop
                    // Announcer: first blood, sprees, shutdowns (pet kills only).
                    if (isPet(e.actorId)) {
                        if (!firstBlood.current) {
                            firstBlood.current = true;
                            pushBanner(`🩸 FIRST BLOOD — ${nameOf(e.actorId)}`, e.team === "blue" ? "#93c5fd" : "#fca5a5", true);
                        }
                        const streak = (sprees.current.get(e.actorId) ?? 0) + 1;
                        sprees.current.set(e.actorId, streak);
                        if (streak === 3) { pushBanner(`🔥 ${nameOf(e.actorId).toUpperCase()} IS RAMPAGING`, "#fb923c"); }
                        else if (streak === 5) { pushBanner(`⚡ ${nameOf(e.actorId).toUpperCase()} IS UNSTOPPABLE`, "#fde047", true); }
                    }
                    const victimStreak = sprees.current.get(e.targetId) ?? 0;
                    if (victimStreak >= 3) pushFeed(`🛑 SHUTDOWN — ${nameOf(e.targetId)}'s rampage ends`, "#fbbf24");
                    sprees.current.set(e.targetId, 0);
                } else if (e.type === "gank") {
                    pushBanner(`🗡 GANK — ${nameOf(e.actorId)} springs the ambush!`, "#c084fc");
                    pushFeed(`🗡 ${nameOf(e.actorId)} ambushes ${nameOf(e.targetId)} from the tall grass`, "#c084fc");
                    spawnFx(e.x, e.y, "shadow", null, 2.0, 500);
                    cut(e.t, e.x, e.y, 12, 3, 2.4);
                } else if (e.type === "mobhit") {
                    spawnFx(e.x, e.y, "spark", null, 0.7, 200);
                    // A sentinel or camp boss shooting a minion gets a visible bolt
                    // from the shooter — their most common attack was invisible.
                    if (e.targetId?.startsWith("guard-")) {
                        const [, gTeam, gIdx] = e.targetId.split("-");
                        const gg = snap.guardians[gTeam as Team]?.[Number(gIdx)];
                        if (gg) { spawnShot(gg.x, gg.y, e.x, e.y, gTeam === "blue" ? "Water" : "Fire", false); spawnFx(gg.x, gg.y, "spark", null, 0.5, 150); }
                    } else if (e.targetId?.startsWith("mini-")) {
                        const m = snap.minis.find((z) => z.padIdx === Number(e.targetId!.split("-")[1]));
                        if (m) spawnFx(m.x, m.y, null, "Shadow", 0.5, 170);
                    }
                } else if (e.type === "mobstrike") {
                    // Small elemental puff — minion attacks now READ (Water=blue
                    // wave, Fire=red wave, Shadow=hollow-spawn).
                    spawnFx(e.x, e.y, null, e.el, 0.4, 170);
                } else if (e.type === "mobkill") {
                    spawnFloater(e.x, e.y, "+25 🪙", "#fde047", false);
                } else if (e.type === "structhit") {
                    spawnFx(e.x, e.y, "spark", null, e.core ? 1.4 : 1.0, 240);
                    if (e.core) shakeRef.current = Math.max(shakeRef.current, 0.5);
                    // First warning per structure: it just fell under 60% —
                    // siege pressure must be a story BEFORE the point lands.
                    // (Resolve the target by position: guardian structhits
                    // reuse the `statue` field for their own index.)
                    let key = "", label = "", frac = 1;
                    const gg2 = snap.guardians[e.team].find((g) => g.alive && Math.hypot(g.x - e.x, g.y - e.y) < 2);
                    const ss2 = snap.structures[e.team].statues.find((s) => s.alive && Math.hypot(s.x - e.x, s.y - e.y) < 2);
                    if (gg2) { key = `g-${e.team}-${snap.guardians[e.team].indexOf(gg2)}`; label = "sentinel"; frac = gg2.hp / gg2.maxHp; }
                    else if (ss2) { key = `s-${e.team}-${snap.structures[e.team].statues.indexOf(ss2)}`; label = "totem"; frac = ss2.hp / ss2.maxHp; }
                    else if (e.core) { key = `c-${e.team}`; label = "Ward Seal"; frac = snap.structures[e.team].core.hp / snap.structures[e.team].core.maxHp; }
                    if (key && frac < 0.6 && !siegeWarned.current.has(key)) {
                        siegeWarned.current.add(key);
                        pushFeed(`🚨 ${e.team === "blue" ? "Blue" : "Red"}'s ${label} is under siege!`, "#fbbf24");
                        cut(e.t, e.x, e.y, 13, 2, 1.8);
                    }
                } else if (e.type === "statuedown") {
                    const fallen = snap.structures[e.team].statues[e.statue];
                    pushBanner("⛩ GUARDIAN TOTEM SHATTERED", e.by === "blue" ? "#93c5fd" : "#fca5a5");
                    pushFeed(`⛩ ${e.team === "blue" ? "Blue" : "Red"} totem down (+${200} 🪙)`, e.by === "blue" ? "#60a5fa" : "#f87171");
                    triggerFlash(e.by === "blue" ? "rgba(59,130,246,0.3)" : "rgba(239,68,68,0.3)");
                    shakeRef.current = Math.max(shakeRef.current, 1.8);
                    if (fallen) {
                        spawnFx(fallen.x, fallen.y, "power", null, 2.8, 650);
                        spawnFx(fallen.x, fallen.y, "spark", null, 2.0, 500);
                        cut(e.t, fallen.x, fallen.y, 13, 4, 2.4);
                    }
                    clockRef.current.slow = Math.max(clockRef.current.slow, 0.25);
                } else if (e.type === "coreexposed") {
                    pushBanner(`🛡 ${e.team === "blue" ? "BLUE" : "RED"} SEAL EXPOSED — LAST STAND!`, e.team === "blue" ? "#60a5fa" : "#f87171", true);
                    pushFeed(`🛡 ${e.team === "blue" ? "Blue" : "Red"}'s Ward Seal lies bare — a desperate LAST STAND (they hit +20% for 45s)`, "#fde047");
                    triggerFlash(e.team === "blue" ? "rgba(59,130,246,0.22)" : "rgba(239,68,68,0.22)");
                } else if (e.type === "shutdown") {
                    pushBanner(`🎯 SHUTDOWN — ${nameOf(e.actorId)} cashes in! +${e.bounty}🪙`, "#fbbf24", true);
                    pushFeed(`🎯 ${nameOf(e.actorId)} SHUTS DOWN ${nameOf(e.targetId)}'s ${e.streak}-streak for a ${e.bounty}🪙 bounty`, "#fbbf24");
                    const av = actorPos(e.targetId);
                    if (av) spawnFloater(av.x, av.y, `+${e.bounty}🪙`, "#fde047", true);
                } else if (e.type === "coredown") {
                    const core = snap.structures[e.team].core;
                    pushBanner(`${e.by === "blue" ? "BLUE" : "RED"} SHATTERS THE WARD SEAL!`, e.by === "blue" ? "#60a5fa" : "#f87171", true);
                    triggerFlash(e.by === "blue" ? "rgba(59,130,246,0.5)" : "rgba(239,68,68,0.5)");
                    shakeRef.current = Math.max(shakeRef.current, 2.2);
                    spawnFx(core.x, core.y, "power", null, 3.4, 900);
                    spawnFx(core.x, core.y, "spark", null, 2.6, 700);
                    cut(e.t, core.x, core.y, 14, 6, 3.5);
                    clockRef.current.slow = Math.max(clockRef.current.slow, 0.5);
                } else if (e.type === "minispawn") {
                    pushFeed(`👹 The ${WF_MINI_NAMES[e.padIdx] ?? "Lesser Warden"} has awakened at its shrine`, "#d8b4fe");
                } else if (e.type === "minikill") {
                    const boss = WF_MINI_NAMES[e.padIdx] ?? "Lesser Warden";
                    pushBanner(`🤝 ${boss.toUpperCase()} RECRUITED — fights for ${e.team === "blue" ? "BLUE" : "RED"}!`, e.team === "blue" ? "#93c5fd" : "#fca5a5", true);
                    pushFeed(`🤝 ${e.team === "blue" ? "Blue" : "Red"} recruits the ${boss} to its side for the fight (+${350} 🪙 + boon)`, e.team === "blue" ? "#60a5fa" : "#f87171");
                    const mm = snap.minis.find((z) => z.padIdx === e.padIdx);
                    if (mm) { spawnFx(mm.x, mm.y, "power", null, 2.2, 520); cut(e.t, mm.x, mm.y, 13, 3, 2); }
                } else if (e.type === "wardenwindup") {
                    spawnFx(e.x, e.y, "shadow", null, 2.2, 420);
                    shakeRef.current = Math.max(shakeRef.current, 0.4);
                } else if (e.type === "wardenslam") {
                    spawnFx(e.x, e.y, "power", null, 2.8, 500);
                    shakeRef.current = Math.max(shakeRef.current, 1.4);
                } else if (e.type === "wardenkill") {
                    if (e.stolen) {
                        pushBanner(`😱 THE WARDEN IS STOLEN BY ${e.team === "blue" ? "BLUE" : "RED"}!`, "#fde047", true);
                        pushFeed(`😱 ${e.team === "blue" ? "Blue" : "Red"} STEALS the Gate Warden — daylight robbery! +${1200} 🪙`, "#fde047");
                    } else {
                        pushBanner(`⛰ ${e.team === "blue" ? "BLUE" : "RED"} FELLS THE GATE WARDEN! +${1200} 🪙`, e.team === "blue" ? "#60a5fa" : "#f87171", true);
                        pushFeed("⛰ The Hollow Gate falls silent…", "#c084fc");
                    }
                    triggerFlash(e.team === "blue" ? "rgba(59,130,246,0.45)" : "rgba(239,68,68,0.45)");
                    shakeRef.current = Math.max(shakeRef.current, 1.8);
                    cut(e.t, WF_LAIR.x, WF_LAIR.y, 15, 5, 3);
                    clockRef.current.slow = Math.max(clockRef.current.slow, 0.35);
                } else if (e.type === "phase") {
                    const sudden = e.name === "SUDDEN DEATH";
                    const label = e.name === "SKIRMISH" ? "⚔ SKIRMISH — camps unlock" : e.name === "WAR" ? "⛰ WAR — MARCH ON THE WARDEN" : "💀 THE HOLLOW COLLAPSES — bases crumble, end it now";
                    pushBanner(label, sudden ? "#f87171" : "#fde047", true);
                    pushFeed(label, sudden ? "#f87171" : "#fde047");
                    shakeRef.current = Math.max(shakeRef.current, sudden ? 1.4 : 0.8);
                    if (sudden) triggerFlash("rgba(239,68,68,0.32)");
                } else if (e.type === "guardiandown") {
                    const post = snap.guardians[e.team]?.[e.idx];
                    pushBanner("🛡 SENTINEL FALLS — THE GATE LIES UNWARDED", e.by === "blue" ? "#93c5fd" : "#fca5a5");
                    pushFeed(`🛡 ${e.team === "blue" ? "Blue" : "Red"}'s sentinel is slain (+${250} 🪙)`, e.by === "blue" ? "#60a5fa" : "#f87171");
                    triggerFlash(e.by === "blue" ? "rgba(59,130,246,0.28)" : "rgba(239,68,68,0.28)");
                    shakeRef.current = Math.max(shakeRef.current, 1.6);
                    if (post) {
                        spawnFx(post.x, post.y, "power", null, 2.6, 600);
                        spawnFx(post.x, post.y, "spark", null, 1.8, 480);
                        cut(e.t, post.x, post.y, 13, 4, 2.2);
                    }
                } else if (e.type === "ability") {
                    if (e.kind === "shield") spawnFx(e.x, e.y, null, "Water", 1.15, 320);
                    else if (e.kind === "dash") spawnFx(e.x, e.y, "shadow", null, 0.9, 260);
                    else if (e.kind === "mark") { spawnFx(e.x, e.y, "spark", null, 0.8, 240); spawnFloater(e.x, e.y, "🎯 MARKED", "#f87171", false); }
                } else if (e.type === "focus") {
                    // The squad collapses on one target — a single clean cue.
                    spawnFloater(e.x, e.y, "⚔ FOCUS FIRE", "#fbbf24", false);
                } else if (e.type === "elemsig") {
                    const col = WF_EL_COLORS[e.el] ?? "#c4b5fd";
                    spawnShot(e.px, e.py, e.x, e.y, e.el || null, false);
                    spawnFx(e.x, e.y, null, e.el || null, 1.5, 380);
                    spawnFloater(e.x, e.y, e.name, col, true);
                } else if (e.type === "bosssig") {
                    const bossN = WF_MINI_NAMES[e.padIdx] ?? "Lesser Warden";
                    if (e.kind === "quake") {
                        spawnFx(e.x, e.y, "shadow", null, 2.4, 620);
                        spawnFloater(e.x, e.y, "⛰ QUAKE!", "#fbbf24", true);
                        pushFeed(`⛰ The ${bossN} coils — QUAKE incoming!`, "#fbbf24");
                        shakeRef.current = Math.max(shakeRef.current, 0.5);
                        cut(e.t, e.x, e.y, 12, 2, 1.6);
                    } else if (e.kind === "quakeland") {
                        spawnFx(e.x, e.y, "power", null, 2.6, 520);
                        shakeRef.current = Math.max(shakeRef.current, 1.3);
                    } else if (e.kind === "shell") {
                        spawnFx(e.x, e.y, null, "Water", 2.0, 600);
                        spawnFloater(e.x, e.y, "💠 CRYSTAL SHELL", "#7dd3fc", false);
                        pushFeed(`💠 The ${bossN} hardens — attackers bleed back!`, "#7dd3fc");
                    } else if (e.kind === "blink") {
                        spawnFx(e.x, e.y, "shadow", null, 1.4, 360);
                        spawnFloater(e.x, e.y, "👁 BLINK", "#c084fc", false);
                    } else if (e.kind === "flame") {
                        spawnFx(e.x, e.y, null, "Fire", 2.2, 480);
                        shakeRef.current = Math.max(shakeRef.current, 0.5);
                    } else if (e.kind === "roar") {
                        // Idle menace — an uncontested camp boss pulses so it reads
                        // as a living threat, not a statue. No banner/feed spam.
                        spawnFx(e.x, e.y, "shadow", null, 1.7, 420);
                        spawnFloater(e.x, e.y, `${bossN} stirs…`, "#c4b5fd", false);
                    }
                } else if (e.type === "wardenshock") {
                    pushBanner("🌋 RIFT SHOCKWAVE — THE WARDEN RAGES", "#c084fc", true);
                    pushFeed("🌋 The Gate Warden erupts, hurling all from the pit!", "#c084fc");
                    triggerFlash("rgba(147,51,234,0.4)");
                    spawnFx(e.x, e.y, "power", null, 3.2, 800);
                    spawnFx(e.x, e.y, "shadow", null, 2.6, 700);
                    shakeRef.current = Math.max(shakeRef.current, 2.0);
                    clockRef.current.slow = Math.max(clockRef.current.slow, 0.4);
                    cut(e.t, e.x, e.y, 15, 5, 2.6);
                } else if (e.type === "ultimate") {
                    // Each ultimate reads DIFFERENTLY — a signature, not a generic flash.
                    // The world FX + name floater ALWAYS play (visible if you're
                    // looking there or on the multi-cam wall) — but the disruptive
                    // broadcast beat (shake + hard cut) only fires when the caster
                    // is the pet you're actually watching. With ~50 ults a match,
                    // cutting to every one off-screen turned them into wallpaper;
                    // now each on-screen ult is a real moment and the rest just
                    // happen where they happen.
                    if (e.kind === "Shadow Execution") spawnFx(e.x, e.y, "shadow", null, 2.8, 650);
                    else if (e.kind === "Sanctuary") spawnFx(e.x, e.y, "heal", null, 3.0, 700);
                    else if (e.kind === "Bulwark Aegis") spawnFx(e.x, e.y, null, "Water", 2.6, 600);
                    else spawnFx(e.x, e.y, "power", null, 2.6, 600);
                    spawnFloater(e.x, e.y, e.kind.toUpperCase() + "!", "#c4b5fd", true);
                    pushFeed(`✨ ${nameOf(e.petId)} unleashes ${e.kind}!`, "#c4b5fd");
                    const cv = camViewRef.current;
                    const onScreen = Math.abs(e.x - cv.x) < cv.half && Math.abs(e.y - cv.z) < cv.half;
                    if (onScreen) {
                        shakeRef.current = Math.max(shakeRef.current, 0.9);
                        cut(e.t, e.x, e.y, 13, 2, 1.6);
                    }
                } else if (e.type === "petlevel") {
                    const a = actorPos(e.petId);
                    if (a) { spawnFx(a.x, a.y, "power", null, 1.8, 480); spawnFloater(a.x, a.y, `LEVEL ${e.level}!`, "#6ee7b7", true); }
                    pushFeed(`★ ${nameOf(e.petId)} reached level ${e.level}`, "#6ee7b7");
                } else if (e.type === "stance") {
                    const spec2 = WF_STANCES.find((s) => s.id === e.stance);
                    const who = e.team === "blue" ? "BLUE" : "RED";
                    pushBanner(`${spec2?.icon ?? "📜"} ${who} ${e.answer ? "ANSWERS" : "ADOPTS"}: ${(spec2?.label ?? e.stance).toUpperCase()}`, e.team === "blue" ? "#93c5fd" : "#fca5a5", true);
                    pushFeed(`📜 ${who[0]}${who.slice(1).toLowerCase()} ${e.answer ? "answers with" : "adopts"} ${spec2?.label ?? e.stance}`, e.team === "blue" ? "#60a5fa" : "#f87171");
                } else if (e.type === "buy") {
                    const spec = WF_POWERUPS.find((p) => p.kind === e.kind);
                    pushFeed(`${spec?.icon ?? "▲"} ${nameOf(e.petId)} gains ${spec?.label ?? e.kind}`, e.team === "blue" ? "#93c5fd" : "#fca5a5");
                }
            }
            lastTick.current = cur;
        }
        if (!ended.current && result.winner !== null && clockRef.current.t >= result.snapshots.length - 1) {
            ended.current = true;
            onEnd();
        }
    });
    return null;
}

// ── Minimap (DOM canvas — mask + live dots) ──────────────────────────────────
function WfMinimap({ result, clock, theme, camViewRef, camCtlRef, onModeChange }: {
    result: WarfrontResult; clock: WfClockRef; theme: WfTheme;
    camViewRef: MutableRefObject<{ x: number; z: number; half: number }>;
    camCtlRef: MutableRefObject<WfCamCtl>; onModeChange: (m: "follow" | "free") => void;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const spec = WF_THEMES[theme];
    const bg = useMemo(() => {
        const c = document.createElement("canvas");
        c.width = WF_COLS; c.height = WF_ROWS;
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = spec.voidColor;
        ctx.fillRect(0, 0, WF_COLS, WF_ROWS);
        // Four-tone read, like a real MOBA minimap: gold ROADS, mid GROUND,
        // dark jungle WALLS inside the field, void beyond the rim.
        const h = Math.round(spec.tileHue * 360), sPct = Math.round(spec.tileSat * 100);
        const roadCol = `hsl(${h}, ${Math.min(70, sPct + 22)}%, 46%)`;
        const groundCol = `hsl(${h}, ${sPct}%, 27%)`;
        const wallCol = `hsl(${h}, ${sPct}%, 12%)`;
        for (let r = 0; r < WF_ROWS; r++) for (let cc = 0; cc < WF_COLS; cc++) {
            const x = (cc + 0.5) * (WF_X * 2 / WF_COLS) - WF_X, y = (r + 0.5) * (WF_Y * 2 / WF_ROWS) - WF_Y;
            const walk = WF_MASK.charCodeAt(r * WF_COLS + cc) === 49;
            if (walk) ctx.fillStyle = wfLaneDistance(x, y) < 1.8 ? roadCol : groundCol;
            else if (wfInsideField(x, y)) ctx.fillStyle = wallCol;
            else continue;
            ctx.fillRect(cc, r, 1, 1);
        }
        return c;
    }, [spec]);
    useEffect(() => {
        let live = true;
        const draw = () => {
            if (!live) return;
            const cv = canvasRef.current;
            if (cv) {
                const ctx = cv.getContext("2d");
                if (ctx) {
                    ctx.clearRect(0, 0, cv.width, cv.height);
                    ctx.drawImage(bg, 0, 0, cv.width, cv.height);
                    const snap = snapAt(result, clock);
                    const px = (x: number) => ((x + WF_X) / (WF_X * 2)) * cv.width;
                    const py = (y: number) => ((y + WF_Y) / (WF_Y * 2)) * cv.height;
                    const dot = (x: number, y: number, r: number, color: string) => {
                        ctx.fillStyle = color;
                        ctx.beginPath();
                        ctx.arc(px(x), py(y), r, 0, Math.PI * 2);
                        ctx.fill();
                    };
                    // Damaged structures pulse an amber alarm ring — siege
                    // pressure reads from the minimap at a glance.
                    const now2 = performance.now() / 1000;
                    const alarm = (x: number, y: number) => {
                        ctx.strokeStyle = `rgba(251,191,36,${(0.5 + 0.4 * Math.sin(now2 * 6.5)).toFixed(3)})`;
                        ctx.lineWidth = 1.4;
                        ctx.beginPath();
                        ctx.arc(px(x), py(y), 5.4 + Math.sin(now2 * 6.5) * 1.2, 0, Math.PI * 2);
                        ctx.stroke();
                    };
                    for (const team of ["blue", "red"] as const) {
                        const st = snap.structures[team];
                        for (const s of st.statues) {
                            if (!s.alive) continue;
                            dot(s.x, s.y, 2.6, team === "blue" ? "#1d4ed8" : "#b91c1c");
                            if (s.hp / s.maxHp < 0.6) alarm(s.x, s.y);
                        }
                        if (st.core.alive) {
                            dot(st.core.x, st.core.y, 3.6, TEAM_COLOR[team]);
                            if (st.core.hp / st.core.maxHp < 0.6) alarm(st.core.x, st.core.y);
                        }
                        for (const g of snap.guardians[team]) {
                            if (!g.alive) continue;
                            dot(g.x, g.y, 2.1, team === "blue" ? "#2563eb" : "#dc2626");
                            if (g.hp / g.maxHp < 0.6) alarm(g.x, g.y);
                        }
                    }
                    if (snap.warden.alive) dot(snap.warden.x, snap.warden.y, 3.4, "#a78bfa");
                    for (const m of snap.minis) if (m.alive) dot(m.x, m.y, 2.4, "#c084fc");
                    for (const m of snap.mobs) dot(m.x, m.y, 1.5, m.side === "hollow" ? "#8b7bb8" : m.side === "blue" ? "#3b82f6" : "#ef4444");
                    for (const a of snap.actors) if (a.state !== "respawning") dot(a.x, a.y, 2.4, a.team === "blue" ? "#60a5fa" : "#f87171");
                    // The broadcast camera's current view window.
                    const v = camViewRef.current;
                    const halfW = (v.half / (WF_X * 2)) * cv.width;
                    const halfH = (v.half * 0.62 / (WF_Y * 2)) * cv.height;
                    ctx.strokeStyle = "rgba(255,255,255,0.75)";
                    ctx.lineWidth = 1;
                    ctx.strokeRect(px(v.x) - halfW, py(v.z) - halfH, halfW * 2, halfH * 2);
                }
            }
            requestAnimationFrame(draw);
        };
        const id = requestAnimationFrame(draw);
        return () => { live = false; cancelAnimationFrame(id); };
    }, [result, clock, bg, camViewRef]);
    return (
        <canvas
            ref={canvasRef} width={224} height={105}
            onClick={(e) => {
                // Tap the map → jump the spectator camera there (free-cam).
                const rect = e.currentTarget.getBoundingClientRect();
                const c = camCtlRef.current;
                c.mode = "free";
                c.fx = ((e.clientX - rect.left) / rect.width) * WF_X * 2 - WF_X;
                c.fz = ((e.clientY - rect.top) / rect.height) * WF_Y * 2 - WF_Y;
                onModeChange("free");
            }}
            style={{ width: 224, height: 105, borderRadius: 8, border: "1px solid rgba(148,163,184,0.5)", background: spec.voidColor, boxShadow: "0 3px 14px rgba(0,0,0,0.45)", cursor: "pointer", pointerEvents: "auto" }}
        />
    );
}

// ── HUD frame-writers (refs only, no re-render) ──────────────────────────────
function WfHudWriter({ result, clock, timerRef, coinBlueRef, coinRedRef, scoreBlueRef, scoreRedRef, killBlueRef, killRedRef, momentumRef, structsBlueRef, structsRedRef, stanceBlueRef, stanceRedRef }: {
    result: WarfrontResult; clock: WfClockRef;
    timerRef: MutableRefObject<HTMLSpanElement | null>;
    coinBlueRef: MutableRefObject<HTMLSpanElement | null>;
    coinRedRef: MutableRefObject<HTMLSpanElement | null>;
    scoreBlueRef: MutableRefObject<HTMLSpanElement | null>;
    scoreRedRef: MutableRefObject<HTMLSpanElement | null>;
    killBlueRef: MutableRefObject<HTMLSpanElement | null>;
    killRedRef: MutableRefObject<HTMLSpanElement | null>;
    momentumRef: MutableRefObject<HTMLDivElement | null>;
    structsBlueRef: MutableRefObject<HTMLSpanElement | null>;
    structsRedRef: MutableRefObject<HTMLSpanElement | null>;
    stanceBlueRef: MutableRefObject<HTMLSpanElement | null>;
    stanceRedRef: MutableRefObject<HTMLSpanElement | null>;
}) {
    useFrame(() => {
        const snap = snapAt(result, clock);
        if (timerRef.current) {
            const remain = Math.max(0, WF_MAX_SECONDS - Math.floor(snap.t / WARFRONT_TPS));
            const mm = Math.floor(remain / 60), ss = remain % 60;
            timerRef.current.textContent = `${mm}:${ss < 10 ? "0" : ""}${ss}`;
        }
        if (coinBlueRef.current) coinBlueRef.current.textContent = String(snap.coins.blue);
        if (coinRedRef.current) coinRedRef.current.textContent = String(snap.coins.red);
        // SCORE = the actual win condition (wfVerdictScore: enemy statues +
        // core broken; the same formula the timer verdict rules on).
        const score = wfVerdictScore(snap);
        let kb = 0, kr = 0;
        for (const e of result.events) {   // events are tick-sorted — early exit
            if (e.t > snap.t) break;
            if (e.type === "kill") { if (e.team === "blue") kb++; else kr++; }
        }
        if (scoreBlueRef.current) scoreBlueRef.current.textContent = String(score.blue);
        if (scoreRedRef.current) scoreRedRef.current.textContent = String(score.red);
        if (killBlueRef.current) killBlueRef.current.textContent = String(kb);
        if (killRedRef.current) killRedRef.current.textContent = String(kr);
        // Structure pips: each team's REMAINING sentinels/totems/seal — siege
        // pressure is glanceable before a point ever lands.
        if (structsBlueRef.current) {
            const s = `${snap.guardians.blue.map((g) => (g.alive ? "🛡" : "·")).join("")}${snap.structures.blue.statues.map((x) => (x.alive ? "⛩" : "·")).join("")}${snap.structures.blue.core.alive ? "🔮" : "·"}`;
            if (structsBlueRef.current.textContent !== s) structsBlueRef.current.textContent = s;
        }
        if (structsRedRef.current) {
            const s = `${snap.structures.red.core.alive ? "🔮" : "·"}${snap.structures.red.statues.map((x) => (x.alive ? "⛩" : "·")).join("")}${snap.guardians.red.map((g) => (g.alive ? "🛡" : "·")).join("")}`;
            if (structsRedRef.current.textContent !== s) structsRedRef.current.textContent = s;
        }
        // Stance chips: each team's declared formation, at a glance.
        for (const [ref, tm] of [[stanceBlueRef, "blue"], [stanceRedRef, "red"]] as const) {
            if (!ref.current) continue;
            const spec2 = WF_STANCES.find((s) => s.id === snap.stances[tm]);
            if (spec2 && ref.current.textContent !== spec2.icon) { ref.current.textContent = spec2.icon; ref.current.title = `${tm === "blue" ? "Blue" : "Red"} formation: ${spec2.label}`; }
        }
        // Momentum: structure damage dealt + points + kills + gold, squashed to
        // a 0..100% fill — the one-glance "who is winning" broadcast bar.
        if (momentumRef.current) {
            const dmgTo = (tm: Team) => {
                const st2 = snap.structures[tm];
                let d = st2.statues.reduce((a, s) => a + (s.maxHp - Math.max(0, s.hp)), 0) + (st2.core.maxHp - Math.max(0, st2.core.hp));
                for (const g of snap.guardians[tm]) d += (g.maxHp - Math.max(0, g.hp)) * 0.6;
                return d;
            };
            const lead = (dmgTo("red") - dmgTo("blue")) + (score.blue - score.red) * 900 + (kb - kr) * 220 + (snap.coins.blue - snap.coins.red) * 0.25;
            const pct = 50 + Math.max(-46, Math.min(46, lead / 60));
            momentumRef.current.style.width = `${pct}%`;
        }
    });
    return null;
}

// ── The match shell ──────────────────────────────────────────────────────────
export type PetWarfrontMatchProps = {
    blue: ArenaSlot[]; red: ArenaSlot[]; seed: number;
    theme?: WfTheme;
    /** "off" (default) = interactive 30 s War Council popup. Any policy = silent
     * auto-buy (the shape co-op replays share). */
    autoBuy?: WfBuyPolicy;
    /** Opening formation/strategy — the player's pre-match pick. Adjustable at
     * every War Council when the council is interactive. */
    stance?: WfStance;
    doctrine?: WfDoctrine;
    /** Enables the 🎲 New-match button (vs-AI / harness). Leave off for shared
     * co-op/PvP replays, where both clients must stay on the agreed seed. */
    allowReseed?: boolean;
    onExit: () => void;
    onResult?: (result: WarfrontResult) => void;
};

export function PetWarfrontMatch({ blue, red, seed, theme = "central", autoBuy = "off", stance = "balanced", doctrine = "none", allowReseed = false, onExit, onResult }: PetWarfrontMatchProps) {
    const quality = useMemo(() => petVisualQuality(), []);
    // Restart machinery: bumping `run` rebuilds the sim from scratch (same seed
    // → identical match); `seedBump` rolls a fresh deterministic seed.
    const [run, setRun] = useState(0);
    const [seedBump, setSeedBump] = useState(0);
    const effectiveSeed = seed + seedBump * 1000003;
    const spec = WF_THEMES[theme];
    const roster = useMemo(() => [
        ...blue.slice(0, 4).map((s, i) => ({ id: `blue-${i}`, pet: s.pet })),
        ...red.slice(0, 4).map((s, i) => ({ id: `red-${i}`, pet: s.pet })),
    ], [blue, red]);
    const configs = useMemo(() => {
        const m = new Map<string, PetCombatModelConfig>();
        for (const r of roster) { const c = petCombatModel(r.pet); if (c) m.set(r.id, c); }
        return m;
    }, [roster]);
    // The interactive chunked sim: round 1 (0→30 s) is computed at mount so the
    // stage always has snapshots; later rounds advance at each boundary.
    const ctl = useMemo(() => {
        const c = startWarfrontMatch(blue, red, effectiveSeed, { bluePolicy: autoBuy, redPolicy: "balanced", theme, blueStance: stance, blueDoctrine: doctrine });
        c.advanceRoundPartial(WARFRONT_TPS * 8);   // seed ~8s of runway; the pump streams the rest
        return c;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `run` intentionally forces a fresh sim (Restart)
    }, [blue, red, effectiveSeed, autoBuy, theme, stance, run]);
    const result = ctl.result;
    const clock = useRef<{ t: number; playing: boolean; slow: number }>({ t: 0, playing: true, slow: 0 });
    const shake = useRef(0);
    const camView = useRef<{ x: number; z: number; half: number }>({ x: 0, z: 0, half: 12 });
    const camCtl = useRef<WfCamCtl>({ mode: "follow", fx: 0, fz: 0, dist: 18 });
    const [freeCam, setFreeCam] = useState(false);
    // Spectator camera mode — persisted per device; drag still enters free-cam.
    const [camMode, setCamModeState] = useState<WfCamMode>(() => {
        try {
            const v = localStorage.getItem("wfCamMode.v1");
            return v === "calm" || v === "team" ? v : "broadcast";
        } catch { return "broadcast"; }
    });
    const camModeRef = useRef<WfCamMode>("broadcast");
    useEffect(() => { camModeRef.current = camMode; });
    const setCamMode = (m: WfCamMode) => {
        setCamModeState(m);
        try { localStorage.setItem("wfCamMode.v1", m); } catch { /* storage disabled — ignore */ }
    };
    const [ended, setEnded] = useState(false);
    const [flash, setFlash] = useState<{ id: number; color: string } | null>(null);
    const [banner, setBanner] = useState<{ id: number; text: string; color: string; big: boolean } | null>(null);
    const [feed, setFeed] = useState<Array<{ id: number; text: string; color: string }>>([]);
    const [fxList, setFxList] = useState<WfFxItem[]>([]);
    const [shots, setShots] = useState<WfShotItem[]>([]);
    const [floaters, setFloaters] = useState<WfFloatItem[]>([]);
    const [council, setCouncil] = useState<{ round: number } | null>(null);
    const [cart, setCart] = useState<WarfrontChoice[]>([]);
    const [councilStance, setCouncilStance] = useState<WfStance>(stance);
    const [councilLeft, setCouncilLeft] = useState(15);
    const timerRef = useRef<HTMLSpanElement>(null);
    const coinBlueRef = useRef<HTMLSpanElement>(null);
    const coinRedRef = useRef<HTMLSpanElement>(null);
    const scoreBlueRef = useRef<HTMLSpanElement>(null);
    const scoreRedRef = useRef<HTMLSpanElement>(null);
    const killBlueRef = useRef<HTMLSpanElement>(null);
    const killRedRef = useRef<HTMLSpanElement>(null);
    const momentumRef = useRef<HTMLDivElement>(null);
    const structsBlueRef = useRef<HTMLSpanElement>(null);
    const structsRedRef = useRef<HTMLSpanElement>(null);
    const stanceBlueRef = useRef<HTMLSpanElement>(null);
    const stanceRedRef = useRef<HTMLSpanElement>(null);
    const storyCam = useRef<WfStoryCam | null>(null);
    // MULTI-CAM WALL: one mini chase-screen per pet on YOUR team; clicking a
    // tile features that pet on the main screen (click again → broadcast).
    const [focusPetId, setFocusPetId] = useState<string | null>(null);
    // Opening VS card — a 4-second studio title before the action reads.
    const [intro, setIntro] = useState(true);
    useEffect(() => {
        if (!intro) return;
        const id = window.setTimeout(() => setIntro(false), 4200);
        return () => window.clearTimeout(id);
    }, [intro]);
    const focusPetRef = useRef<string | null>(null);
    useEffect(() => { focusPetRef.current = focusPetId; });
    const tileStatusRefs = useRef<Array<HTMLSpanElement | null>>([]);
    const tileHpRefs = useRef<Array<HTMLDivElement | null>>([]);
    const tileBoxRefs = useRef<Array<HTMLDivElement | null>>([]);
    const myPets = useMemo(
        () => result.snapshots[0].actors.filter((a) => a.team === "blue").map((a) => ({ id: a.id, name: roster.find((r) => r.id === a.id)?.pet.name ?? a.id })),
        [result, roster],
    );
    const myPetIds = useMemo(() => myPets.map((m) => m.id), [myPets]);
    const multiCamOn = quality.id !== "low" && myPetIds.length > 0;
    const tileW = Math.round(Math.min(180, Math.max(84, ((typeof window !== "undefined" ? window.innerWidth : 1200) - 20 - 3 * 8) / 4)));
    const tileH = Math.round(tileW * 0.6);

    const nameOf = useMemo(() => {
        const names = new Map(roster.map((r) => [r.id, r.pet.name]));
        return (id: string) => {
            if (names.has(id)) return names.get(id)!;
            if (id === "warden") return "the Gate Warden";
            if (id.startsWith("mini")) return "a Lesser Warden";
            if (id.startsWith("statue")) return "a Guardian Totem";
            if (id.startsWith("mob")) return "hollow-spawn";
            return id;
        };
    }, [roster]);

    const pushFeed = (text: string, color: string) => {
        const id = wfSeq++;
        setFeed((arr) => [{ id, text, color }, ...arr].slice(0, 6));
        window.setTimeout(() => setFeed((arr) => arr.filter((f) => f.id !== id)), 4500);
    };
    // Banner QUEUE: broadcast moments display SEQUENTIALLY (big ones hold the
    // screen longer) instead of stomping each other mid-animation.
    const bannerQueue = useRef<Array<{ id: number; text: string; color: string; big: boolean }>>([]);
    const bannerBusy = useRef(false);
    const pumpBanner = () => {
        const next = bannerQueue.current.shift();
        if (!next) { bannerBusy.current = false; setBanner(null); return; }
        bannerBusy.current = true;
        setBanner(next);
        window.setTimeout(pumpBanner, next.big ? 2300 : 1600);
    };
    const pushBanner = (text: string, color: string, big = false) => {
        if (bannerQueue.current.length >= 3) bannerQueue.current.shift();   // drop the stalest
        bannerQueue.current.push({ id: wfSeq++, text, color, big });
        if (!bannerBusy.current) pumpBanner();
    };
    const triggerFlash = (color: string) => {
        const id = wfSeq++;
        setFlash({ id, color });
        window.setTimeout(() => setFlash((f) => (f && f.id === id ? null : f)), 380);
    };
    const spawnFx = (x: number, z: number, key: string | null, element: string | null | undefined, scale: number, dur: number) => {
        const frames = (key ? bundledJutsuFxFrames(key) : null) ?? bundledJutsuFxFrames(elementVfxKey(element)) ?? bundledJutsuFxFrames("none");
        if (!frames) return;
        const id = wfSeq++;
        setFxList((arr) => {
            const next = [...arr, { id, frames, pos: [x, 0.8, z] as Vec3, scale, dur }];
            return next.length > 24 ? next.slice(next.length - 24) : next;   // fight-spam cap
        });
    };
    const spawnShot = (fromX: number, fromY: number, toX: number, toY: number, element: string | null | undefined, charged: boolean) => {
        const visual = projectileVisual({ element, charged });
        const dist = Math.hypot(toX - fromX, toY - fromY);
        const dur = Math.min(820, Math.max(420, 260 + dist * 24));
        const id = wfSeq++;
        setShots((arr) => {
            const next = [...arr, { id, from: [fromX, 0.9, fromY] as Vec3, to: [toX, 0.9, toY] as Vec3, visual, dur, arc: 0.28 }];
            return next.length > 16 ? next.slice(next.length - 16) : next;   // fight-spam cap
        });
    };
    const spawnFloater = (x: number, z: number, text: string, color: string, big: boolean) => {
        const id = wfSeq++;
        setFloaters((arr) => [...arr, { id, pos: [x, 1.5, z], text, color, big }]);
        window.setTimeout(() => setFloaters((arr) => arr.filter((f) => f.id !== id)), 950);
    };

    // Round boundary: interactive → pause + open the War Council; auto → advance.
    // "Latest ref" pattern: the ticker calls through the ref; the effect (not
    // render) keeps the closure fresh, which is compiler-safe.
    const boundaryBusy = useRef(false);
    const onFrontier = useRef<() => void>(() => {});
    // Council choices waiting to be applied to the STREAMED round.
    const pendingResume = useRef<{ choices: WarfrontChoice[]; stance?: WfStance } | null>(null);
    const pumpSim = useRef<() => void>(() => {});
    useEffect(() => {
        pumpSim.current = () => {
            if (ctl.done) return;
            const runway = result.snapshots.length - 1 - clock.current.t;
            if (runway > WARFRONT_TPS * 6) return;
            if (autoBuy !== "off") { ctl.advanceRoundPartial(70); return; }
            const pend = pendingResume.current;
            if (pend && ctl.advanceRoundPartial(70, pend.choices, pend.stance)) pendingResume.current = null;
            // Interactive with nothing pending: the clock reaches the frontier
            // and the War Council opens (onFrontier).
        };
    });
    useEffect(() => {
        onFrontier.current = () => {
            if (ctl.done || boundaryBusy.current || council) return;
            boundaryBusy.current = true;
            if (autoBuy === "off") {
                clock.current.playing = false;
                setCart([]);
                setCouncilStance(ctl.stances().blue);
                setCouncilLeft(15);
                setCouncil({ round: ctl.round });
            } else {
                ctl.advanceRound();
                clock.current.playing = true;
                boundaryBusy.current = false;
            }
        };
    });
    const resumeFromCouncil = (choices: WarfrontChoice[], stancePick?: WfStance) => {
        setCouncil(null);
        // Streamed, not synchronous — the pump applies these on its next call.
        pendingResume.current = { choices, stance: stancePick };
        clock.current.playing = true;
        boundaryBusy.current = false;
    };
    // Council auto-resume countdown (autobattler pacing — never blocks forever).
    // The expiry resumes from the timeout callback (async) with the LATEST cart
    // via a ref, so late shopping still counts and no effect-body setState fires.
    const cartRef = useRef<WarfrontChoice[]>([]);
    useEffect(() => { cartRef.current = cart; });
    const councilStanceRef = useRef<WfStance>(stance);
    useEffect(() => { councilStanceRef.current = councilStance; });
    useEffect(() => {
        if (!council) return;
        const id = window.setTimeout(() => {
            if (councilLeft <= 1) resumeFromCouncil(cartRef.current, councilStanceRef.current);
            else setCouncilLeft((s) => s - 1);
        }, 1000);
        return () => window.clearTimeout(id);
    }, [council, councilLeft]);

    useEffect(() => { if (ended) onResult?.(result); }, [ended]);   // eslint-disable-line react-hooks/exhaustive-deps -- fire once on the end edge

    // Preload EVERY rig the match will mount — roster, hounds, the four camp
    // bosses and both sentinel bodies. Camp bosses used to lazy-load at their
    // 90 s spawn and drop a frame spike mid-match.
    useEffect(() => {
        import("../lib/pet-model-preload")
            .then((m) => void m.preloadPetColiseumModels([
                ...roster.map((r) => r.pet),
                ...[HOLLOW_BEAST_ID, "legendary-2", "legendary-6", "legendary-10", "legendary-14", "mythic-0", "mythic-2"].map((id) => ({ id } as Pet)),
            ]))
            .catch(() => { /* best-effort */ });
    }, [roster]);

    const buyState = council ? ctl.buyState("blue") : null;
    const cartCost = useMemo(() => {
        if (!buyState) return 0;
        // Optimistic pricing: sum each cart line at its escalating price.
        const counts = new Map<string, number>();
        let total = 0;
        for (const c of cart) {
            const pet = buyState[c.petIndex];
            if (!pet) continue;
            const key = `${c.petIndex}:${c.kind}`;
            const extra = counts.get(key) ?? 0;
            const base = pet.costs[c.kind];
            let price = base;
            for (let i = 0; i < extra; i++) price = Math.round(price * 1.35 / 5) * 5;
            total += price;
            counts.set(key, extra + 1);
        }
        return total;
    }, [cart, buyState]);
    const coinsAvail = council ? ctl.coins("blue") - cartCost : 0;
    // Verdict receipts: HOW the match was decided (seal destruction vs the
    // timer's judgment on structures-then-coins), with the tallies to prove it.
    const sealBroken = ended && result.events.some((e) => e.type === "coredown");
    const winLabel = result.winner === "draw" ? "Stalemate"
        : sealBroken ? `${result.winner === "blue" ? "Blue" : "Red"} Shatters the Ward Seal`
        : `${result.winner === "blue" ? "Blue" : "Red"} Wins the Judgment`;

    // ⟲/↻/🎲 controls: Replay rewinds the clock (the director re-fires events
    // and later councils reopen on schedule); Restart rebuilds the sim on the
    // SAME seed; New match rolls a fresh deterministic seed (vs-AI/harness only).
    const resetTransient = () => {
        clock.current = { t: 0, playing: true, slow: 0 };
        storyCam.current = null;
        setFocusPetId(null);
        setIntro(true);
        pendingResume.current = null;
        shake.current = 0;
        boundaryBusy.current = false;
        setEnded(false);
        setCouncil(null);
        setCart([]);
        setCouncilLeft(15);
        setFeed([]);
        bannerQueue.current = [];
        bannerBusy.current = false;
        setBanner(null);
        setFlash(null);
        setFxList([]);
        setShots([]);
        setFloaters([]);
    };
    const doReplay = () => resetTransient();
    const doRestart = () => { setRun((r) => r + 1); resetTransient(); };
    const doNewMatch = () => { setSeedBump((b) => b + 1); setRun((r) => r + 1); resetTransient(); };

    const btn: CSSProperties = { padding: "5px 10px", background: "rgba(15,23,42,0.85)", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", cursor: "pointer", font: "700 12px Inter, system-ui, sans-serif" };

    return createPortal((
        <div style={{ position: "fixed", inset: 0, zIndex: 200, width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#05060a" }}>
            <style>{`@keyframes arenaFloat{0%{transform:translateY(4px);opacity:0}15%{opacity:1}100%{transform:translateY(-30px);opacity:0}}@keyframes wfFeedIn{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}@keyframes wfFlash{0%{opacity:0}12%{opacity:0.85}100%{opacity:0}}@keyframes wfBanner{0%{opacity:0;transform:translate(-50%,-50%) scale(0.72)}12%{opacity:1;transform:translate(-50%,-50%) scale(1.05)}22%{transform:translate(-50%,-50%) scale(1)}84%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-56%) scale(1)}}@keyframes wfShine{0%{transform:translateX(-140%) skewX(-18deg)}60%,100%{transform:translateX(260%) skewX(-18deg)}}@keyframes wfTilePulse{0%,100%{box-shadow:0 0 6px rgba(251,113,133,0.35)}50%{box-shadow:0 0 20px rgba(251,113,133,0.95)}}@keyframes wfIntro{0%{opacity:0;transform:scale(0.94)}10%{opacity:1;transform:scale(1)}82%{opacity:1}100%{opacity:0;transform:scale(1.02)}}@keyframes wfEndIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}`}</style>
            <div style={{ position: "absolute", inset: 0 }}>
                <Canvas dpr={quality.dpr} shadows={quality.id === "high" ? "percentage" : false} camera={{ fov: A3D_FOV, near: 0.5, far: 160, position: [0, 20, 24] }} gl={{ antialias: true }}>
                    <color attach="background" args={[spec.voidColor]} />
                    <fog attach="fog" args={[spec.fogColor, 26, 64]} />
                    {/* Warm key + cool fill: the warm/cool contrast that makes
                        painted environments read as LIT instead of flat. */}
                    <hemisphereLight args={[spec.skyLight, spec.groundLight, 1.15]} />
                    <directionalLight position={[-12, 10, -9]} intensity={0.5} color="#7ea8c4" />
                    {quality.dynamicPetLight && <pointLight position={[0, 2.6, 0]} color={spec.breachGlow} intensity={3.4} distance={18} decay={2} />}
                    <directionalLight
                        position={[10, 17, 7]} intensity={1.85} color={spec.sunColor} castShadow={quality.modelShadows}
                        shadow-mapSize-width={quality.id === "high" ? 2048 : 1024} shadow-mapSize-height={quality.id === "high" ? 2048 : 1024}
                        shadow-camera-left={-24} shadow-camera-right={24} shadow-camera-top={15} shadow-camera-bottom={-15} shadow-camera-far={60}
                    />
                    <WfFloor theme={theme} />
                    <WfSetDressing theme={theme} />
                    {roster.map((r) => (
                        // Always render — a pet without an approved GLB falls back
                        // to a visible placeholder inside WfFighter3D (never null).
                        <WfFighter3D key={r.id} result={result} clock={clock} id={r.id} pet={r.pet} config={configs.get(r.id) ?? null} />
                    ))}
                    <WfMobPool result={result} clock={clock} glow={spec.breachGlow} />
                    {(["blue", "red"] as const).map((team) => [0, 1].map((gi) => (
                        <WfGuardian key={`${team}g${gi}`} result={result} clock={clock} team={team} idx={gi} />
                    )))}
                    {WF_BUSHES.map(([bx, by, br], i) => (
                        <group key={`bush${i}`} position={[bx, 0, by]}>
                            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} renderOrder={-1}>
                                <circleGeometry args={[br, 22]} />
                                <meshBasicMaterial color="#1c3a1c" transparent opacity={0.65} depthWrite={false} />
                            </mesh>
                            {Array.from({ length: 8 }, (_, k) => {
                                const a = (k / 8) * Math.PI * 2 + i;
                                return (
                                    <mesh key={k} position={[Math.cos(a) * br * 0.55, 0.28, Math.sin(a) * br * 0.55]} rotation={[0, a, (k % 2 ? 0.18 : -0.18)]}>
                                        <coneGeometry args={[0.16, 0.62, 5]} />
                                        <meshStandardMaterial color="#2c5a2a" roughness={0.9} />
                                    </mesh>
                                );
                            })}
                        </group>
                    ))}
                    {(["blue", "red"] as const).map((team) => (
                        <group key={team}>
                            <WfStatue result={result} clock={clock} team={team} idx={0} />
                            <WfStatue result={result} clock={clock} team={team} idx={1} />
                            <WfCore result={result} clock={clock} team={team} />
                        </group>
                    ))}
                    <WfWarden result={result} clock={clock} />
                    {WF_PADS.map((_, i) => (
                        <WfMini key={i} result={result} clock={clock} idx={i} name={WF_MINI_NAMES[i]} glow={spec.breachGlow} />
                    ))}
                    {fxList.map((fx) => (
                        <Fx3D key={fx.id} frames={fx.frames} pos={fx.pos} scale={fx.scale} durationMs={fx.dur} onDone={() => setFxList((p) => p.filter((x) => x.id !== fx.id))} />
                    ))}
                    {shots.map((sh) => (
                        <Shot3D key={sh.id} from={sh.from} to={sh.to} visual={sh.visual} durationMs={sh.dur} arc={sh.arc} onDone={() => setShots((p) => p.filter((x) => x.id !== sh.id))} />
                    ))}
                    {floaters.map((f) => (<Floater3D key={f.id} pos={f.pos} text={f.text} color={f.color} big={f.big} />))}
                    <Sparkles count={Math.max(12, quality.ambientParticles)} scale={[42, 7, 21]} position={[0, 3, 0]} size={2} speed={0.14} opacity={0.24} color={spec.sunColor} noise={2} />
                    <WfCameraRig result={result} clock={clock} shake={shake} camViewRef={camView} camCtlRef={camCtl} storyRef={storyCam} modeRef={camModeRef} focusPetRef={focusPetRef} />
                    <WfCameraControls camCtlRef={camCtl} onModeChange={(m) => setFreeCam(m === "free")} />
                    <WfTicker result={result} clockRef={clock} shakeRef={shake} onFrontier={onFrontier} pumpRef={pumpSim} />
                    <WfDirector result={result} clockRef={clock} nameOf={nameOf} pushFeed={pushFeed} pushBanner={pushBanner} triggerFlash={triggerFlash} shakeRef={shake} spawnFx={spawnFx} spawnShot={spawnShot} spawnFloater={spawnFloater} storyRef={storyCam} camViewRef={camView} onEnd={() => setEnded(true)} />
                    <WfHudWriter result={result} clock={clock} timerRef={timerRef} coinBlueRef={coinBlueRef} coinRedRef={coinRedRef} scoreBlueRef={scoreBlueRef} scoreRedRef={scoreRedRef} killBlueRef={killBlueRef} killRedRef={killRedRef} momentumRef={momentumRef} structsBlueRef={structsBlueRef} structsRedRef={structsRedRef} stanceBlueRef={stanceBlueRef} stanceRedRef={stanceRedRef} />
                    {multiCamOn && <WfMultiCam result={result} clock={clock} petIds={myPetIds} tileW={tileW} tileH={tileH} margin={10} gap={8} statusRefs={tileStatusRefs} hpRefs={tileHpRefs} tileRefs={tileBoxRefs} selectedRef={focusPetRef} camViewRef={camView} />}
                </Canvas>
            </div>

            {/* Opening VS card — team lineups + declared formations. */}
            {intro && (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "radial-gradient(ellipse at center, rgba(3,6,14,0.55) 30%, rgba(3,6,14,0.9) 100%)", zIndex: 58, pointerEvents: "none", animation: "wfIntro 4.2s ease-in-out forwards" }}>
                    <div style={{ textAlign: "center" }}>
                        <div style={{ color: "#d8b4fe", font: "900 15px Inter, system-ui, sans-serif", letterSpacing: 6 }}>HOLLOW WARFRONT</div>
                        <div style={{ color: "#64748b", font: "700 11px Inter, system-ui, sans-serif", letterSpacing: 2, marginTop: 2 }}>{spec.label.toUpperCase()} · BREAK THE WARD SEAL</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 26, marginTop: 18 }}>
                            <div style={{ textAlign: "right" }}>
                                {result.snapshots[0].actors.filter((a) => a.team === "blue").map((a) => (
                                    <div key={a.id} style={{ color: "#93c5fd", font: "800 15px Inter, system-ui, sans-serif", textShadow: "0 2px 8px #000" }}>{roster.find((r) => r.id === a.id)?.pet.name ?? a.id} <span style={{ color: "#475569", fontSize: 10 }}>{ROLE_TAG[a.role] ?? ""}</span></div>
                                ))}
                                <div style={{ color: "#60a5fa", font: "700 11px Inter, system-ui, sans-serif", marginTop: 6 }}>{WF_STANCES.find((st2) => st2.id === result.snapshots[0].stances.blue)?.icon} {WF_STANCES.find((st2) => st2.id === result.snapshots[0].stances.blue)?.label}</div>
                            </div>
                            <div style={{ color: "#fde047", font: "900 34px Inter, system-ui, sans-serif", textShadow: "0 0 24px rgba(250,204,21,0.5)" }}>VS</div>
                            <div style={{ textAlign: "left" }}>
                                {result.snapshots[0].actors.filter((a) => a.team === "red").map((a) => (
                                    <div key={a.id} style={{ color: "#fca5a5", font: "800 15px Inter, system-ui, sans-serif", textShadow: "0 2px 8px #000" }}><span style={{ color: "#475569", fontSize: 10 }}>{ROLE_TAG[a.role] ?? ""}</span> {roster.find((r) => r.id === a.id)?.pet.name ?? a.id}</div>
                                ))}
                                <div style={{ color: "#f87171", font: "700 11px Inter, system-ui, sans-serif", marginTop: 6 }}>{WF_STANCES.find((st2) => st2.id === result.snapshots[0].stances.red)?.icon} {WF_STANCES.find((st2) => st2.id === result.snapshots[0].stances.red)?.label}</div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* Broadcast vignette — pulls the eye to the action and hides the
                hard viewport edge; pure CSS, zero render cost. */}
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse at center, transparent 54%, rgba(2,4,10,0.42) 100%)" }} />
            {flash && <div key={flash.id} style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at center, transparent 38%, ${flash.color} 100%)`, pointerEvents: "none", animation: "wfFlash 0.4s ease-out forwards", mixBlendMode: "screen" }} />}
            {/* Broadcast ribbon banner: dark gradient bar, team-color hairlines,
                a shine sweep, queued display (big moments sit higher + longer). */}
            {banner && (
                <div key={banner.id} style={{ position: "absolute", top: banner.big ? "26%" : "16%", left: "50%", transform: "translate(-50%,-50%)", pointerEvents: "none", animation: `wfBanner ${banner.big ? 2.3 : 1.6}s cubic-bezier(.2,.8,.2,1) forwards`, maxWidth: "96vw" }}>
                    <div style={{ position: "relative", overflow: "hidden", padding: banner.big ? "12px 58px" : "7px 38px", background: "linear-gradient(90deg, transparent 0%, rgba(6,9,20,0.92) 13%, rgba(6,9,20,0.92) 87%, transparent 100%)" }}>
                        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 1, background: `linear-gradient(90deg, transparent, ${banner.color}, transparent)` }} />
                        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1, background: `linear-gradient(90deg, transparent, ${banner.color}, transparent)` }} />
                        <div style={{ color: banner.color, font: `900 ${banner.big ? 40 : 24}px Inter, system-ui, sans-serif`, letterSpacing: banner.big ? 3 : 2, textShadow: "0 2px 18px #000, 0 0 30px currentColor", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "center" }}>{banner.text}</div>
                        <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "38%", background: "linear-gradient(105deg, transparent, rgba(255,255,255,0.16), transparent)", animation: "wfShine 1.25s ease-out forwards" }} />
                    </div>
                </div>
            )}

            {/* Top bar: exit · replay/restart · timer · coins · mode badge */}
            <div style={{ position: "absolute", top: 10, left: 12, display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={onExit} style={btn}>✕ Exit</button>
                <button onClick={doReplay} style={btn} title="Rewatch this match from the start">⟲ Replay</button>
                <button onClick={doRestart} style={btn} title="Fresh match, same seed">↻ Restart</button>
                {allowReseed && <button onClick={doNewMatch} style={btn} title="Fresh match, new seed">🎲 New match</button>}
            </div>
            {/* SCORE STRIP — the win condition at a glance: ⛩ points (statues +
                seal broken, the exact timer-verdict formula), kills, coins, and
                the momentum bar underneath. */}
            <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", display: "grid", gap: 4, justifyItems: "center", padding: "6px 16px 7px", background: "rgba(8,12,24,0.82)", border: "1px solid rgba(148,163,184,0.4)", borderRadius: 14, font: "800 14px Inter, system-ui, sans-serif" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, whiteSpace: "nowrap" }}>
                    <span ref={stanceBlueRef} style={{ fontSize: 13 }} />
                    <span style={{ color: "#93c5fd" }} title="Structures broken (statues + Ward Seal) — how this mode is won">⛩ <span ref={scoreBlueRef}>0</span></span>
                    <span style={{ color: "#93c5fd", fontSize: 12 }} title="Kills">⚔ <span ref={killBlueRef}>0</span></span>
                    <span style={{ color: "#60a5fa", fontSize: 12 }}>🪙 <span ref={coinBlueRef}>0</span></span>
                    <span ref={timerRef} style={{ color: "#e2e8f0", fontSize: 13, padding: "0 4px" }}>7:00</span>
                    <span style={{ color: "#fca5a5", fontSize: 12 }}><span ref={coinRedRef}>0</span> 🪙</span>
                    <span style={{ color: "#fca5a5", fontSize: 12 }} title="Kills"><span ref={killRedRef}>0</span> ⚔</span>
                    <span style={{ color: "#fca5a5" }} title="Structures broken (statues + Ward Seal) — how this mode is won"><span ref={scoreRedRef}>0</span> ⛩</span>
                    <span ref={stanceRedRef} style={{ fontSize: 13 }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span ref={structsBlueRef} title="Blue's remaining sentinels · totems · Ward Seal" style={{ fontSize: 9, letterSpacing: 1, opacity: 0.9 }} />
                    <div title="Momentum — structure damage, points, kills and gold" style={{ position: "relative", width: 250, height: 5, borderRadius: 4, background: "#7f1d1d", overflow: "hidden", border: "1px solid rgba(0,0,0,0.6)" }}>
                        <div ref={momentumRef} style={{ position: "absolute", left: 0, top: 0, height: "100%", width: "50%", background: "linear-gradient(90deg,#1d4ed8,#60a5fa)", transition: "width 0.4s ease" }} />
                        <div style={{ position: "absolute", left: "50%", top: 0, width: 1, height: "100%", background: "rgba(255,255,255,0.55)" }} />
                    </div>
                    <span ref={structsRedRef} title="Red's remaining Ward Seal · totems · sentinels" style={{ fontSize: 9, letterSpacing: 1, opacity: 0.9 }} />
                </div>
            </div>
            <div style={{ position: "absolute", top: 10, right: 12, padding: "4px 10px", background: "rgba(15,23,42,0.85)", border: "1px solid rgba(168,85,247,0.6)", borderRadius: 999, color: "#d8b4fe", font: "700 11px Inter, system-ui, sans-serif" }}>⛩ Hollow Warfront · {spec.label} (beta)</div>
            {/* Camera modes: 📺 director's broadcast · 🎬 calm wide · 🛡 my team. */}
            <div style={{ position: "absolute", top: 42, left: 12, display: "flex", gap: 4 }}>
                {([
                    ["broadcast", "📺", "Broadcast — the director chases fights, kills and objectives"],
                    ["calm", "🎬", "Calm — wide and steady; only the big objective moments cut"],
                    ["team", "🛡", "My Team — stay locked on your squad"],
                ] as const).map(([id, icon, tip]) => (
                    <button
                        key={id}
                        onClick={() => { setCamMode(id); setFocusPetId(null); camCtl.current.mode = "follow"; setFreeCam(false); }}
                        title={tip}
                        style={{ padding: "3px 9px", background: camMode === id && !freeCam ? "rgba(109,40,217,0.9)" : "rgba(15,23,42,0.85)", border: `1px solid ${camMode === id && !freeCam ? "#a78bfa" : "#334155"}`, borderRadius: 999, color: camMode === id && !freeCam ? "#fff" : "#94a3b8", cursor: "pointer", font: "700 12px Inter, system-ui, sans-serif" }}
                    >{icon}</button>
                ))}
            </div>
            {freeCam && (
                <button
                    onClick={() => { camCtl.current.mode = "follow"; setFreeCam(false); }}
                    style={{ position: "absolute", top: 74, left: 12, padding: "4px 10px", background: "rgba(109,40,217,0.9)", border: "1px solid #a78bfa", borderRadius: 999, color: "#fff", cursor: "pointer", font: "700 11px Inter, system-ui, sans-serif" }}
                >📍 Free cam — tap to follow</button>
            )}

            {/* Kill feed + minimap (right column) */}
            <div style={{ position: "absolute", top: 46, right: 12, display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", pointerEvents: "none" }}>
                <WfMinimap result={result} clock={clock} theme={theme} camViewRef={camView} camCtlRef={camCtl} onModeChange={(m) => setFreeCam(m === "free")} />
                {feed.map((f) => (<div key={f.id} style={{ padding: "3px 9px", background: "rgba(8,12,24,0.82)", border: `1px solid ${f.color}66`, borderRadius: 6, color: f.color, font: "700 11px Inter, system-ui, sans-serif", animation: "wfFeedIn 0.2s ease-out", maxWidth: "44vw", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.text}</div>))}
            </div>

            {/* MULTI-CAM WALL — one screen per pet; click to feature it. */}
            {multiCamOn && (
                <div style={{ position: "absolute", left: 10, bottom: 10, display: "flex", gap: 8, zIndex: 55 }}>
                    {myPets.map((mp, i) => (
                        <div
                            key={mp.id}
                            ref={(el) => { tileBoxRefs.current[i] = el; }}
                            onClick={() => setFocusPetId((cur) => (cur === mp.id ? null : mp.id))}
                            title={focusPetId === mp.id ? "Swap back — broadcast returns to the main screen" : `Feature ${mp.name} on the main screen (the broadcast moves here)`}
                            style={{ position: "relative", width: tileW, height: tileH, border: `2px solid ${focusPetId === mp.id ? "#fbbf24" : "rgba(96,165,250,0.5)"}`, borderRadius: 10, cursor: "pointer", overflow: "hidden", boxShadow: focusPetId === mp.id ? "0 0 16px rgba(251,191,36,0.45)" : "0 4px 18px rgba(0,0,0,0.5)" }}
                        >
                            <div style={{ position: "absolute", left: 0, right: 0, top: 0, padding: "2px 7px", background: "linear-gradient(rgba(5,8,16,0.85), transparent)", color: focusPetId === mp.id ? "#fde047" : "#93c5fd", font: "700 10px Inter, system-ui, sans-serif", display: "flex", justifyContent: "space-between", pointerEvents: "none" }}>
                                <span>{focusPetId === mp.id ? "📺 Broadcast" : `📷 ${mp.name}`}</span>
                                <span ref={(el) => { tileStatusRefs.current[i] = el; }} style={{ color: "#fca5a5" }} />
                            </div>
                            {/* Squad-health strip — the wall doubles as team frames. */}
                            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 4, background: "rgba(5,8,16,0.75)", pointerEvents: "none" }}>
                                <div ref={(el) => { tileHpRefs.current[i] = el; }} style={{ height: "100%", width: "100%", background: "#60a5fa" }} />
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* WAR COUNCIL — the 30 s buy popup */}
            {council && buyState && (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(3,7,18,0.6)", zIndex: 60 }}>
                    <div style={{ width: "min(860px, 96vw)", maxHeight: "86vh", overflowY: "auto", background: "rgba(10,14,28,0.97)", border: "1px solid rgba(168,85,247,0.5)", borderRadius: 14, padding: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                            <div style={{ color: "#d8b4fe", font: "900 16px Inter, system-ui, sans-serif" }}>📯 War Council — round {council.round}</div>
                            <div style={{ color: "#fde047", font: "800 14px Inter, system-ui, sans-serif" }}>🪙 {coinsAvail}</div>
                        </div>
                        <div style={{ color: "#94a3b8", font: "600 11px Inter, system-ui, sans-serif", marginBottom: 10 }}>Spend the squad's coins on small edges — the council convenes every 90s of battle. Resuming in {councilLeft}s.</div>
                        {/* FORMATION — the team's stance for the rounds ahead. */}
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "6px 4px 10px", borderBottom: "1px solid rgba(51,65,85,0.6)", marginBottom: 6 }}>
                            <div style={{ color: "#e2e8f0", font: "800 12px Inter, system-ui, sans-serif", minWidth: 110 }}>📜 Formation</div>
                            {WF_STANCES.map((s) => (
                                <button
                                    key={s.id}
                                    onClick={() => setCouncilStance(s.id)}
                                    title={s.desc}
                                    style={{ display: "grid", gap: 1, minWidth: 118, textAlign: "left", padding: "5px 8px", borderRadius: 8, border: `1px solid ${councilStance === s.id ? "#6ee7b7" : "#334155"}`, background: councilStance === s.id ? "rgba(16,185,129,0.16)" : "#111827", color: councilStance === s.id ? "#d1fae5" : "#94a3b8", cursor: "pointer", font: "700 11px Inter, system-ui, sans-serif" }}
                                >
                                    <span>{s.icon} {s.label}</span>
                                    <span style={{ font: "600 9px Inter, system-ui, sans-serif", color: councilStance === s.id ? "#a7f3d0" : "#64748b" }}>{s.desc}</span>
                                </button>
                            ))}
                        </div>
                        {buyState.map((pet, pi) => (
                            <div key={pet.petId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", borderTop: "1px solid rgba(51,65,85,0.6)", flexWrap: "wrap" }}>
                                <div style={{ minWidth: 110, color: "#e2e8f0", font: "700 12px Inter, system-ui, sans-serif" }}>{pet.petName}</div>
                                {WF_POWERUPS.map((pu) => {
                                    const inCart = cart.filter((c) => c.petIndex === pi && c.kind === pu.kind).length;
                                    const stacks = pet.stacks[pu.kind] + inCart;
                                    let price = pet.costs[pu.kind];
                                    for (let i = 0; i < inCart; i++) price = Math.round(price * 1.35 / 5) * 5;
                                    const capped = stacks >= WF_STACK_CAP;
                                    const afford = coinsAvail >= price;
                                    return (
                                        <button
                                            key={pu.kind}
                                            disabled={capped || !afford}
                                            onClick={() => setCart((c) => [...c, { petIndex: pi, kind: pu.kind }])}
                                            style={{ display: "grid", gap: 1, minWidth: 108, textAlign: "left", padding: "5px 8px", borderRadius: 8, border: `1px solid ${capped ? "#334155" : afford ? "#7c3aed" : "#334155"}`, background: capped ? "#111827" : afford ? "rgba(124,58,237,0.18)" : "#111827", color: capped ? "#475569" : afford ? "#e9d5ff" : "#64748b", cursor: capped || !afford ? "default" : "pointer", font: "700 11px Inter, system-ui, sans-serif" }}
                                        >
                                            <span>{pu.icon} {pu.label}</span>
                                            <span style={{ font: "600 10px Inter, system-ui, sans-serif", color: capped ? "#475569" : "#a5b4fc" }}>{pu.desc}</span>
                                            <span style={{ font: "700 10px Inter, system-ui, sans-serif", color: capped ? "#64748b" : "#fde047" }}>{stacks}/{WF_STACK_CAP} owned · {capped ? "MAX" : `🪙${price}`}{inCart > 0 ? ` · +${inCart} in cart` : ""}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        ))}
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, gap: 8 }}>
                            <button onClick={() => setCart([])} style={{ ...btn, opacity: cart.length ? 1 : 0.5 }}>Clear ({cart.length})</button>
                            <button onClick={() => resumeFromCouncil(cart, councilStance)} style={{ ...btn, background: "#6d28d9", border: "1px solid #a78bfa" }}>⚔ Resume battle ({councilLeft}s)</button>
                        </div>
                    </div>
                </div>
            )}

            {ended && (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(3,7,18,0.55)", zIndex: 70 }}>
                    <div style={{ textAlign: "center", animation: "wfEndIn 0.5s ease-out" }}>
                        <div style={{ font: "900 34px Inter, system-ui, sans-serif", color: result.winner === "blue" ? "#60a5fa" : result.winner === "red" ? "#f87171" : "#facc15", textShadow: "0 2px 12px #000" }}>{winLabel}</div>
                        {(() => {
                            const last = result.snapshots[result.snapshots.length - 1];
                            const score = wfVerdictScore(last);
                            let kb = 0, kr = 0;
                            for (const e of result.events) if (e.type === "kill") { if (e.team === "blue") kb++; else kr++; }
                            const sb = last.guardians.red.filter((g) => !g.alive).length;
                            const sr = last.guardians.blue.filter((g) => !g.alive).length;
                            return (
                                <div style={{ marginTop: 6, display: "grid", gap: 2 }}>
                                    <div style={{ color: "#e2e8f0", font: "800 14px Inter, system-ui, sans-serif" }}>
                                        ⛩ Points <span style={{ color: "#93c5fd" }}>{score.blue}</span> — <span style={{ color: "#fca5a5" }}>{score.red}</span>
                                        <span style={{ color: "#64748b" }}> · </span>⚔ Kills <span style={{ color: "#93c5fd" }}>{kb}</span> — <span style={{ color: "#fca5a5" }}>{kr}</span>
                                        <span style={{ color: "#64748b" }}> · </span>🛡 Sentinels <span style={{ color: "#93c5fd" }}>{sb}</span> — <span style={{ color: "#fca5a5" }}>{sr}</span>
                                        <span style={{ color: "#64748b" }}> · </span>🪙 <span style={{ color: "#93c5fd" }}>{result.coins.blue}</span> — <span style={{ color: "#fca5a5" }}>{result.coins.red}</span>
                                    </div>
                                    <div style={{ color: "#64748b", font: "600 11px Inter, system-ui, sans-serif" }}>
                                        {sealBroken ? "Victory by Ward Seal destruction" : "Timer verdict — points (statues + seal broken), then coins"}
                                    </div>
                                </div>
                            );
                        })()}
                        {result.petStats && (() => {
                            const rows = [...result.petStats].sort((a, b) => b.dmg - a.dmg);
                            const mvp = rows[0]?.id;
                            return (
                                <div style={{ margin: "12px auto 0", maxWidth: 460, background: "rgba(8,12,24,0.85)", border: "1px solid rgba(148,163,184,0.35)", borderRadius: 10, padding: "8px 10px", textAlign: "left" }}>
                                    <div style={{ display: "grid", gridTemplateColumns: "1.6fr 0.55fr 0.5fr 0.5fr 0.85fr 0.85fr", gap: 4, font: "800 10px Inter, system-ui, sans-serif", color: "#64748b", padding: "0 2px 4px" }}>
                                        <span>PET</span><span>LV</span><span>K</span><span>A</span><span>DMG</span><span>🪙</span>
                                    </div>
                                    {rows.map((r) => (
                                        <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1.6fr 0.55fr 0.5fr 0.5fr 0.85fr 0.85fr", gap: 4, font: "700 12px Inter, system-ui, sans-serif", color: r.team === "blue" ? "#93c5fd" : "#fca5a5", padding: "2px" }}>
                                            <span>{r.id === mvp ? "👑 " : ""}{r.name}</span>
                                            <span>★{r.level}</span>
                                            <span>{r.kills}</span>
                                            <span>{r.assists ?? 0}</span>
                                            <span>{r.dmg}</span>
                                            <span>{r.coins}</span>
                                        </div>
                                    ))}
                                </div>
                            );
                        })()}
                        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14 }}>
                            <button onClick={doReplay} style={{ ...btn, padding: "8px 14px" }}>⟲ Replay</button>
                            <button onClick={doRestart} style={{ ...btn, padding: "8px 14px" }}>↻ Restart</button>
                            {allowReseed && <button onClick={doNewMatch} style={{ ...btn, background: "#6d28d9", border: "1px solid #a78bfa", padding: "8px 14px" }}>🎲 New match</button>}
                            <button onClick={onExit} style={{ ...btn, background: "#1e3a8a", border: "1px solid #3b82f6", padding: "8px 14px" }}>Exit</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    ), document.body);
}
