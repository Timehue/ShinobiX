import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { PetCombatModelConfig } from "../lib/pet-3d-models";
import { petVisualQuality, type PetVisualQualityConfig } from "../lib/pet-visual-quality";
import { PetIdentityEffects3D } from "./PetIdentityEffects3D";
import { bindPetAtlasTexture, copyPetAtlasSampling, lockPetAtlas } from "../lib/pet-atlas-material";
import { readPetGlbAtlas } from "../lib/pet-glb-atlas";

export type PetModelMotion =
    | "idle"
    | "run"
    | "dash"
    | "windup"
    | "strike"
    | "recover"
    | "stagger"
    | "dodge"
    | "dead";

export type PetModelFrame = {
    motion: PetModelMotion;
    moving: boolean;
    speed: number;
    moveX: number;
    moveZ: number;
    faceX: number;
    faceZ: number;
    hit: number;
    casting: boolean;
    desperate: boolean;
    statuses: readonly string[];
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
    hit: 0,
    casting: false,
    desperate: false,
    statuses: [],
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
    clipLow: { value: number };
    floorCut: { value: number };
    floorOutline: { value: number };
};

type PreparedModel = {
    surface: THREE.Group;
    outline: THREE.Group | null;
    offset: [number, number, number];
    scale: number;
    materials: THREE.Material[];
    uniforms: DeformUniforms[];
    clips: readonly THREE.AnimationClip[];
    geometries: THREE.BufferGeometry[];
};

const ELEMENT_LIGHT: Record<string, string> = {
    Fire: "#ff6a2c",
    Water: "#38bdf8",
    Wind: "#5eead4",
    Lightning: "#fde047",
    Earth: "#d6a76a",
};

const ELEMENT_SURFACE: Record<string, { low: string; high: string; strength: number }> = {
    Fire: { low: "#651a35", high: "#ff8a45", strength: 0.44 },
    Water: { low: "#0a526a", high: "#c8f5f4", strength: 0.5 },
    Wind: { low: "#397c70", high: "#d0fff2", strength: 0.38 },
    Lightning: { low: "#675516", high: "#fff1a8", strength: 0.4 },
    Earth: { low: "#9a7950", high: "#d6ad79", strength: 0.65 },
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
        clipLow: { value: clipLow },
        floorCut: { value: floorCut },
        floorOutline: { value: floorOutline ? 1 : 0 },
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
        shader.uniforms.uPetClipLow = bank.clipLow;
        shader.uniforms.uPetFloorCut = bank.floorCut;
        shader.uniforms.uPetFloorOutline = bank.floorOutline;
        shader.vertexShader = shader.vertexShader
            .replace(
                "#include <common>",
                "uniform float uPetLean,uPetStride,uPetTwist,uPetTime,uPetMinY,uPetInvH;\nvarying float vPetHeight;\n#include <common>",
            )
            .replace(
                "#include <begin_vertex>",
                "#include <begin_vertex>\nfloat petH=clamp((position.y-uPetMinY)*uPetInvH,0.0,1.0);\nvPetHeight=petH;\ntransformed.z += uPetLean*petH*petH;\ntransformed.x += sin(petH*4.5-uPetTime*7.0)*uPetTwist*petH;\ntransformed.y += sin(position.x*2.2+uPetTime*10.0)*uPetStride*(1.0-petH)*0.35;",
            );
        shader.fragmentShader = shader.fragmentShader
            .replace(
                "#include <common>",
                "uniform vec3 uPetLowTint,uPetHighTint;\nuniform float uPetTintStrength,uPetClipLow,uPetFloorCut,uPetFloorOutline;\nvarying float vPetHeight;\n#include <common>",
            )
            .replace(
                "#include <color_fragment>",
                "#include <color_fragment>\nif(vPetHeight<uPetClipLow) discard;\nif(uPetFloorCut>0.0&&vPetHeight<uPetFloorCut&&(uPetFloorOutline>0.5||min(min(diffuseColor.r,diffuseColor.g),diffuseColor.b)>0.58)) discard;\nvec3 petSurfaceTint=mix(uPetLowTint,uPetHighTint,smoothstep(0.08,0.92,vPetHeight));\ndiffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*petSurfaceTint,uPetTintStrength);",
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
    material.customProgramCacheKey = () => toonSurface ? "pet-combat-toon-v1" : animeSurface ? "pet-combat-anime-v5" : "pet-combat-deform-v3";
    material.needsUpdate = true;
}

function undeformedBounds(root: THREE.Group): THREE.Box3 {
    // Box3.setFromObject evaluates SkinnedMesh vertices. Some FBX→glTF animal rigs
    // carry a 100× armature conversion and that path applies the scale twice, yielding
    // a 500-unit box for a 5-unit shark. Geometry bounds transformed by matrixWorld are
    // the stable bind-pose bounds we need for presentation normalization.
    const result = new THREE.Box3();
    root.updateWorldMatrix(true, true);
    root.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
        if (!node.geometry.boundingBox) return;
        result.union(node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld));
    });
    return result;
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

function removeEarthSourceFloor(root: THREE.Group, config: PetCombatModelConfig): THREE.BufferGeometry[] {
    if (!config.visualId.startsWith("starter-earth")) return [];
    const owned: THREE.BufferGeometry[] = [];
    root.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        const geometry = node.geometry.clone();
        const position = geometry.getAttribute("position");
        const sourceIndex = geometry.index;
        if (!position || !sourceIndex) {
            geometry.dispose();
            return;
        }
        geometry.computeBoundingBox();
        const bounds = geometry.boundingBox;
        if (!bounds) {
            geometry.dispose();
            return;
        }
        // The image-to-3D Earth export contains a broad, nearly-flat white
        // reconstruction island under the feet. Drop only triangles whose three
        // vertices live in the bottom 4.5% of the source mesh; leg/foot sidewalls
        // extend above this slice and remain intact.
        const cut = bounds.min.y + (bounds.max.y - bounds.min.y) * 0.045;
        const kept: number[] = [];
        for (let i = 0; i < sourceIndex.count; i += 3) {
            const a = sourceIndex.getX(i);
            const b = sourceIndex.getX(i + 1);
            const c = sourceIndex.getX(i + 2);
            if (position.getY(a) <= cut && position.getY(b) <= cut && position.getY(c) <= cut) continue;
            kept.push(a, b, c);
        }
        geometry.setIndex(kept);
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        node.geometry = geometry;
        owned.push(geometry);
    });
    return owned;
}

function prepareModel(source: THREE.Group, config: PetCombatModelConfig, clips: readonly THREE.AnimationClip[], quality: PetVisualQualityConfig, element?: string, persistentAtlas?: THREE.Texture | null): PreparedModel {
    // SkeletonUtils is required for independent SkinnedMesh bone trees. Object3D.clone
    // shares skeleton bindings and causes one fighter's animation to corrupt the other.
    const surface = cloneSkeleton(source) as THREE.Group;
    stylizeApprovedRig(surface, config);
    const geometries = removeEarthSourceFloor(surface, config);
    const box = undeformedBounds(surface);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const offset: [number, number, number] = [-center.x, -box.min.y, -center.z];
    const fitSize = config.fit === "longest" ? Math.max(size.x, size.y, size.z) : size.y;
    const scale = config.targetHeight / Math.max(0.001, fitSize);
    const materials: THREE.Material[] = [];
    // Fighter materials are isolated, but GLTFLoader remains the sole owner of
    // their baked colour atlases. Cloning/disposing the Texture wrapper broke
    // colours after the real selection-screen preload + battle remount cycle.
    const uniforms: DeformUniforms[] = [];
    const tint = new THREE.Color(ELEMENT_LIGHT[String(element ?? "")] ?? "#c4b5fd");
    const tintAmount = element === "Water" ? 0.18 : element === "Fire" ? 0.1 : element === "Earth" ? 0.14 : 0.16;
    const surfaceTint = ELEMENT_SURFACE[String(element ?? "")];
    const clipLow = config.visualId.startsWith("starter-water") ? 0.32 : 0;
    const floorCut = 0;

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
                pbr.emissive?.setHex?.(0x000000);
                pbr.emissiveIntensity = 0;
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
            patchDeformation(material, box.min.y, size.y, uniforms, clipLow, floorCut);
            const uniform = uniforms[uniforms.length - 1];
            uniform.lowTint.value.set(surfaceTint?.low ?? "#ffffff");
            uniform.highTint.value.set(surfaceTint?.high ?? "#ffffff");
            uniform.tintStrength.value = clips.length ? Math.min(0.14, surfaceTint?.strength ?? 0) : surfaceTint?.strength ?? 0;
            materials.push(material);
            return material;
        });
        node.material = Array.isArray(node.material) ? cloned : cloned[0];
    });

    // The Earth reconstruction includes a broad source-image floor island. A
    // backface hull would outline that island as a black puddle, so the already
    // inked texture remains its silhouette treatment while the light floor
    // pixels are culled by the material pass above.
    const outline = quality.outline && config.outlineScale > 1.001 && !config.visualId.startsWith("starter-earth")
        ? cloneSkeleton(source) as THREE.Group
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
                patchDeformation(material, box.min.y, size.y, uniforms, clipLow, floorCut, floorCut > 0);
                materials.push(material);
                return material;
            });
            node.material = Array.isArray(node.material) ? outlined : outlined[0];
        });
    }

    return { surface, outline, offset, scale, materials, uniforms, clips, geometries };
}

const normalizedClipName = (clip: THREE.AnimationClip) => clip.name.split("|").at(-1)?.toLowerCase() ?? clip.name.toLowerCase();
const ROSTER_VISUAL_ID = /^(?:standard|rare|legendary|mythic)-\d+(?:-|$)/;
const AUTHORED_ROSTER_CLIPS = ["idle", "walk", "gallop", "gallop_jump", "attack", "idle_hitreact1", "idle_2", "death"] as const;

function isAuthoredRosterRig(visualId: string, clips: readonly THREE.AnimationClip[]): boolean {
    if (!ROSTER_VISUAL_ID.test(visualId)) return false;
    const names = new Set(clips.map(normalizedClipName));
    return AUTHORED_ROSTER_CLIPS.every((name) => names.has(name));
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
    // Keep the authored attack take alive from anticipation through follow-through.
    // Previously `windup -> strike -> recover` reset/cross-faded the same clip on
    // every state edge, so only its first few frames ever appeared in battle.
    if (frame.motion === "strike" || frame.motion === "windup" || frame.motion === "recover") return findClip(clips, ["attack"]);
    if (frame.motion === "stagger") return findClip(clips, ["idle_hitreact1", "out_of_water", "idle_hitreact2"]);
    if (frame.motion === "dodge") return findClip(clips, ["gallop_jump", "swimming_impulse", "jump_toidle", "swimming_fast"]);
    if (frame.motion === "dash") return findClip(clips, ["gallop", "swimming_fast", "swimming_impulse", "walk"]);
    if (frame.moving || frame.motion === "run") {
        // A fast quadruped using its walk take visibly skates across the floor.
        // Crossfade into the shorter gallop cycle once the presentation velocity
        // passes a real running pace. Floating/serpentine pets keep their authored
        // swim order because their movement does not imply planted foot contacts.
        if ((profile === "quadruped" || profile === "biped") && frame.speed >= 2.65) return findClip(clips, ["gallop", "walk"]);
        return findClip(clips, ["walk", "swimming_normal", "gallop"]);
    }
    if (frame.casting) return findClip(clips, ["idle_2", "swimming_impulse", "idle"]);
    return findClip(clips, ["idle", "swimming_normal", "idle_2"]);
}

type CombatAnimationFamily = "idle" | "locomotion" | "attack" | "dodge" | "hit" | "death";

function combatAnimationFamily(frame: PetModelFrame): CombatAnimationFamily {
    if (frame.motion === "dead") return "death";
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

function LoadedPetModel3D({ config, frame, element }: {
    config: PetCombatModelConfig;
    frame: MutableRefObject<PetModelFrame>;
    element?: string;
}) {
    const gltf = useGLTF(config.url) as { scene: THREE.Group; animations: THREE.AnimationClip[] };
    const persistentAtlas = ROSTER_VISUAL_ID.test(config.visualId) ? readPetGlbAtlas(config.url) : null;
    const quality = useMemo(() => petVisualQuality(), []);
    const prepared = useMemo(() => prepareModel(gltf.scene, config, gltf.animations ?? [], quality, element, persistentAtlas), [gltf.scene, gltf.animations, config, quality, element, persistentAtlas]);
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
    const lightColor = ELEMENT_LIGHT[String(element ?? "")] ?? "#c4b5fd";

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
        for (const geometry of prepared.geometries) geometry.dispose();
    }, [mixer, outlineMixer, prepared]);

    /* eslint-disable react-hooks/immutability -- Three.js uniforms and Object3D transforms are mutable render-loop state; mutating them inside useFrame is the R3F animation contract. */
    useFrame((state, delta) => {
        const r = root.current;
        const b = body.current;
        if (!r || !b) return;
        const f = frame.current;
        const authoredCombatRig = isAuthoredRosterRig(config.visualId, prepared.clips);
        const t = state.clock.elapsedTime;
        if (f.motion !== lastMotion.current) {
            lastMotion.current = f.motion;
            motionStart.current = t;
        }
        const motionAge = t - motionStart.current;
        const dodgeP = Math.min(1, motionAge / 0.2);
        const dodgeArc = f.motion === "dodge" ? Math.sin(Math.PI * dodgeP) : 0;
        if (mixer) {
            const clip = combatClip(prepared.clips, f, config.profile);
            const family = combatAnimationFamily(f);
            const oneShot = family === "death" || family === "dodge" || family === "hit" || family === "attack";
            const enteringOneShot = oneShot && activeFamily.current !== family;
            if (clip && (activeClip.current !== clip || enteringOneShot)) {
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
            const locomotionRate = authoredCombatRig
                ? f.motion === "dodge"
                    ? 1.16
                    : f.motion === "windup"
                        ? 0.76
                        : f.motion === "strike"
                            ? 1.48
                            : f.motion === "recover"
                                ? 1.04
                    : f.motion === "dash"
                        ? THREE.MathUtils.clamp(0.98 + f.speed * 0.16, 1.2, 2.15)
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
            const rateBlend = Math.min(1, delta * 8);
            if (activeAction.current) activeAction.current.timeScale = THREE.MathUtils.lerp(activeAction.current.timeScale, locomotionRate, rateBlend);
            if (activeOutlineAction.current) activeOutlineAction.current.timeScale = THREE.MathUtils.lerp(activeOutlineAction.current.timeScale, locomotionRate, rateBlend);
            mixer.update(delta);
            outlineMixer?.update(delta);
        }
        const gait = config.profile === "heavy" ? 8.8 : config.profile === "avian" ? 14 : 12.2;
        const profileBounce = config.profile === "heavy" ? 0.045 : config.profile === "serpentine" ? 0.08 : 0.065;
        // Dodge owns one clean hop cycle. Do not layer the ordinary running gait
        // underneath it or loop the lean; that combination reads as mesh jitter.
        const running = (f.moving && f.motion !== "dodge") || f.motion === "run" || f.motion === "dash";
        const strike = f.motion === "strike" ? 1 : 0;
        const windup = f.motion === "windup" ? 1 : 0;
        const stagger = f.motion === "stagger" ? 1 : 0;
        const dodge = f.motion === "dodge" ? 1 : 0;
        const dead = f.motion === "dead" ? 1 : 0;
        const breath = Math.sin(t * (f.desperate ? 7.2 : 3.6)) * (f.desperate ? 0.035 : 0.018);
        const runWave = running && !authoredCombatRig ? Math.abs(Math.sin(t * gait)) : 0;
        const bob = runWave * profileBounce + (f.casting && !authoredCombatRig ? Math.sin(t * 6) * 0.045 : 0);

        // Four-legged pets cannot convincingly strafe while their planted-foot
        // cycle points at the opponent. Face along travel during ordinary running,
        // then return to opponent-facing for dodge, windup, strike and reactions.
        const faceTravel = authoredCombatRig && f.moving
            && f.motion !== "dodge" && f.motion !== "windup" && f.motion !== "strike"
            && f.motion !== "stagger" && f.motion !== "dead";
        const lookX = faceTravel ? f.moveX : f.faceX;
        const lookZ = faceTravel ? f.moveZ : f.faceZ;
        const faceLength = Math.hypot(lookX, lookZ);
        if (faceLength > 0.01) {
            const wantedYaw = Math.atan2(lookX, lookZ) + config.yawOffset;
            const turnRate = authoredCombatRig ? (faceTravel ? 7.5 : 9) : (faceTravel ? 13 : 10);
            r.rotation.y = smoothAngle(r.rotation.y, wantedYaw, Math.min(1, delta * turnRate));
        }
        r.position.y = THREE.MathUtils.lerp(r.position.y, Math.max(0, bob), Math.min(1, delta * 12));
        // The generated roster takes provide leg/head motion but their attack clip
        // has almost no centre-of-mass commitment. Layer one smooth, restrained
        // anime pose over state edges so the pet coils, drives through contact and
        // absorbs a hit without reintroducing the per-frame shake removed above.
        const authoredPitch = authoredCombatRig
            ? dead ? -0.18 : dodge ? -0.07 * dodgeArc : windup ? -0.11 : strike ? 0.14 : f.motion === "recover" ? 0.035 : stagger ? -0.12
                : running ? Math.min(0.085, 0.025 + f.speed * 0.008) : 0
            : dead ? -1.42 : dodge ? -0.08 * dodgeArc : windup ? -0.16 : strike ? 0.2 : stagger ? -0.18 : 0;
        const authoredRoll = authoredCombatRig
            ? dead ? 0.08 : dodge ? 0.12 * dodgeArc : stagger ? 0.055 : 0
            : dead ? 0.58 : dodge ? 0.17 * dodgeArc : running ? Math.sin(t * gait) * 0.035 : 0;
        b.rotation.x = THREE.MathUtils.lerp(b.rotation.x, authoredPitch, Math.min(1, delta * (dead ? 4 : 15)));
        b.rotation.z = THREE.MathUtils.lerp(b.rotation.z, authoredRoll, Math.min(1, delta * 11));
        const sx = authoredCombatRig
            ? strike ? 0.96 : stagger ? 1.035 : 1 + breath * 0.12
            : dead ? 1.08 : stagger ? 1.07 : strike ? 0.94 : 1 + breath;
        const sy = authoredCombatRig
            ? strike ? 1.035 : windup ? 0.97 : stagger ? 0.965 : 1 - breath * 0.06
            : dead ? 0.72 : stagger ? 0.88 : strike ? 1.08 : 1 - breath * 0.5;
        const sz = authoredCombatRig
            ? strike ? 1.085 : windup ? 0.94 : f.motion === "recover" ? 1.025 : 1 + breath * 0.12
            : dead ? 1.05 : windup ? 0.9 : strike ? 1.13 : 1 + breath;
        b.scale.x = THREE.MathUtils.lerp(b.scale.x, sx, Math.min(1, delta * 13));
        b.scale.y = THREE.MathUtils.lerp(b.scale.y, sy, Math.min(1, delta * 13));
        b.scale.z = THREE.MathUtils.lerp(b.scale.z, sz, Math.min(1, delta * 13));

        const skeletal = prepared.clips.length > 0;
        const lean = skeletal ? 0 : (strike ? 0.13 : windup ? -0.08 : stagger ? -0.11 : 0) / prepared.scale;
        const stride = skeletal ? 0 : (running ? Math.min(0.11, 0.025 + f.speed * 0.9) : 0) / prepared.scale;
        const twistBase = config.profile === "serpentine" ? 0.12 : config.profile === "avian" ? 0.07 : 0.04;
        const twist = skeletal ? 0 : (running || strike ? twistBase : twistBase * 0.25) / prepared.scale;
        for (const uniform of prepared.uniforms) {
            uniform.time.value = t;
            uniform.lean.value = THREE.MathUtils.lerp(uniform.lean.value, lean, 0.28);
            uniform.stride.value = THREE.MathUtils.lerp(uniform.stride.value, stride, 0.24);
            uniform.twist.value = THREE.MathUtils.lerp(uniform.twist.value, twist, 0.22);
        }

        const hit = Math.max(0, f.hit);
        const statusPulse = f.statuses.length ? 0.012 + Math.abs(Math.sin(t * 7)) * 0.018 : 0;
        const desperation = f.desperate ? 0.018 + Math.abs(Math.sin(t * 8)) * 0.024 : 0;
        // Impact readability comes from sparks, freeze frames, numbers, and camera
        // response. Keep mesh emission restrained so a hit never erases the model's
        // colours and surface planes with a full-body white flash.
        const glow = Math.max(hit * 0.12, f.casting ? 0.012 + Math.abs(Math.sin(t * 6)) * 0.02 : 0, statusPulse, desperation);
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
                pbr.emissive.setHex(0x000000);
                pbr.emissiveIntensity = 0;
            } else {
                pbr.emissive.set(lightColor);
                pbr.emissiveIntensity = Math.max(glow, Number(pbr.userData.petIdentityGlow ?? 0));
            }
        }
        if (aura.current) {
            aura.current.intensity = THREE.MathUtils.lerp(aura.current.intensity, glow * 0.38, Math.min(1, delta * 12));
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
                <PetIdentityEffects3D config={config} frame={frame} quality={quality} />
            </group>
            {quality.dynamicPetLight && <pointLight ref={aura} color={lightColor} intensity={0} distance={3.2} decay={2} position={[0, config.targetHeight * 0.55, 0]} />}
        </group>
    );
}

/** Approved textured GLBs are the production combat bodies. Their dense surface
 * detail reads far more cleanly than the earlier primitive-built prototypes; the
 * shared deformation rig supplies combat motion until authored skeletal clips land. */
export function PetModel3D({ config, frame, element }: {
    config: PetCombatModelConfig;
    frame: MutableRefObject<PetModelFrame>;
    element?: string;
}) {
    return <LoadedPetModel3D config={config} frame={frame} element={element} />;
}
