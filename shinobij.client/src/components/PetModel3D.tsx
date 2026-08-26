import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { petVictoryArcHeight, type PetCombatModelConfig } from "../lib/pet-3d-models";
import { petVisualQuality, type PetVisualQualityConfig } from "../lib/pet-visual-quality";
import { PetIdentityEffects3D } from "./PetIdentityEffects3D";
import { bindPetAtlasTexture, copyPetAtlasSampling, lockPetAtlas } from "../lib/pet-atlas-material";
import { readPetGlbAtlas } from "../lib/pet-glb-atlas";
import { attackClipWindow, motionOwnsLocomotion, petDeathChoreography, resolveCombatBodyFacing, resolveCombatBodyYaw } from "../lib/pet-combat-performance";
import { petHeroBodyPose, type PetHeroMoveStyle } from "../lib/pet-hero-moves";
import { stablePetModelPresentationBounds } from "../lib/pet-model-bounds";
import type { PetModelSurfaceTreatment } from "../lib/pet-model-surface";
import type { PetSignaturePerformance } from "../lib/pet-signature-performance";

export type PetModelMotion =
    | "idle"
    | "run"
    | "dash"
    | "windup"
    | "strike"
    | "recover"
    | "stagger"
    | "dodge"
    | "guard"
    | "rest"
    | "dead";

export type PetModelFrame = {
    motion: PetModelMotion;
    moving: boolean;
    speed: number;
    moveX: number;
    moveZ: number;
    faceX: number;
    faceZ: number;
    /** Keep the model's corrected visible-forward axis on faceX/faceZ even while
     * locomotion is active. Duel fighters use this to circle without turning
     * their backs on one another; open-arena actors may still face travel. */
    lockTargetFacing?: boolean;
    hit: number;
    /** Damage-aware reaction weight. Coliseum supplies roughly 0.48–1.25;
     * other callers may omit it and receive the restrained default. */
    impactPower?: number;
    casting: boolean;
    desperate: boolean;
    statuses: readonly string[];
    victorious?: boolean;
    /** Named-move body language. The combat state still owns timing; this only
     * selects species-specific posing inside that state. */
    moveStyle?: PetHeroMoveStyle;
    moveName?: string;
    /** Attack-take pacing multiplier for windup/strike/recover playback —
     * jabs snap (>1), heavies grind (<1), signatures crawl majestically
     * through their long beat. Omit for the neutral authored pacing. */
    attackPace?: number;
    /** Stable 0..2 take chosen from pet identity. Species pose remains the
     * foundation; this changes cadence and silhouette accents so two members
     * of the same family do not perform as clones. */
    performanceVariant?: 0 | 1 | 2;
    /** Full species identity direction. Unlike performanceVariant's three
     * alternate takes, this is unique to the pet and also drives its asset
     * cadence, balance, entrance, celebration and signature VFX. */
    signature?: PetSignaturePerformance;
    /** 0..1 opening entrance phrase, supplied after the VS card clears. */
    entranceProgress?: number;
    /** Optional presentation time in seconds. Coliseum combat supplies its
     * slowed/hit-stopped clock so skeletal clips cannot outrun the fight. */
    timeline?: number;
};

// eslint-disable-next-line react-refresh/only-export-components -- shared immutable frame seed used by both Coliseum renderers.
export const DEFAULT_PET_MODEL_FRAME: PetModelFrame = {
    motion: "idle",
    moving: false,
    speed: 0,
    moveX: 1,
    moveZ: 0,
    faceX: 1,
    faceZ: 0,
    lockTargetFacing: false,
    hit: 0,
    impactPower: 0.55,
    casting: false,
    desperate: false,
    statuses: [],
    victorious: false,
    moveStyle: "generic",
    moveName: undefined,
    performanceVariant: 0,
    signature: undefined,
    entranceProgress: undefined,
    timeline: undefined,
};

type DeformUniforms = {
    lean: { value: number };
    stride: { value: number };
    twist: { value: number };
    time: { value: number };
    minY: { value: number };
    invH: { value: number };
    lowTint: { value: THREE.Color };
    highTint: { value: THREE.Color };
    tintStrength: { value: number };
    tintBlend: { value: number };
    clipLow: { value: number };
    floorCut: { value: number };
    floorOutline: { value: number };
    swim: { value: number };
};

type PreparedModel = {
    surface: THREE.Group;
    outline: THREE.Group | null;
    offset: [number, number, number];
    scale: number;
    materials: THREE.Material[];
    uniforms: DeformUniforms[];
    clips: readonly THREE.AnimationClip[];
};

const ELEMENT_LIGHT: Record<string, string> = {
    Fire: "#ff6a2c",
    Water: "#38bdf8",
    Wind: "#5eead4",
    Lightning: "#fde047",
    Earth: "#d6a76a",
    Shadow: "#a855f7",   // hollow/void creatures (Warfront hollow-spawn, Shadow-nature pets)
};

const ELEMENT_SURFACE: Record<string, { low: string; high: string; strength: number }> = {
    Fire: { low: "#651a35", high: "#ff8a45", strength: 0.44 },
    Water: { low: "#0a526a", high: "#c8f5f4", strength: 0.5 },
    Wind: { low: "#397c70", high: "#d0fff2", strength: 0.38 },
    Lightning: { low: "#675516", high: "#fff1a8", strength: 0.4 },
    Earth: { low: "#9a7950", high: "#d6ad79", strength: 0.65 },
    Shadow: { low: "#1b1030", high: "#a855f7", strength: 0.62 },   // hollow-gate void scheme
};

let combatToonGradient: THREE.DataTexture | null = null;
function toonGradient(): THREE.DataTexture {
    if (combatToonGradient) return combatToonGradient;
    // Four hard lighting steps: ink shadow, local colour, lit colour, highlight.
    const data = new Uint8Array([48, 112, 184, 255]);
    const texture = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    combatToonGradient = texture;
    return texture;
}

function cloneAsCombatToon(source: THREE.Material): THREE.Material {
    const pbr = source as THREE.MeshStandardMaterial;
    if (!pbr.isMeshStandardMaterial) return source.clone();
    const toon = new THREE.MeshToonMaterial({
        name: source.name,
        color: pbr.color.clone(),
        map: pbr.map,
        gradientMap: toonGradient(),
        normalMap: pbr.normalMap,
        normalScale: pbr.normalScale?.clone(),
        bumpMap: pbr.bumpMap,
        bumpScale: pbr.bumpScale,
        displacementMap: pbr.displacementMap,
        displacementScale: pbr.displacementScale,
        displacementBias: pbr.displacementBias,
        emissive: pbr.emissive?.clone?.() ?? new THREE.Color("#000000"),
        emissiveMap: pbr.emissiveMap,
        transparent: pbr.transparent,
        opacity: pbr.opacity,
        alphaTest: pbr.alphaTest,
        side: pbr.side,
        vertexColors: pbr.vertexColors,
    });
    toon.name = source.name;
    return toon;
}

function smoothAngle(from: number, to: number, amount: number): number {
    let delta = (to - from + Math.PI) % (Math.PI * 2) - Math.PI;
    if (delta < -Math.PI) delta += Math.PI * 2;
    return from + delta * amount;
}

function patchDeformation(material: THREE.Material, minY: number, height: number, uniforms: DeformUniforms[], clipLow = 0, floorCut = 0, floorOutline = false) {
    const pbrSurface = (material as THREE.MeshStandardMaterial).isMeshStandardMaterial === true;
    const toonSurface = (material as THREE.MeshToonMaterial).isMeshToonMaterial === true;
    const animeSurface = pbrSurface || toonSurface;
    const bank: DeformUniforms = {
        lean: { value: 0 },
        stride: { value: 0 },
        twist: { value: 0 },
        time: { value: 0 },
        minY: { value: minY },
        invH: { value: 1 / Math.max(0.001, height) },
        lowTint: { value: new THREE.Color("#ffffff") },
        highTint: { value: new THREE.Color("#ffffff") },
        tintStrength: { value: 0 },
        tintBlend: { value: 0 },
        clipLow: { value: clipLow },
        floorCut: { value: floorCut },
        floorOutline: { value: floorOutline ? 1 : 0 },
        swim: { value: 0 },
    };
    uniforms.push(bank);
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uPetLean = bank.lean;
        shader.uniforms.uPetStride = bank.stride;
        shader.uniforms.uPetTwist = bank.twist;
        shader.uniforms.uPetTime = bank.time;
        shader.uniforms.uPetMinY = bank.minY;
        shader.uniforms.uPetInvH = bank.invH;
        shader.uniforms.uPetLowTint = bank.lowTint;
        shader.uniforms.uPetHighTint = bank.highTint;
        shader.uniforms.uPetTintStrength = bank.tintStrength;
        shader.uniforms.uPetTintBlend = bank.tintBlend;
        shader.uniforms.uPetClipLow = bank.clipLow;
        shader.uniforms.uPetFloorCut = bank.floorCut;
        shader.uniforms.uPetFloorOutline = bank.floorOutline;
        shader.uniforms.uPetSwim = bank.swim;
        shader.vertexShader = shader.vertexShader
            .replace(
                "#include <common>",
                "uniform float uPetLean,uPetStride,uPetTwist,uPetSwim,uPetTime,uPetMinY,uPetInvH;\nvarying float vPetHeight;\n#include <common>",
            )
            .replace(
                "#include <begin_vertex>",
                "#include <begin_vertex>\nfloat petH=clamp((position.y-uPetMinY)*uPetInvH,0.0,1.0);\nvPetHeight=petH;\ntransformed.z += uPetLean*petH*petH;\ntransformed.x += sin(petH*4.5-uPetTime*7.0)*uPetTwist*petH;\nfloat petTail=smoothstep(0.14,0.88,-position.y);\ntransformed.x += sin(uPetTime*6.2+position.y*7.2)*uPetSwim*petTail;\ntransformed.z += sin(uPetTime*5.1+position.y*5.6)*uPetSwim*petTail*0.22;\ntransformed.y += sin(position.x*2.2+uPetTime*10.0)*uPetStride*(1.0-petH)*0.35;",
            );
        shader.fragmentShader = shader.fragmentShader
            .replace(
                "#include <common>",
                "uniform vec3 uPetLowTint,uPetHighTint;\nuniform float uPetTintStrength,uPetTintBlend,uPetClipLow,uPetFloorCut,uPetFloorOutline;\nvarying float vPetHeight;\n#include <common>",
            )
            .replace(
                "#include <color_fragment>",
                "#include <color_fragment>\nif(vPetHeight<uPetClipLow) discard;\nif(uPetFloorCut>0.0&&vPetHeight<uPetFloorCut&&(uPetFloorOutline>0.5||min(min(diffuseColor.r,diffuseColor.g),diffuseColor.b)>0.58)) discard;\nvec3 petSurfaceTint=mix(uPetLowTint,uPetHighTint,smoothstep(0.08,0.92,vPetHeight));\nvec3 petMultiplied=diffuseColor.rgb*petSurfaceTint;\nfloat petBaseLuma=max(0.08,dot(diffuseColor.rgb,vec3(0.2126,0.7152,0.0722)));\nvec3 petRecolored=petSurfaceTint*petBaseLuma;\nvec3 petTreated=mix(petMultiplied,petRecolored,uPetTintBlend);\ndiffuseColor.rgb=mix(diffuseColor.rgb,petTreated,uPetTintStrength);",
            );
        if (pbrSurface) {
            shader.fragmentShader = shader.fragmentShader.replace(
                "#include <opaque_fragment>",
                [
                    "// Three restrained light bands + a thin colour rim give the imported",
                    "// PBR asset an anime finish without painting over its texture detail.",
                    "float petLuma=max(0.001,dot(outgoingLight,vec3(0.2126,0.7152,0.0722)));",
                    "float petBand=petLuma<0.24?0.23:(petLuma<0.52?0.45:(petLuma<0.82?0.72:0.98));",
                    "float petBandRatio=clamp(petBand/petLuma,0.76,1.34);",
                    "outgoingLight*=mix(1.0,petBandRatio,0.72);",
                    "float petGrey=dot(outgoingLight,vec3(0.3333));",
                    "outgoingLight=mix(vec3(petGrey),outgoingLight,1.18);",
                    "outgoingLight+=diffuseColor.rgb*0.055;",
                    "float petInk=smoothstep(0.58,0.92,1.0-saturate(dot(geometryNormal,geometryViewDir)));",
                    "outgoingLight*=mix(1.0,0.72,petInk*0.42);",
                    "float petRim=pow(1.0-saturate(dot(geometryNormal,geometryViewDir)),3.0);",
                    "outgoingLight+=diffuseColor.rgb*petRim*0.15;",
                    "#include <opaque_fragment>",
                ].join("\n"),
            );
        } else if (toonSurface) {
            shader.fragmentShader = shader.fragmentShader.replace(
                "#include <opaque_fragment>",
                [
                    "// The light steps come from MeshToonMaterial's nearest-filtered gradient.",
                    "// Saturation, a restrained ink terminator and colour rim finish the cel pass.",
                    "float petGrey=dot(outgoingLight,vec3(0.3333));",
                    "outgoingLight=mix(vec3(petGrey),outgoingLight,1.22);",
                    "outgoingLight+=diffuseColor.rgb*0.045;",
                    "float petInk=smoothstep(0.62,0.94,1.0-saturate(dot(geometryNormal,geometryViewDir)));",
                    "outgoingLight*=mix(1.0,0.78,petInk*0.34);",
                    "float petRim=pow(1.0-saturate(dot(geometryNormal,geometryViewDir)),3.2);",
                    "outgoingLight+=diffuseColor.rgb*petRim*0.12;",
                    "#include <opaque_fragment>",
                ].join("\n"),
            );
        }
    };
    material.customProgramCacheKey = () => toonSurface ? "pet-combat-toon-v3" : animeSurface ? "pet-combat-anime-v7" : "pet-combat-deform-v5";
    material.needsUpdate = true;
}

function stylizeApprovedRig(root: THREE.Group, config: PetCombatModelConfig) {
    if (!config.visualId.startsWith("starter-fire")) return;
    const scaleNode = (name: string, x: number, y = x, z = x) => {
        const node = root.getObjectByName(name);
        if (node) node.scale.set(x, y, z);
    };
    // Controlled anime exaggeration on the real skeleton: a more expressive head,
    // readable paws and a fuller flame-tail base. These stay part of the authored
    // animation hierarchy instead of floating as replacement geometry.
    scaleNode("Head", 1.38, 1.31, 1.32);
    scaleNode("Ear1.L", 1.14, 1.24, 1.14);
    scaleNode("Ear1.R", 1.14, 1.24, 1.14);
    scaleNode("FrontShoulder.L", 1.14, 1.02, 1.14);
    scaleNode("FrontShoulder.R", 1.14, 1.02, 1.14);
    scaleNode("BackShoulder.L", 1.12, 1.01, 1.12);
    scaleNode("BackShoulder.R", 1.12, 1.01, 1.12);
    scaleNode("FrontLowerLeg.L", 1.3, 0.98, 1.3);
    scaleNode("FrontLowerLeg.R", 1.3, 0.98, 1.3);
    scaleNode("BackLowerLeg.L", 1.26, 0.98, 1.26);
    scaleNode("BackLowerLeg.R", 1.26, 0.98, 1.26);
    scaleNode("Tail1", 1.31, 1.09, 1.31);
}

function prepareModel(
    source: THREE.Group,
    config: PetCombatModelConfig,
    clips: readonly THREE.AnimationClip[],
    quality: PetVisualQualityConfig,
    element?: string,
    persistentAtlas?: THREE.Texture | null,
    surfaceTreatment?: PetModelSurfaceTreatment,
): PreparedModel {
    // SkeletonUtils is required for independent SkinnedMesh bone trees. Object3D.clone
    // shares skeleton bindings and causes one fighter's animation to corrupt the other.
    const surface = cloneSkeleton(source) as THREE.Group;
    stylizeApprovedRig(surface, config);
    const presentationBounds = stablePetModelPresentationBounds(surface);
    const box = presentationBounds.fit;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const offset: [number, number, number] = [-center.x, -presentationBounds.groundY, -center.z];
    const fitSize = config.fit === "longest" ? Math.max(size.x, size.y, size.z) : size.y;
    const scale = config.targetHeight / Math.max(0.001, fitSize);
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("modelbounds") === "1") {
        const skinned = new THREE.Box3().setFromObject(surface, true);
        const diagnostic = {
            visualId: config.visualId,
            raw: presentationBounds.raw.getSize(new THREE.Vector3()).toArray(),
            fit: size.toArray(),
            groundY: presentationBounds.groundY,
            skinned: skinned.getSize(new THREE.Vector3()).toArray(),
            scale,
        };
        (window as Window & { __PET_MODEL_BOUNDS__?: Record<string, typeof diagnostic> }).__PET_MODEL_BOUNDS__ ??= {};
        (window as Window & { __PET_MODEL_BOUNDS__?: Record<string, typeof diagnostic> }).__PET_MODEL_BOUNDS__![config.visualId] = diagnostic;
        document.documentElement.dataset.petModelBounds = JSON.stringify(
            (window as Window & { __PET_MODEL_BOUNDS__?: Record<string, typeof diagnostic> }).__PET_MODEL_BOUNDS__,
        );
    }
    const materials: THREE.Material[] = [];
    // Fighter materials are isolated, but GLTFLoader remains the sole owner of
    // their baked colour atlases. Cloning/disposing the Texture wrapper broke
    // colours after the real selection-screen preload + battle remount cycle.
    const uniforms: DeformUniforms[] = [];
    const tint = new THREE.Color(ELEMENT_LIGHT[String(element ?? "")] ?? "#c4b5fd");
    const tintAmount = element === "Water" ? 0.18 : element === "Fire" ? 0.1 : element === "Earth" ? 0.14 : 0.16;
    const surfaceTint = ELEMENT_SURFACE[String(element ?? "")];
    surface.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        // Keep the DCC-authored split normals. Recomputing after glTF has split
        // vertices along UV seams turns those seams into visible triangular
        // facets, especially under stepped anime lighting. Only synthesize
        // normals for malformed source geometry that genuinely omitted them.
        if (!node.geometry.getAttribute("normal")) node.geometry.computeVertexNormals();
        node.castShadow = quality.modelShadows;
        node.receiveShadow = quality.modelShadows;
        const sourceMaterials = Array.isArray(node.material) ? node.material : [node.material];
        const cloned = sourceMaterials.map((sourceMaterial) => {
            // Approved roster reconstructions ship with authored smooth normals
            // and baked colour atlases. Their softer anime-PBR shader preserves
            // those gradients; a hard four-step ramp overstates UV seam facets.
            const material = ROSTER_VISUAL_ID.test(config.visualId)
                ? sourceMaterial.clone()
                : cloneAsCombatToon(sourceMaterial);
            const pbr = material as THREE.MeshStandardMaterial & { isMeshToonMaterial?: boolean };
            const textured = material as THREE.MeshStandardMaterial;
            if (persistentAtlas && ROSTER_VISUAL_ID.test(config.visualId)) {
                // Live selection parses GLBs before a renderer exists. Decode the
                // baked PNG independently so a stale GLTF ImageBitmap can never
                // turn an otherwise valid fighter into a white clay model.
                textured.map = bindPetAtlasTexture(copyPetAtlasSampling(persistentAtlas, textured.map), quality.textureAnisotropy);
            } else if (textured.map) {
                textured.map = bindPetAtlasTexture(textured.map, quality.textureAnisotropy);
            }
            if (ROSTER_VISUAL_ID.test(config.visualId) && (pbr.isMeshStandardMaterial || pbr.isMeshToonMaterial)) {
                // The colour atlas is the pet's identity. Generated production
                // rigs intentionally have no emissive map; a full-body emissive
                // colour flattens their blue/red/green planes into beige under the
                // warm Coliseum lights. Lock the authored base factor and keep
                // full-body emission black. Impacts use particles/rim lights.
                pbr.userData.petAuthoredBaseColor = pbr.color?.getHex?.() ?? 0xffffff;
                pbr.userData.petAuthoredMap = textured.map ?? null;
                pbr.color?.setHex?.(Number(pbr.userData.petAuthoredBaseColor));
                if (surfaceTreatment) {
                    pbr.emissive?.set(surfaceTreatment.emissive);
                    pbr.emissiveIntensity = surfaceTreatment.emissiveIntensity;
                } else {
                    pbr.emissive?.setHex?.(0x000000);
                    pbr.emissiveIntensity = 0;
                }
                pbr.roughness = Math.min(0.82, Math.max(0.58, pbr.roughness ?? 0.72));
                pbr.metalness = Math.min(0.05, pbr.metalness ?? 0);
            }
            if (pbr.isMeshToonMaterial) {
                // Preserve authored normals; the hard toon gradient supplies the
                // graphic light breaks without destroying the rigged surface.
                pbr.emissive = pbr.emissive?.clone?.() ?? new THREE.Color("#000000");
                pbr.emissiveIntensity = 0;
                const name = pbr.name.toLowerCase();
                if (config.visualId.startsWith("starter-fire")) {
                    if (name.includes("main_light")) pbr.color.set("#ff6430");
                    else if (name.includes("main")) pbr.color.set("#521129");
                    else if (name.includes("nose")) pbr.color.set("#160b15");
                    else if (name.includes("eyes")) pbr.color.set("#ffd45e");
                    else pbr.color.lerp(tint, tintAmount);
                    if (name.includes("main_light")) pbr.userData.petIdentityGlow = 0.11;
                    else if (name.includes("eyes")) pbr.userData.petIdentityGlow = 0.34;
                } else if (config.visualId.startsWith("starter-water")) {
                    if (name.includes("dark")) pbr.color.set("#02283d");
                    else if (name.includes("light")) pbr.color.set("#8adbe6");
                    else if (name.includes("main")) pbr.color.set("#147a8f");
                    else if (name.includes("eyes")) pbr.color.set("#02131d");
                    else pbr.color.lerp(tint, tintAmount);
                } else pbr.color.lerp(tint, tintAmount);
            }
            patchDeformation(material, box.min.y, size.y, uniforms);
            const uniform = uniforms[uniforms.length - 1];
            uniform.lowTint.value.set(surfaceTreatment?.lowTint ?? surfaceTint?.low ?? "#ffffff");
            uniform.highTint.value.set(surfaceTreatment?.highTint ?? surfaceTint?.high ?? "#ffffff");
            uniform.tintStrength.value = surfaceTreatment?.tintStrength
                ?? (clips.length ? Math.min(0.14, surfaceTint?.strength ?? 0) : surfaceTint?.strength ?? 0);
            uniform.tintBlend.value = surfaceTreatment?.tintBlend ?? 0;
            materials.push(material);
            return material;
        });
        node.material = Array.isArray(node.material) ? cloned : cloned[0];
    });

    const outline = quality.outline && config.outlineScale > 1.001
        ? cloneSkeleton(surface) as THREE.Group
        : null;
    if (outline) {
        stylizeApprovedRig(outline, config);
        outline.traverse((node) => {
            if (!(node instanceof THREE.Mesh)) return;
            node.castShadow = false;
            node.receiveShadow = false;
            const sourceMaterials = Array.isArray(node.material) ? node.material : [node.material];
            const outlined = sourceMaterials.map(() => {
                const material = new THREE.MeshBasicMaterial({
                    color: "#160d1c",
                    side: THREE.BackSide,
                    toneMapped: false,
                });
                patchDeformation(material, box.min.y, size.y, uniforms);
                materials.push(material);
                return material;
            });
            node.material = Array.isArray(node.material) ? outlined : outlined[0];
        });
    }

    return { surface, outline, offset, scale, materials, uniforms, clips };
}

const normalizedClipName = (clip: THREE.AnimationClip) => clip.name.split("|").at(-1)?.toLowerCase() ?? clip.name.toLowerCase();
const ROSTER_VISUAL_ID = /^(?:standard|rare|legendary|mythic)-\d+(?:-|$)/;
const RIGGED_STARTER_VISUAL_ID = /^starter-(?:fire|water|wind|lightning|earth)(?:-[rl])?$/;
const AUTHORED_COMBAT_CLIPS = ["idle", "walk", "gallop", "gallop_jump", "attack", "idle_hitreact1", "idle_2", "death"] as const;

function isAuthoredCombatRig(visualId: string, clips: readonly THREE.AnimationClip[]): boolean {
    if (!ROSTER_VISUAL_ID.test(visualId) && !RIGGED_STARTER_VISUAL_ID.test(visualId)) return false;
    const names = new Set(clips.map(normalizedClipName));
    return AUTHORED_COMBAT_CLIPS.every((name) => names.has(name));
}

function findClip(clips: readonly THREE.AnimationClip[], candidates: readonly string[]): THREE.AnimationClip | null {
    for (const candidate of candidates) {
        const exact = clips.find((clip) => normalizedClipName(clip) === candidate);
        if (exact) return exact;
    }
    return null;
}

function combatClip(clips: readonly THREE.AnimationClip[], frame: PetModelFrame, profile: PetCombatModelConfig["profile"]): THREE.AnimationClip | null {
    if (frame.motion === "dead") return findClip(clips, ["death"]);
    if (frame.victorious) return findClip(clips, ["victory", "idle", "walk"]);
    if (frame.entranceProgress !== undefined && frame.entranceProgress < 1) {
        return findClip(clips, ["entrance", "gallop_jump", "idle"]);
    }
    // Keep the authored attack take alive from anticipation through follow-through.
    // Previously `windup -> strike -> recover` reset/cross-faded the same clip on
    // every state edge, so only its first few frames ever appeared in battle.
    if (frame.motion === "strike" || frame.motion === "windup" || frame.motion === "recover") {
        return frame.casting ? findClip(clips, ["cast", "attack"]) : findClip(clips, ["attack"]);
    }
    if (frame.motion === "stagger") return findClip(clips, ["idle_hitreact1", "out_of_water", "idle_hitreact2"]);
    if (frame.motion === "dodge") return findClip(clips, ["gallop_jump", "swimming_impulse", "jump_toidle", "swimming_fast"]);
    if (frame.motion === "guard") return findClip(clips, ["guard", "idle", "walk", "swimming_normal"]);
    if (frame.motion === "rest") return findClip(clips, ["rest", "idle", "walk", "swimming_normal"]);
    if (frame.motion === "dash") {
        // Birds take off and beat their wings through a committed dive. Reusing
        // the quadruped gallop here made every avian skim the floor like a dog.
        if (profile === "avian") return findClip(clips, ["gallop_jump", "gallop", "attack", "walk"]);
        return findClip(clips, ["gallop", "swimming_fast", "swimming_impulse", "walk"]);
    }
    if (frame.moving || frame.motion === "run") {
        // A fast quadruped using its walk take visibly skates across the floor.
        // Crossfade into the shorter gallop cycle once the presentation velocity
        // passes a real running pace. Floating/serpentine pets keep their authored
        // swim order because their movement does not imply planted foot contacts.
        if (profile === "quadruped" && frame.speed >= 7.5) return findClip(clips, ["gallop", "walk"]);
        if (profile === "biped" && frame.speed >= 3.45) return findClip(clips, ["gallop", "walk"]);
        return findClip(clips, ["walk", "swimming_normal", "gallop"]);
    }
    if (frame.casting) {
        return findClip(clips, ["cast", "idle", "walk", "swimming_normal"]);
    }
    return findClip(clips, ["idle", "swimming_normal", "idle_2"]);
}

type CombatAnimationFamily = "idle" | "entrance" | "locomotion" | "attack" | "dodge" | "hit" | "death" | "victory";

function combatAnimationFamily(frame: PetModelFrame): CombatAnimationFamily {
    if (frame.motion === "dead") return "death";
    if (frame.victorious) return "victory";
    if (frame.entranceProgress !== undefined && frame.entranceProgress < 1) return "entrance";
    if (frame.motion === "windup" || frame.motion === "strike" || frame.motion === "recover") return "attack";
    if (frame.motion === "dodge") return "dodge";
    if (frame.motion === "stagger") return "hit";
    if (frame.moving || frame.motion === "run" || frame.motion === "dash") return "locomotion";
    return "idle";
}

/** Elemental silhouette pieces turn the approved animal bases into authored battle
 * familiars. They use the same hard toon ramp and ink hull as the base model, so the
 * additions read as part of one anime design instead of glowing VFX glued on top. */
export function LegacyAnimePetAccents({ config }: { config: PetCombatModelConfig }) {
    const h = config.targetHeight;
    const ink = "#160d1c";
    const orbit = useRef<THREE.Group>(null);
    const detailOrbit = useRef<THREE.Group>(null);

    useFrame((state) => {
        const t = state.clock.elapsedTime + (config.visualId.endsWith("-l") ? 1.7 : 0);
        if (orbit.current) {
            orbit.current.rotation.y = Math.sin(t * 0.42) * 0.18;
            orbit.current.position.y = Math.sin(t * 1.18) * h * 0.012;
        }
        if (detailOrbit.current) {
            detailOrbit.current.rotation.y = -Math.sin(t * 0.36) * 0.13;
            detailOrbit.current.position.y = Math.cos(t * 1.08) * h * 0.01;
        }
    });
    const outlinedOctahedron = (
        key: string,
        position: [number, number, number],
        scale: [number, number, number],
        color: string,
        rotation: [number, number, number] = [0, 0, 0],
        opacity = 1,
        glow = 0,
    ) => (
        <group key={key} position={position} rotation={rotation}>
            <mesh scale={[scale[0] * 1.14, scale[1] * 1.14, scale[2] * 1.14]}>
                <octahedronGeometry args={[1, 0]} />
                <meshBasicMaterial color={ink} side={THREE.BackSide} toneMapped={false} transparent={opacity < 1} opacity={Math.min(1, opacity + 0.16)} />
            </mesh>
            <mesh scale={scale} castShadow>
                <octahedronGeometry args={[1, 0]} />
                <meshToonMaterial color={color} gradientMap={toonGradient()} transparent={opacity < 1} opacity={opacity} emissive={color} emissiveIntensity={glow} />
            </mesh>
        </group>
    );
    const outlinedSpike = (
        key: string,
        position: [number, number, number],
        scale: [number, number, number],
        color: string,
        rotation: [number, number, number],
        opacity = 1,
        glow = 0,
    ) => (
        <group key={key} position={position} rotation={rotation}>
            <mesh scale={[scale[0] * 1.15, scale[1] * 1.1, scale[2] * 1.15]}>
                <coneGeometry args={[1, 2, 4]} />
                <meshBasicMaterial color={ink} side={THREE.BackSide} toneMapped={false} transparent={opacity < 1} opacity={Math.min(1, opacity + 0.16)} />
            </mesh>
            <mesh scale={scale} castShadow>
                <coneGeometry args={[1, 2, 4]} />
                <meshToonMaterial color={color} gradientMap={toonGradient()} transparent={opacity < 1} opacity={opacity} emissive={color} emissiveIntensity={glow} />
            </mesh>
        </group>
    );
    const outlinedPlate = (
        key: string,
        position: [number, number, number],
        scale: [number, number, number],
        color: string,
        rotation: [number, number, number] = [0, 0, 0],
        opacity = 1,
        detail = 1,
        glow = 0,
    ) => (
        <group key={key} position={position} rotation={rotation}>
            <mesh scale={[scale[0] * 1.09, scale[1] * 1.09, scale[2] * 1.28]}>
                <icosahedronGeometry args={[1, detail]} />
                <meshBasicMaterial color={ink} side={THREE.BackSide} toneMapped={false} transparent={opacity < 1} opacity={Math.min(1, opacity + 0.14)} />
            </mesh>
            <mesh scale={scale} castShadow>
                <icosahedronGeometry args={[1, detail]} />
                <meshToonMaterial color={color} gradientMap={toonGradient()} transparent={opacity < 1} opacity={opacity} emissive={color} emissiveIntensity={glow} />
            </mesh>
        </group>
    );
    const faceEye = (key: string, position: [number, number, number], scale: [number, number, number], color: string, rotation: [number, number, number] = [0, 0, 0]) => (
        <group key={key} position={position} rotation={rotation}>
            <mesh scale={[scale[0] * 1.28, scale[1] * 1.36, scale[2] * 1.12]}>
                <sphereGeometry args={[1, 10, 8]} />
                <meshBasicMaterial color={ink} toneMapped={false} />
            </mesh>
            <mesh position={[0, 0, scale[2] * 0.3]} scale={scale}>
                <sphereGeometry args={[1, 10, 8]} />
                <meshBasicMaterial color={color} toneMapped={false} />
            </mesh>
        </group>
    );

    if (config.visualId.startsWith("starter-fire")) {
        return (
            // The rig is normalized by its long nose-to-tail axis, so its rendered
            // height is about 62% of targetHeight. Match that proportion here; using
            // the longitudinal measure directly produced oversized crystal armor.
            <group scale={[0.62, 0.62, 1]}>
                {/* Layered burgundy fur establishes the wolf silhouette. The orange
                    blaze is repeated from brow to chest to tail like an authored skin. */}
                {outlinedSpike("fire-ear-l", [-h * 0.13, h * 0.79, h * 0.13], [h * 0.052, h * 0.11, h * 0.046], "#5a1727", [0.08, 0, -0.46])}
                {outlinedSpike("fire-ear-r", [h * 0.13, h * 0.79, h * 0.13], [h * 0.052, h * 0.11, h * 0.046], "#5a1727", [0.08, 0, 0.46])}
                {outlinedSpike("fire-brow", [0, h * 0.735, h * 0.335], [h * 0.045, h * 0.09, h * 0.018], "#ff6a32", [0, 0, Math.PI])}
                {outlinedPlate("fire-mask-l", [-h * 0.055, h * 0.67, h * 0.355], [h * 0.07, h * 0.038, h * 0.016], "#ff6530", [0, 0, -0.16], 1, 0)}
                {outlinedPlate("fire-mask-r", [h * 0.055, h * 0.67, h * 0.355], [h * 0.07, h * 0.038, h * 0.016], "#ff6530", [0, 0, 0.16], 1, 0)}
                {faceEye("fire-eye-l", [-h * 0.064, h * 0.715, h * 0.375], [h * 0.029, h * 0.011, h * 0.009], "#ffd65a", [0, 0, 0.08])}
                {faceEye("fire-eye-r", [h * 0.064, h * 0.715, h * 0.375], [h * 0.029, h * 0.011, h * 0.009], "#ffd65a", [0, 0, -0.08])}

                {outlinedSpike("fire-mane-l-top", [-h * 0.17, h * 0.6, h * 0.045], [h * 0.055, h * 0.125, h * 0.048], "#4a1424", [-0.2, 0.14, -0.82])}
                {outlinedSpike("fire-mane-r-top", [h * 0.17, h * 0.6, h * 0.045], [h * 0.055, h * 0.125, h * 0.048], "#4a1424", [-0.2, -0.14, 0.82])}
                {outlinedSpike("fire-mane-l-low", [-h * 0.205, h * 0.49, h * 0.02], [h * 0.05, h * 0.105, h * 0.043], "#6c1c2b", [-0.2, 0.18, -1.02])}
                {outlinedSpike("fire-mane-r-low", [h * 0.205, h * 0.49, h * 0.02], [h * 0.05, h * 0.105, h * 0.043], "#6c1c2b", [-0.2, -0.18, 1.02])}
                {outlinedSpike("fire-chest-top", [0, h * 0.53, h * 0.285], [h * 0.075, h * 0.095, h * 0.026], "#ff542c", [0.08, 0, Math.PI])}
                {outlinedSpike("fire-chest-mid", [0, h * 0.455, h * 0.275], [h * 0.065, h * 0.09, h * 0.025], "#ed3927", [0.08, 0, Math.PI])}
                {outlinedSpike("fire-chest-tip", [0, h * 0.39, h * 0.255], [h * 0.047, h * 0.07, h * 0.023], "#ff8b35", [0.08, 0, Math.PI])}

                {outlinedSpike("fire-tail-dark", [-h * 0.045, h * 0.47, -h * 0.42], [h * 0.075, h * 0.17, h * 0.062], "#591528", [-0.72, 0.15, -0.24])}
                {outlinedSpike("fire-tail-orange", [h * 0.06, h * 0.43, -h * 0.48], [h * 0.052, h * 0.13, h * 0.047], "#ff542c", [-0.9, -0.25, 0.28])}
                {outlinedSpike("fire-tail-gold", [-h * 0.075, h * 0.4, -h * 0.51], [h * 0.038, h * 0.095, h * 0.036], "#ffab32", [-1.0, 0.1, -0.35])}

                {/* The shards are a slow, asymmetrical familiar accessory. Keeping
                    them off the joints preserves the rig and avoids armor-like blocks. */}
                <group ref={orbit}>
                    {outlinedOctahedron("fire-shard-l", [-h * 0.31, h * 0.62, -h * 0.03], [h * 0.038, h * 0.09, h * 0.035], "#ff3d2e", [0.12, 0.22, -0.24], 1, 0.12)}
                    {outlinedOctahedron("fire-shard-r", [h * 0.32, h * 0.51, h * 0.02], [h * 0.045, h * 0.1, h * 0.038], "#ff7138", [-0.14, -0.18, 0.26], 1, 0.1)}
                    {outlinedOctahedron("fire-shard-back", [h * 0.19, h * 0.69, -h * 0.25], [h * 0.028, h * 0.067, h * 0.027], "#d52b32", [0.2, 0.35, 0.18], 1, 0.08)}
                </group>
            </group>
        );
    }

    if (config.visualId.startsWith("starter-water")) {
        return (
            <group>
                {/* A large dark visor, pale face and belly, and simple eyes create
                    the friendly sea-spirit read before any combat VFX turns on. */}
                {outlinedPlate("water-visor", [0, h * 0.715, h * 0.245], [h * 0.205, h * 0.105, h * 0.105], "#063b54", [-0.08, 0, 0], 1, 2)}
                {outlinedPlate("water-visor-shine", [-h * 0.055, h * 0.76, h * 0.34], [h * 0.075, h * 0.035, h * 0.012], "#d9fbff", [-0.08, 0, -0.18], 0.92, 2, 0.03)}
                {outlinedPlate("water-face", [0, h * 0.64, h * 0.345], [h * 0.15, h * 0.085, h * 0.025], "#d9f4f1", [0.08, 0, 0], 1, 2)}
                {faceEye("water-eye-l", [-h * 0.072, h * 0.666, h * 0.382], [h * 0.027, h * 0.033, h * 0.012], "#081827")}
                {faceEye("water-eye-r", [h * 0.072, h * 0.666, h * 0.382], [h * 0.027, h * 0.033, h * 0.012], "#081827")}
                {outlinedPlate("water-belly", [0, h * 0.435, h * 0.255], [h * 0.13, h * 0.205, h * 0.024], "#bfecea", [0.1, 0, 0], 1, 2)}

                {outlinedSpike("water-cheek-fin-l", [-h * 0.17, h * 0.59, h * 0.2], [h * 0.047, h * 0.125, h * 0.035], "#37b8cd", [0.05, 0.12, -1.08], 0.95)}
                {outlinedSpike("water-cheek-fin-r", [h * 0.17, h * 0.59, h * 0.2], [h * 0.047, h * 0.125, h * 0.035], "#37b8cd", [0.05, -0.12, 1.08], 0.95)}
                {outlinedSpike("water-side-fin-l", [-h * 0.205, h * 0.43, h * 0.02], [h * 0.05, h * 0.145, h * 0.035], "#72dce2", [0.08, 0.18, -1.06], 0.92)}
                {outlinedSpike("water-side-fin-r", [h * 0.205, h * 0.43, h * 0.02], [h * 0.05, h * 0.145, h * 0.035], "#72dce2", [0.08, -0.18, 1.06], 0.92)}
                {outlinedSpike("water-tail-fin-l", [-h * 0.075, h * 0.3, -h * 0.46], [h * 0.045, h * 0.13, h * 0.034], "#3cc7d5", [-0.82, 0.25, -0.55], 0.94)}
                {outlinedSpike("water-tail-fin-r", [h * 0.075, h * 0.3, -h * 0.46], [h * 0.045, h * 0.13, h * 0.034], "#82e5e0", [-0.82, -0.25, 0.55], 0.94)}

                {/* Translucent fin shards hover in two loose arcs, mirroring the
                    concept sheet while staying visibly separate from attack effects. */}
                <group ref={orbit}>
                    {outlinedSpike("water-shard-l-high", [-h * 0.3, h * 0.65, h * 0.02], [h * 0.035, h * 0.105, h * 0.021], "#77e8ef", [0.12, 0.2, -0.72], 0.72, 0.04)}
                    {outlinedSpike("water-shard-r-high", [h * 0.3, h * 0.62, h * 0.01], [h * 0.035, h * 0.105, h * 0.021], "#a9f2ef", [0.12, -0.2, 0.72], 0.72, 0.04)}
                </group>
                <group ref={detailOrbit}>
                    {outlinedOctahedron("water-shard-l-low", [-h * 0.27, h * 0.42, -h * 0.18], [h * 0.028, h * 0.07, h * 0.024], "#35bdd8", [0.2, 0.3, -0.2], 0.76, 0.04)}
                    {outlinedOctahedron("water-shard-r-low", [h * 0.26, h * 0.38, -h * 0.22], [h * 0.025, h * 0.064, h * 0.022], "#8de9e9", [-0.16, -0.24, 0.22], 0.76, 0.04)}
                </group>
            </group>
        );
    }

    return null;
}

function LoadedPetModel3D({ config, frame, element, showIdentity = true, surfaceTreatment, signature }: {
    config: PetCombatModelConfig;
    frame: MutableRefObject<PetModelFrame>;
    element?: string;
    showIdentity?: boolean;
    surfaceTreatment?: PetModelSurfaceTreatment;
    signature?: PetSignaturePerformance;
}) {
    const gltf = useGLTF(config.url) as { scene: THREE.Group; animations: THREE.AnimationClip[] };
    const persistentAtlas = ROSTER_VISUAL_ID.test(config.visualId) ? readPetGlbAtlas(config.url) : null;
    const quality = useMemo(() => petVisualQuality(), []);
    const prepared = useMemo(
        () => prepareModel(gltf.scene, config, gltf.animations ?? [], quality, element, persistentAtlas, surfaceTreatment),
        [gltf.scene, gltf.animations, config, quality, element, persistentAtlas, surfaceTreatment],
    );
    const mixer = useMemo(() => prepared.clips.length ? new THREE.AnimationMixer(prepared.surface) : null, [prepared]);
    const outlineMixer = useMemo(() => prepared.clips.length && prepared.outline ? new THREE.AnimationMixer(prepared.outline) : null, [prepared]);
    const activeClip = useRef<THREE.AnimationClip | null>(null);
    const activeFamily = useRef<CombatAnimationFamily>("idle");
    const activeAction = useRef<THREE.AnimationAction | null>(null);
    const activeOutlineAction = useRef<THREE.AnimationAction | null>(null);
    const root = useRef<THREE.Group>(null);
    const body = useRef<THREE.Group>(null);
    const aura = useRef<THREE.PointLight>(null);
    const lastMotion = useRef<PetModelFrame["motion"]>("idle");
    const motionStart = useRef(0);
    const lastVictorious = useRef(false);
    const victoryStart = useRef(0);
    const lastTimeline = useRef<number | null>(null);
    const facingInitialized = useRef(false);
    const lightColor = surfaceTreatment?.emissive ?? ELEMENT_LIGHT[String(element ?? "")] ?? "#c4b5fd";
    const avianWingBones = useMemo(() => {
        const bones: Array<{ bone: THREE.Bone; side: number; reach: number }> = [];
        const seen = new Set<string>();
        for (const scene of [prepared.surface, prepared.outline]) {
            scene?.traverse((object) => {
                if (!(object as THREE.SkinnedMesh).isSkinnedMesh) return;
                for (const bone of (object as THREE.SkinnedMesh).skeleton.bones) {
                    // GLTFLoader sanitizes dots in animation target names, so
                    // accept both DCC `wing_upper.L` and runtime `wing_upperL` /
                    // `wing_upper_L` spellings.
                    if (!/^wing_(upper|mid)[._]?(L|R)$/iu.test(bone.name)) continue;
                    const key = `${scene.uuid}:${bone.uuid}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    bones.push({
                        bone,
                        side: /L$/iu.test(bone.name) ? 1 : -1,
                        reach: bone.name.includes("upper") ? 1 : 0.55,
                    });
                }
            });
        }
        return bones;
    }, [prepared.surface, prepared.outline]);

    useEffect(() => () => {
        if (mixer) {
            mixer.stopAllAction();
            mixer.uncacheRoot(prepared.surface);
        }
        if (outlineMixer && prepared.outline) {
            outlineMixer.stopAllAction();
            outlineMixer.uncacheRoot(prepared.outline);
        }
        // The materials are cloned per fighter, so this does not dispose the GLTF cache.
        if (prepared.materials.length) {
            for (const material of prepared.materials) material.dispose();
        }
    }, [mixer, outlineMixer, prepared]);

    /* eslint-disable react-hooks/immutability -- Three.js uniforms and Object3D transforms are mutable render-loop state; mutating them inside useFrame is the R3F animation contract. */
    useFrame((state, delta) => {
        const r = root.current;
        const b = body.current;
        if (!r || !b) return;
        const f = frame.current;
        const signatureDirection = f.signature ?? signature;
        const signatureCadence = signatureDirection?.cadence ?? 1;
        const signatureAgility = signatureDirection?.agility ?? 1;
        const signatureWeight = signatureDirection?.weight ?? 1;
        const signatureStrike = signatureDirection?.strikeDrive ?? 1;
        const signatureRecoil = signatureDirection?.recoil ?? 1;
        const authoredCombatRig = isAuthoredCombatRig(config.visualId, prepared.clips);
        const groundedAuthoredQuadruped = authoredCombatRig && config.profile === "quadruped";
        const aquaticSeal = config.visualId === "starter-water" || config.visualId === "starter-water-r";
        const t = state.clock.elapsedTime;
        const timeline = Number.isFinite(f.timeline) ? Number(f.timeline) : t;
        const timelineReset = lastTimeline.current !== null && timeline < lastTimeline.current - 0.05;
        const animationDelta = lastTimeline.current === null || timelineReset
            ? 0
            : THREE.MathUtils.clamp(timeline - lastTimeline.current, 0, 0.1);
        // One clock owns the entire fighter. Showdown supplies a slowed timeline
        // during hit-stop and cinematic slow motion; using wall-frame `delta`
        // for root pose, gait or material pulses while the mixer used that
        // timeline made the body twitch and settle around an otherwise frozen
        // skeleton. Callers without a presentation timeline retain ordinary R3F
        // frame timing.
        const presentationDelta = f.timeline === undefined ? delta : animationDelta;
        lastTimeline.current = timeline;
        if (timelineReset) {
            activeClip.current = null;
            activeFamily.current = "idle";
            activeAction.current = null;
            activeOutlineAction.current = null;
            mixer?.stopAllAction();
            outlineMixer?.stopAllAction();
            lastVictorious.current = false;
            victoryStart.current = timeline;
            facingInitialized.current = false;
        }
        const motionChanged = f.motion !== lastMotion.current;
        if (motionChanged) {
            lastMotion.current = f.motion;
            motionStart.current = timeline;
        }
        const motionAge = Math.max(0, timeline - motionStart.current);
        if (f.victorious && !lastVictorious.current) victoryStart.current = timeline;
        lastVictorious.current = !!f.victorious;
        const victoryAge = Math.max(0, timeline - victoryStart.current);
        // A winner gets one authored celebration beat rather than another looping
        // idle: launch, crest, plant, then hold the proud silhouette. The arc is
        // deliberately single-shot so quadrupeds do not become rocking horses.
        const victoryP = Math.min(1, victoryAge / 0.72);
        const victoryArcShape = signatureDirection?.victory === "monolith" ? 0.28
            : signatureDirection?.victory === "prowl" ? 0.48
                : signatureDirection?.victory === "roar" ? 0.72
                    : signatureDirection?.victory === "soar" ? 1.25
                        : signatureDirection?.victory === "spiral" ? 1.05
                            : 0.86;
        const victoryArc = f.victorious
            ? Math.sin(Math.PI * victoryP) * petVictoryArcHeight(config.targetHeight, config.profile, aquaticSeal) * (signatureDirection?.victoryLift ?? 1) * victoryArcShape
            : 0;
        const victoryLift = f.victorious ? 1 - Math.pow(1 - Math.min(1, victoryAge / 0.48), 3) : 0;
        const avianDive = config.profile === "avian" && f.motion === "dash";
        const avianDiveP = avianDive ? Math.min(1, motionAge / 0.58) : 0;
        const avianDiveArc = avianDive ? Math.sin(Math.PI * avianDiveP) * config.targetHeight * 0.19 : 0;
        // A dodge is one readable launch-and-land phrase. The presentation track
        // holds the state for ~0.44 s; matching that window prevents the model from
        // finishing its hop halfway through the lateral escape and skating to rest.
        const dodgeP = Math.min(1, motionAge / 0.42);
        const dodgeArc = f.motion === "dodge" ? Math.sin(Math.PI * dodgeP) : 0;
        // The previous pass calculated a dodge arc but never applied it to root
        // height. That left a lateral position change with only a body tilt—the
        // exact visual signature of a teleport/glitch. Every dodge now has one
        // planted launch, airborne read, and landing; seals stay lower than paws.
        const dodgeHeight = dodgeArc * config.targetHeight * (aquaticSeal ? 0.075 : config.profile === "heavy" ? 0.085 : 0.13) * (signatureDirection?.dodgeLift ?? 1);
        if (mixer) {
            const clip = combatClip(prepared.clips, f, config.profile);
            const family = combatAnimationFamily(f);
            // NO idle_2 QUIRK. Round 38 broke the idle loop every ~9s with the
            // rig's second idle take to keep pets alive between beats; owner
            // reported models visibly deforming during it. idle_2 is not a
            // universal "alternate idle" — on several rigs it is a rear-up /
            // wings-out pose authored for another context (the same reason
            // combatClip already refuses it for quadruped casting), so
            // crossfading into it mid-loop mangles the silhouette. The species
            // personality players actually read comes from the procedural
            // hero-pose layer, which is rig-safe; this take is left alone.
            const oneShot = family === "death" || family === "entrance" || family === "dodge" || family === "hit" || family === "attack" || family === "victory";
            const enteringOneShot = oneShot && activeFamily.current !== family;
            const phaseWindow = attackClipWindow(f.motion);
            const enteringAttackPhase = !!phaseWindow && motionChanged;
            const reusingAttackTake = !!clip && activeClip.current === clip && !!activeAction.current && enteringAttackPhase;
            if (reusingAttackTake && clip && phaseWindow) {
                // Windup, contact, and recovery share one generated take, but each
                // phase owns a distinct time window. Re-cueing that window keeps
                // anticipation from reaching the raised-paw final frame early.
                const next = activeAction.current!;
                next.reset();
                next.enabled = true;
                next.clampWhenFinished = true;
                next.setLoop(THREE.LoopOnce, 1);
                next.time = clip.duration * phaseWindow.start;
                next.play();
                if (outlineMixer && activeOutlineAction.current) {
                    const outline = activeOutlineAction.current;
                    outline.reset();
                    outline.enabled = true;
                    outline.clampWhenFinished = true;
                    outline.setLoop(THREE.LoopOnce, 1);
                    outline.time = clip.duration * phaseWindow.start;
                    outline.play();
                }
            } else if (clip && (activeClip.current !== clip || enteringOneShot)) {
                const previous = activeAction.current;
                const next = mixer.clipAction(clip);
                next.reset();
                next.enabled = true;
                next.clampWhenFinished = oneShot;
                next.setLoop(oneShot ? THREE.LoopOnce : THREE.LoopRepeat, oneShot ? 1 : Infinity);
                const transition = oneShot ? 0.1 : 0.22;
                next.fadeIn(transition).play();
                previous?.fadeOut(transition * 0.85);
                if (outlineMixer) {
                    const previousOutline = activeOutlineAction.current;
                    const nextOutline = outlineMixer.clipAction(clip);
                    nextOutline.reset();
                    nextOutline.enabled = true;
                    nextOutline.clampWhenFinished = oneShot;
                    nextOutline.setLoop(oneShot ? THREE.LoopOnce : THREE.LoopRepeat, oneShot ? 1 : Infinity);
                    nextOutline.fadeIn(transition).play();
                    previousOutline?.fadeOut(transition * 0.85);
                    activeOutlineAction.current = nextOutline;
                }
                activeClip.current = clip;
                activeFamily.current = family;
                activeAction.current = next;
            }
            activeFamily.current = family;
            // Cadence follows measured world velocity. The previous fixed rate was
            // acceptable at the old arena speed but became obvious foot sliding
            // after movement skills and reposition sprints were accelerated.
            // The restored fox uses a compact 16-frame gallop. Driving that at
            // the generic 2.5-3.2x cadence hides its stride and reads as a static
            // model vibrating. Its world speed stays fast; only the leg-cycle
            // playback is brought into a readable 2-3 strides/second range.
            // The attack take's pacing scales with the MOVE's weight (frame
            // .attackPace) — a jab snaps through its take, a heavy grinds the
            // anticipation, a signature stretches across its whole long beat.
            const variantPace = (f.performanceVariant === 0 ? 0.96 : f.performanceVariant === 2 ? 1.05 : 1) * signatureCadence;
            const attackPace = (f.attackPace ?? 1) * variantPace;
            const locomotionRate = authoredCombatRig
                ? f.motion === "dodge"
                    ? 1.16
                    : f.motion === "windup"
                        ? 0.76 * attackPace
                        : f.motion === "strike"
                            ? 1.48 * Math.max(0.8, attackPace)
                            : f.motion === "recover"
                                ? 1.04 * attackPace
                    : f.motion === "dash"
                        ? config.profile === "avian"
                            ? THREE.MathUtils.clamp(1.22 + f.speed * 0.11, 1.35, 1.92)
                            : THREE.MathUtils.clamp(0.98 + f.speed * 0.16, 1.2, 2.15)
                        : f.motion === "run" || f.moving
                            ? THREE.MathUtils.clamp(0.7 + f.speed * 0.18, 0.9, 1.85)
                            : 1
                : f.motion === "dodge"
                    ? 1.3
                    : f.motion === "dash"
                        ? THREE.MathUtils.clamp(1.45 + f.speed * 0.3, 1.85, 3.25)
                        : f.motion === "run" || f.moving
                            ? THREE.MathUtils.clamp(0.72 + f.speed * 0.44, 1.05, 2.7)
                            : 1;
            const rateBlend = Math.min(1, presentationDelta * 8);
            if (activeAction.current) activeAction.current.timeScale = THREE.MathUtils.lerp(activeAction.current.timeScale, locomotionRate, rateBlend);
            if (activeOutlineAction.current) activeOutlineAction.current.timeScale = THREE.MathUtils.lerp(activeOutlineAction.current.timeScale, locomotionRate, rateBlend);
            mixer.update(presentationDelta);
            outlineMixer?.update(presentationDelta);
            if (phaseWindow && activeClip.current && activeAction.current) {
                const phaseEnd = activeClip.current.duration * phaseWindow.end;
                if (activeAction.current.time >= phaseEnd) {
                    activeAction.current.time = phaseEnd;
                    activeAction.current.paused = true;
                    mixer.update(0);
                }
                if (activeOutlineAction.current && outlineMixer && activeOutlineAction.current.time >= phaseEnd) {
                    activeOutlineAction.current.time = phaseEnd;
                    activeOutlineAction.current.paused = true;
                    outlineMixer.update(0);
                }
            }
        }
        if (config.profile === "avian" && avianWingBones.length && (avianDive || f.motion === "dodge")) {
            // Layer a readable, symmetric wing beat after the authored mixer has
            // sampled. The shared roster clips were originally quadruped takes;
            // without this avian pass their wing bones barely left the body even
            // during a dive. The mixer overwrites this local delta next frame, so
            // it cannot accumulate into a twist or jitter.
            const phase = avianDive ? avianDiveP : dodgeP;
            const beat = Math.sin(phase * Math.PI * 3.2);
            const spread = 0.44 + (0.5 + beat * 0.5) * 0.62;
            for (const { bone, side, reach } of avianWingBones) {
                bone.rotateX(side * spread * reach);
                bone.rotateZ(side * 0.08 * reach * Math.sin(Math.PI * phase));
            }
        }
        const gait = (config.profile === "heavy" ? 8.8 : config.profile === "avian" ? 14 : 12.2) * signatureCadence * THREE.MathUtils.clamp(signatureAgility, 0.82, 1.18);
        const profileBounce = config.profile === "heavy" ? 0.045 : aquaticSeal ? 0.026 : config.profile === "serpentine" ? 0.08 : 0.065;
        // Dodge owns one clean hop cycle. Do not layer the ordinary running gait
        // underneath it or loop the lean; that combination reads as mesh jitter.
        const running = !f.victorious && motionOwnsLocomotion(f.motion, f.moving);
        const strike = f.motion === "strike" ? 1 : 0;
        const windup = f.motion === "windup" ? 1 : 0;
        const stagger = f.motion === "stagger" ? 1 : 0;
        const dodge = f.motion === "dodge" ? 1 : 0;
        const guard = f.motion === "guard" ? 1 : 0;
        const resting = f.motion === "rest" ? 1 : 0;
        const dead = f.motion === "dead" ? 1 : 0;
        const idle = f.motion === "idle" && !f.victorious;
        const performanceVariant = f.performanceVariant ?? 0;
        const variantSign = performanceVariant === 1 ? -1 : 1;
        const personalityTime = timeline + performanceVariant * 0.73 + (signatureDirection?.phase ?? 0);
        const breath = Math.sin(personalityTime * (f.desperate ? 7.2 : 3.45 + performanceVariant * 0.22))
            * (f.desperate ? 0.035 : 0.016 + performanceVariant * 0.002) * (signatureDirection?.breath ?? 1);
        const idleSway = idle ? Math.sin(personalityTime * (1.55 + performanceVariant * 0.18) * (signatureDirection?.idleRate ?? 1)) : 0;
        const gaitPhase = timeline * gait;
        const strideWave = Math.sin(gaitPhase * 0.72);
        const sealStroke = aquaticSeal && running ? Math.sin(gaitPhase * 0.56) : 0;
        const sealCompression = Math.abs(sealStroke);
        const runWave = running && !authoredCombatRig ? Math.abs(Math.sin(gaitPhase)) : 0;
        // Authored clips keep their leg animation, but still need a restrained
        // centre-of-mass transfer or the whole creature reads like a rigid model
        // being translated across the floor. This low-frequency weight shift is
        // deliberately much smaller than the legacy procedural bob.
        const authoredRunWave = running && authoredCombatRig ? Math.abs(Math.sin(gaitPhase * 0.72)) : 0;
        const bob = runWave * profileBounce
            + (groundedAuthoredQuadruped ? authoredRunWave * profileBounce * 0.16 : authoredRunWave * profileBounce * 0.34)
            + (f.casting && !authoredCombatRig ? Math.sin(timeline * 6) * 0.045 : 0);
        const attackPulse = strike ? Math.sin(Math.PI * Math.min(1, motionAge / 0.38)) : 0;
        // The authored locomotion moves the limbs, but a dash also needs a clear
        // centre-of-mass phrase: long acceleration, a planted brace at contact,
        // then defender recoil. These envelopes are single-shot and timeline
        // driven, so they add weight without the looping rock/jitter that plagued
        // the earlier procedural animation pass.
        const dashPoseP = f.motion === "dash" ? Math.min(1, motionAge / 0.52) : 0;
        const dashDrive = f.motion === "dash" ? Math.sin(Math.PI * dashPoseP) : 0;
        const dashBrakeRaw = f.motion === "dash" ? Math.max(0, Math.min(1, (dashPoseP - 0.7) / 0.3)) : 0;
        const dashBrake = dashBrakeRaw * dashBrakeRaw * (3 - 2 * dashBrakeRaw);
        // Strike begins on the same simulation tick as damage. A sharp leading
        // envelope therefore survives hit-stop and gives the model a visible
        // contact pose before the longer attack clip carries through recovery.
        const contactPunch = strike ? Math.exp(-motionAge * 8.5) : 0;
        const recoilPunch = stagger ? Math.exp(-motionAge * 6.5) : 0;
        const impactPower = THREE.MathUtils.clamp(f.impactPower ?? 0.55, 0.45, 1.25);
        const recoilWeight = recoilPunch * THREE.MathUtils.lerp(0.78, 1.48, (impactPower - 0.45) / 0.8);
        // Utility actions are animations too. Every rig gets a readable brace
        // and stamina-recovery phrase instead of idling inside a shield/number:
        // one planted guard compression, or a slow inhale -> lift -> exhale.
        const guardPlant = guard ? 1 - Math.exp(-motionAge * 10) : 0;
        const restP = resting ? Math.min(1, motionAge / 0.72) : 0;
        const restBreath = resting ? Math.sin(Math.PI * restP) : 0;
        const entranceP = f.entranceProgress === undefined ? 1 : THREE.MathUtils.clamp(f.entranceProgress, 0, 1);
        const entering = entranceP < 1;
        const entryHeight = signatureDirection?.entrance === "descent" ? 0.76
            : signatureDirection?.entrance === "vault" ? 0.52
                : signatureDirection?.entrance === "quake" ? 0.24
                    : signatureDirection?.entrance === "phase" ? 0.14
                        : signatureDirection?.entrance === "coil" ? 0.2
                            : config.profile === "avian" ? 0.62
                                : config.profile === "heavy" ? 0.26
                                    : 0.34;
        const entryLift = entering
            ? Math.pow(1 - entranceP, 2) * config.targetHeight * entryHeight * (signatureDirection?.entranceLift ?? 1)
                + Math.sin(Math.PI * entranceP) * config.targetHeight * 0.055
            : 0;
        const entryLand = entering
            ? Math.sin(Math.PI * THREE.MathUtils.clamp((entranceP - 0.62) / 0.38, 0, 1))
            : 0;
        const entryPitch = !entering ? 0
            : signatureDirection?.entrance === "descent" ? (1 - entranceP) * -0.22 + Math.sin(Math.PI * entranceP) * 0.08
                : signatureDirection?.entrance === "vault" ? Math.sin(Math.PI * entranceP) * -0.13
                    : signatureDirection?.entrance === "quake" ? (1 - entranceP) * 0.08 + entryLand * 0.1
                        : signatureDirection?.entrance === "stalk" ? (1 - entranceP) * -0.1
                            : 0;
        const entryRoll = !entering ? 0
            : signatureDirection?.entrance === "phase" ? Math.sin(Math.PI * entranceP) * 0.18 * (signatureDirection?.asymmetry ?? variantSign)
                : signatureDirection?.entrance === "coil" ? Math.sin(Math.PI * entranceP * 2) * 0.11 * (signatureDirection?.asymmetry ?? variantSign)
                    : Math.sin(Math.PI * entranceP) * (signatureDirection?.entranceTwist ?? 0);
        const entryYaw = !entering ? 0
            : signatureDirection?.entrance === "coil" ? Math.sin(Math.PI * entranceP) * 0.2 * (signatureDirection?.asymmetry ?? variantSign)
                : signatureDirection?.entrance === "phase" ? (1 - entranceP) * 0.24 * (signatureDirection?.asymmetry ?? variantSign)
                    : 0;
        const victoryPitch = !f.victorious ? 0
            : signatureDirection?.victory === "roar" ? -Math.sin(Math.PI * victoryP) * 0.12
                : signatureDirection?.victory === "monolith" ? -victoryLift * 0.055
                    : signatureDirection?.victory === "prowl" ? victoryLift * 0.045
                        : signatureDirection?.victory === "soar" ? -Math.sin(Math.PI * victoryP) * 0.08
                            : 0;
        const victoryYaw = !f.victorious ? 0
            : signatureDirection?.victory === "spiral" ? Math.sin(Math.PI * victoryP) * 0.22 * (signatureDirection?.asymmetry ?? variantSign)
                : signatureDirection?.victory === "salute" ? Math.sin(Math.PI * victoryP) * 0.08 * (signatureDirection?.asymmetry ?? variantSign)
                    : 0;
        const personalityPitch = idleSway * 0.012
            + (idle ? signatureDirection?.stance ?? 0 : 0)
            + (windup ? (performanceVariant - 1) * 0.028 - ((signatureDirection?.anticipation ?? 1) - 1) * 0.08 : 0)
            + (strike ? attackPulse * 0.025 * variantSign * signatureStrike : 0);
        const personalityRoll = idleSway * 0.014 * variantSign
            + (strike ? attackPulse * 0.035 * variantSign * signatureStrike : 0)
            + (dodge ? dodgeArc * (signatureDirection?.dodgeRoll ?? 0) : 0)
            + (f.victorious ? Math.sin(Math.PI * victoryP) * (0.045 * variantSign + (signatureDirection?.victoryTwist ?? 0)) : 0);
        const personalityYaw = idleSway * 0.024 * variantSign
            + (windup ? 0.035 * variantSign * (signatureDirection?.anticipation ?? 1) : 0)
            + (strike ? attackPulse * 0.055 * variantSign * signatureStrike : 0);
        const heroPose = petHeroBodyPose({
            style: f.moveStyle,
            motion: f.motion,
            motionAge,
            timeline,
            attackPulse,
            casting: f.casting,
        });
        const deathPose = petDeathChoreography(motionAge, config.targetHeight, config.profile);

        // Four-legged pets cannot convincingly strafe while their planted-foot
        // cycle points at the opponent. Face along travel during ordinary running,
        // then return to opponent-facing for dodge, windup, strike and reactions.
        const faceTravel = !f.lockTargetFacing && (authoredCombatRig || config.profile === "avian") && running;
        const [lookX, lookZ] = resolveCombatBodyFacing({
            faceX: f.faceX,
            faceZ: f.faceZ,
            moveX: f.moveX,
            moveZ: f.moveZ,
            motion: f.motion,
            motionAge,
            allowTravelFacing: faceTravel,
        });
        const faceLength = Math.hypot(lookX, lookZ);
        let turnBank = 0;
        if (faceLength > 0.01) {
            const wantedYaw = resolveCombatBodyYaw(lookX, lookZ, config.yawOffset);
            const yawError = Math.atan2(Math.sin(wantedYaw - r.rotation.y), Math.cos(wantedYaw - r.rotation.y));
            turnBank = authoredCombatRig && running ? THREE.MathUtils.clamp(-yawError * 0.1, -0.075, 0.075) : 0;
            const committedFacing = f.motion === "windup" || f.motion === "strike" || f.motion === "recover";
            // An attack is never allowed to begin with the model's back to its
            // target. Large discontinuities are corrected during anticipation;
            // smaller turns remain smoothly animated so ordinary movement never
            // snaps or jitters between competing travel/target headings.
            if (!facingInitialized.current) {
                // Spawn already looking at the supplied opponent vector. Smoothing
                // from Three's zero-yaw default exposed backs/sides for the first
                // visible frames, especially in the four-pet Coliseum layout.
                r.rotation.y = wantedYaw;
                facingInitialized.current = true;
            } else if (committedFacing && Math.abs(yawError) > Math.PI * 0.56) r.rotation.y = wantedYaw;
            else {
                const turnRate = committedFacing ? 24 : authoredCombatRig ? (faceTravel ? 11 : 13) : (faceTravel ? 15 : 12);
                r.rotation.y = smoothAngle(r.rotation.y, wantedYaw, Math.min(1, presentationDelta * turnRate));
            }
        }
        const utilityLift = restBreath * config.targetHeight * (config.profile === "heavy" ? 0.018 : 0.032);
        const rootHeight = bob + dodgeHeight + avianDiveArc + victoryArc + heroPose.lift + utilityLift + entryLift + (dead ? deathPose.lift - deathPose.sink : 0);
        r.position.y = THREE.MathUtils.lerp(r.position.y, dead ? rootHeight : Math.max(0, rootHeight), Math.min(1, presentationDelta * (avianDive || dodge || dead ? 18 : 12)));
        // The generated roster takes provide leg/head motion but their attack clip
        // has almost no centre-of-mass commitment. Layer one smooth, restrained
        // anime pose over state edges so the pet coils, drives through contact and
        // absorbs a hit without reintroducing the per-frame shake removed above.
        const baseAuthoredPitch = avianDive
            ? -0.06 - Math.sin(Math.PI * avianDiveP) * 0.12 + avianDiveP * 0.15
            : authoredCombatRig
            ? dead ? -0.72 * deathPose.fall : f.victorious ? -0.11 - victoryLift * 0.11 : dodge ? -0.1 * dodgeArc : windup ? -0.14 : strike ? 0.075 + 0.17 * attackPulse : f.motion === "recover" ? 0.045 : stagger ? -0.16
                : running ? (groundedAuthoredQuadruped ? 0.018 + strideWave * 0.022 : Math.min(0.09, 0.024 + f.speed * 0.007) + strideWave * 0.012) : 0
            : dead ? -1.42 * deathPose.fall
                : f.victorious ? (aquaticSeal ? -0.2 - victoryLift * 0.12 : -0.1)
                    : dodge ? (aquaticSeal ? -0.1 : -0.08) * dodgeArc
                        : windup ? (aquaticSeal ? -0.14 : -0.16)
                            : strike ? (aquaticSeal ? 0.2 * attackPulse : 0.2)
                                : stagger ? (aquaticSeal ? -0.2 : -0.18)
                                    : aquaticSeal && running ? -0.055 + sealStroke * 0.085 : 0;
        const baseAuthoredRoll = avianDive
            ? turnBank * 1.25 + Math.sin(avianDiveP * Math.PI * 2) * 0.025
            : authoredCombatRig
            ? dead ? 0.36 * deathPose.fall : f.victorious ? 0 : dodge ? 0.15 * dodgeArc : stagger ? 0.07
                : running ? (groundedAuthoredQuadruped ? turnBank * 0.55 + strideWave * 0.012 : turnBank + strideWave * 0.018) : strike ? -0.035 * attackPulse : 0
            : dead ? 0.58 * deathPose.fall
                : f.victorious ? (aquaticSeal ? Math.sin(Math.PI * victoryP) * 0.055 : 0)
                    : dodge ? (aquaticSeal ? 0.22 : 0.17) * dodgeArc
                    : aquaticSeal && stagger ? -0.16
                        : aquaticSeal && strike ? 0.13 * attackPulse
                            : aquaticSeal && running ? sealStroke * 0.075
                                : running ? Math.sin(timeline * gait) * 0.035 : 0;
        const authoredPitch = baseAuthoredPitch
            + heroPose.pitch
            + personalityPitch
            + entryPitch
            + victoryPitch
            - guardPlant * (config.profile === "heavy" ? 0.08 : 0.12)
            + restBreath * 0.055
            - dashDrive * (config.profile === "heavy" ? 0.055 : 0.095)
            + dashBrake * (config.profile === "heavy" ? 0.075 : 0.12)
            + contactPunch * (config.profile === "heavy" ? 0.065 : 0.1) * signatureStrike
            - recoilWeight * (config.profile === "heavy" ? 0.1 : 0.16) * signatureRecoil;
        const authoredRoll = baseAuthoredRoll + heroPose.roll
            + personalityRoll
            + entryRoll
            + (guard ? Math.sin(Math.min(1, motionAge / 0.34) * Math.PI) * 0.035 : 0)
            + (resting ? Math.sin(timeline * 2.2) * 0.018 : 0);
        b.rotation.x = THREE.MathUtils.lerp(b.rotation.x, authoredPitch, Math.min(1, presentationDelta * (dead ? 4 : 15)));
        b.rotation.y = THREE.MathUtils.lerp(b.rotation.y, heroPose.yaw + personalityYaw + entryYaw + victoryYaw, Math.min(1, presentationDelta * 13));
        b.rotation.z = THREE.MathUtils.lerp(b.rotation.z, authoredRoll, Math.min(1, presentationDelta * 11));
        const sx = authoredCombatRig
            ? dead ? 1 + 0.06 * deathPose.fall + 0.045 * deathPose.impact : f.victorious ? 1.025 + victoryLift * 0.012 : strike ? 1 - 0.04 * attackPulse : stagger ? 1.035 : running ? (groundedAuthoredQuadruped ? 1 : 1 + authoredRunWave * 0.012) : 1 + breath * 0.12
            : f.victorious ? (aquaticSeal ? 1.055 : 1.035) : dead ? 1 + 0.08 * deathPose.fall + 0.055 * deathPose.impact : stagger ? 1.07 : strike ? (aquaticSeal ? 0.965 : 0.94) : aquaticSeal && running ? 1 + breath * 0.45 + sealCompression * 0.025 : 1 + breath;
        const sy = authoredCombatRig
            ? dead ? 1 - 0.18 * deathPose.fall - 0.09 * deathPose.impact : f.victorious ? 1.045 + victoryLift * 0.025 : strike ? 1 + 0.04 * attackPulse : windup ? 0.97 : stagger ? 0.965 : running ? (groundedAuthoredQuadruped ? 1 : 1 - authoredRunWave * 0.018) : 1 - breath * 0.06
            : f.victorious ? (aquaticSeal ? 1.085 + victoryLift * 0.035 : 1.045) : dead ? 1 - 0.28 * deathPose.fall - 0.1 * deathPose.impact : stagger ? 0.88 : strike ? (aquaticSeal ? 1.12 : 1.08) : aquaticSeal && running ? 1 - breath * 0.2 - sealCompression * 0.035 : 1 - breath * 0.5;
        const sz = authoredCombatRig
            ? dead ? 1 + 0.08 * deathPose.fall + 0.04 * deathPose.impact : f.victorious ? 1.035 : strike ? 1 + 0.11 * attackPulse : windup ? 0.94 : f.motion === "recover" ? 1.025 : running ? (groundedAuthoredQuadruped ? 1 : 1 + authoredRunWave * 0.014) : 1 + breath * 0.12
            : f.victorious ? (aquaticSeal ? 1.075 : 1.035) : dead ? 1 + 0.05 * deathPose.fall + 0.045 * deathPose.impact : windup ? (aquaticSeal ? 0.93 : 0.9) : strike ? (aquaticSeal ? 1.18 : 1.13) : aquaticSeal && running ? 1 + breath * 0.4 + sealCompression * 0.055 : 1 + breath;
        const dashScaleX = 1 - dashDrive * 0.025 + contactPunch * 0.03 * signatureStrike + recoilWeight * 0.035 * signatureRecoil;
        const dashScaleY = 1 - dashDrive * (config.profile === "heavy" ? 0.045 : 0.075) - contactPunch * 0.075 * signatureStrike + recoilWeight * 0.065 * signatureRecoil;
        const dashScaleZ = 1 + dashDrive * (config.profile === "heavy" ? 0.085 : 0.13) * signatureStrike - dashBrake * 0.035 + contactPunch * 0.14 * signatureStrike - recoilWeight * 0.085 * signatureRecoil;
        const utilityScaleX = 1 + guardPlant * 0.075 + restBreath * 0.018;
        const utilityScaleY = 1 - guardPlant * 0.095 + restBreath * 0.055;
        const utilityScaleZ = 1 + guardPlant * 0.045 - restBreath * 0.018;
        const landingWeight = signatureDirection?.landingWeight ?? signatureWeight;
        const entranceScaleXz = 1 + entryLand * (config.profile === "heavy" ? 0.12 : 0.07) * landingWeight;
        const entranceScaleY = 1 - entryLand * (config.profile === "heavy" ? 0.16 : 0.1) * landingWeight;
        b.scale.x = THREE.MathUtils.lerp(b.scale.x, sx * heroPose.scaleX * dashScaleX * utilityScaleX * entranceScaleXz, Math.min(1, presentationDelta * 15));
        b.scale.y = THREE.MathUtils.lerp(b.scale.y, sy * heroPose.scaleY * dashScaleY * utilityScaleY * entranceScaleY, Math.min(1, presentationDelta * 15));
        b.scale.z = THREE.MathUtils.lerp(b.scale.z, sz * heroPose.scaleZ * dashScaleZ * utilityScaleZ * entranceScaleXz, Math.min(1, presentationDelta * 15));
        // A small side-to-side load and forward drive make the torso participate
        // in locomotion/attacks. Values stay below a paw width and are filtered,
        // so this adds weight without bringing back the earlier mesh jitter.
        const entrySide = entering && signatureDirection?.entrance === "phase"
            ? Math.sin(Math.PI * entranceP) * 0.13 * signatureDirection.asymmetry
            : entering && signatureDirection?.entrance === "coil"
                ? Math.sin(Math.PI * entranceP * 2) * 0.055 * signatureDirection.asymmetry
                : 0;
        const weightX = (aquaticSeal && running ? sealStroke * 0.026 : authoredCombatRig && running && !groundedAuthoredQuadruped ? strideWave * 0.022 : 0) + entrySide;
        const weightYBase = aquaticSeal && running ? -sealCompression * 0.016 : authoredCombatRig ? (running && !groundedAuthoredQuadruped ? -authoredRunWave * 0.018 : windup ? -0.024 : strike ? attackPulse * 0.016 : 0) : 0;
        const weightY = weightYBase - dashDrive * 0.024 + dashBrake * 0.012 - contactPunch * 0.034 + recoilWeight * 0.036
            - guardPlant * 0.045 + restBreath * 0.025;
        const locomotionDrive = aquaticSeal && running ? sealStroke * 0.045 : groundedAuthoredQuadruped && running ? strideWave * 0.018 : 0;
        const entryDrive = entering && signatureDirection?.entrance === "stalk" ? Math.sin(Math.PI * entranceP) * 0.075
            : entering && signatureDirection?.entrance === "vault" ? Math.sin(Math.PI * entranceP) * 0.055
                : 0;
        const driveZ = locomotionDrive + entryDrive
            + (authoredCombatRig && strike ? attackPulse * 0.13 * signatureStrike : authoredCombatRig && windup ? -0.048 * (signatureDirection?.anticipation ?? 1) : aquaticSeal && strike ? attackPulse * 0.09 * signatureStrike : aquaticSeal && windup ? -0.035 * (signatureDirection?.anticipation ?? 1) : 0)
            + heroPose.drive
            - guardPlant * 0.055
            + dashDrive * (config.profile === "heavy" ? 0.05 : 0.085)
            + contactPunch * (config.profile === "heavy" ? 0.12 : 0.17) * signatureStrike
            - recoilWeight * (config.profile === "heavy" ? 0.12 : 0.18) * signatureRecoil;
        const weightBlend = Math.min(1, presentationDelta * (f.motion === "dash" || strike || stagger ? 16 : 10));
        b.position.x = THREE.MathUtils.lerp(b.position.x, weightX, weightBlend);
        b.position.y = THREE.MathUtils.lerp(b.position.y, weightY, weightBlend);
        b.position.z = THREE.MathUtils.lerp(b.position.z, driveZ, weightBlend);

        const skeletal = prepared.clips.length > 0;
        // The rebuilt Selkie has a horizontal torso with a dedicated tail wave.
        // Height-based whole-mesh leaning bends that body like a card, so its
        // attacks/reactions use the root pose plus tail articulation instead.
        const lean = skeletal || aquaticSeal ? 0 : (strike ? 0.13 : windup ? -0.08 : stagger ? -0.11 : 0) / prepared.scale;
        const stride = skeletal ? 0 : (running ? Math.min(0.11, 0.025 + f.speed * 0.9) : 0) / prepared.scale;
        const twistBase = config.profile === "serpentine" ? 0.12 : config.profile === "avian" ? 0.07 : 0.04;
        const twist = skeletal || aquaticSeal ? 0 : (running || strike ? twistBase : twistBase * 0.25) / prepared.scale;
        const swim = aquaticSeal ? ((running ? 0.12 : 0.022) + (strike ? 0.07 : 0) + (dodge ? 0.055 : 0)) / prepared.scale : 0;
        const deformBlend = 1 - Math.exp(-presentationDelta * 18);
        for (const uniform of prepared.uniforms) {
            uniform.time.value = timeline;
            uniform.lean.value = THREE.MathUtils.lerp(uniform.lean.value, lean, deformBlend);
            uniform.stride.value = THREE.MathUtils.lerp(uniform.stride.value, stride, deformBlend);
            uniform.twist.value = THREE.MathUtils.lerp(uniform.twist.value, twist, deformBlend);
            uniform.swim.value = THREE.MathUtils.lerp(uniform.swim.value, swim, deformBlend);
        }

        const hit = Math.max(0, f.hit);
        const statusPulse = f.statuses.length ? 0.012 + Math.abs(Math.sin(timeline * 7)) * 0.018 : 0;
        const desperation = f.desperate ? 0.018 + Math.abs(Math.sin(timeline * 8)) * 0.024 : 0;
        // Impact readability comes from sparks, freeze frames, numbers, and camera
        // response. Keep mesh emission restrained so a hit never erases the model's
        // colours and surface planes with a full-body white flash.
        const glow = Math.max(hit * 0.12, f.casting ? 0.012 + Math.abs(Math.sin(timeline * 6)) * 0.02 : 0, statusPulse, desperation);
        for (const material of prepared.materials) {
            const pbr = material as THREE.MeshStandardMaterial & { isMeshToonMaterial?: boolean };
            if (!pbr.isMeshStandardMaterial && !pbr.isMeshToonMaterial) continue;
            if (ROSTER_VISUAL_ID.test(config.visualId)) {
                // Reassert the approved atlas every frame. This makes combat
                // robust against stale cached material instances and against any
                // status/hit branch attempting to tint a shared GLTF material.
                pbr.color.setHex(Number(pbr.userData.petAuthoredBaseColor ?? 0xffffff));
                const authoredMap = pbr.userData.petAuthoredMap as THREE.Texture | null | undefined;
                if (authoredMap) lockPetAtlas(pbr, authoredMap);
                if (surfaceTreatment) {
                    pbr.emissive.set(surfaceTreatment.emissive);
                    pbr.emissiveIntensity = Math.max(surfaceTreatment.emissiveIntensity, glow * 0.35);
                } else {
                    pbr.emissive.setHex(0x000000);
                    pbr.emissiveIntensity = 0;
                }
            } else {
                pbr.emissive.set(surfaceTreatment?.emissive ?? lightColor);
                pbr.emissiveIntensity = Math.max(
                    surfaceTreatment?.emissiveIntensity ?? 0,
                    glow,
                    Number(pbr.userData.petIdentityGlow ?? 0),
                );
            }
        }
        if (aura.current) {
            aura.current.intensity = THREE.MathUtils.lerp(aura.current.intensity, glow * 0.38, Math.min(1, presentationDelta * 12));
            aura.current.distance = f.casting ? 4.6 : 3.2;
        }
    });
    /* eslint-enable react-hooks/immutability */

    return (
        <group ref={root}>
            <group ref={body}>
                {prepared.outline && (
                    <group scale={prepared.scale * config.outlineScale}>
                        <primitive object={prepared.outline} position={prepared.offset} dispose={null} />
                    </group>
                )}
                <group scale={prepared.scale}>
                    <primitive object={prepared.surface} position={prepared.offset} dispose={null} />
                </group>
                {showIdentity && <PetIdentityEffects3D config={config} frame={frame} quality={quality} elementColor={lightColor} signature={signature} />}
            </group>
            {quality.dynamicPetLight && <pointLight ref={aura} color={lightColor} intensity={0} distance={3.2} decay={2} position={[0, config.targetHeight * 0.55, 0]} />}
        </group>
    );
}

/** Approved textured GLBs are the production combat bodies. Their dense surface
 * detail reads far more cleanly than the earlier primitive-built prototypes; the
 * shared deformation rig supplies combat motion until authored skeletal clips land. */
export function PetModel3D({ config, frame, element, showIdentity = true, surfaceTreatment, signature }: {
    config: PetCombatModelConfig;
    frame: MutableRefObject<PetModelFrame>;
    element?: string;
    showIdentity?: boolean;
    surfaceTreatment?: PetModelSurfaceTreatment;
    signature?: PetSignaturePerformance;
}) {
    return (
        <LoadedPetModel3D
            config={config}
            frame={frame}
            element={element}
            showIdentity={showIdentity}
            surfaceTreatment={surfaceTreatment}
            signature={signature}
        />
    );
}
