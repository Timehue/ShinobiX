import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as THREE from "three";
import { rawPetPool } from "../src/data/pet-pool.ts";
import { STARTER_PETS } from "../src/data/starter-pets.ts";
import { STARTER_EVOLUTIONS } from "../src/data/pet-evolutions.ts";
import { petCombatFamily } from "../src/lib/pet-combat-family.ts";
import { petSignaturePerformance } from "../src/lib/pet-signature-performance.ts";
import {
    INDIVIDUAL_PET_ANIMATION_MODEL_IDS,
    PROPER_PET_ANIMATION_ASSET_REVISION,
} from "../src/lib/pet-proper-animation-assets.ts";

/**
 * Bakes proper combat clips into every production pet GLB that does not already
 * have a more detailed individual animation bank. The output is idempotent: on
 * rerun, the previously appended authored data is trimmed back to the recorded
 * source boundary before a fresh bank is written.
 */

const align4 = (value) => (value + 3) & ~3;
const N = [0, 0, 0];
const r = (node, values) => ({ node, path: "rotation", values });
const t = (node, values) => ({ node, path: "translation", values });
const clip = (name, times, tracks) => ({ name, times, tracks });
const rootPath = resolve(import.meta.dirname, "..");
const manifestPath = resolve(rootPath, "public/pet-models/roster-manifest.json");

function invariant(condition, message) {
    if (!condition) throw new Error(message);
}

function parseGlb(file, id) {
    invariant(file.readUInt32LE(0) === 0x46546c67, `${id}: missing GLB magic`);
    invariant(file.readUInt32LE(4) === 2, `${id}: expected glTF 2.0`);
    const jsonLength = file.readUInt32LE(12);
    invariant(file.readUInt32LE(16) === 0x4e4f534a, `${id}: JSON chunk missing`);
    const json = JSON.parse(file.subarray(20, 20 + jsonLength).toString("utf8").replace(/[\0\s]+$/u, ""));
    const binHeader = 20 + jsonLength;
    invariant(file.readUInt32LE(binHeader + 4) === 0x004e4942, `${id}: BIN chunk missing`);
    const binLength = file.readUInt32LE(binHeader);
    return { json, bin: file.subarray(binHeader + 8, binHeader + 8 + binLength) };
}

function encodeGlb(json, binary) {
    const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
    const jsonLength = align4(jsonBytes.byteLength);
    const binLength = align4(binary.byteLength);
    const output = new Uint8Array(12 + 8 + jsonLength + 8 + binLength);
    const view = new DataView(output.buffer);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, output.byteLength, true);
    view.setUint32(12, jsonLength, true);
    view.setUint32(16, 0x4e4f534a, true);
    output.fill(0x20, 20, 20 + jsonLength);
    output.set(jsonBytes, 20);
    const binHeader = 20 + jsonLength;
    view.setUint32(binHeader, binLength, true);
    view.setUint32(binHeader + 4, 0x004e4942, true);
    output.set(binary, binHeader + 8);
    return output;
}

function hashUnit(value) {
    let hash = 2166136261;
    for (const character of value) {
        hash ^= character.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 0xffffffff;
}

const FAMILY_TUNING = Object.freeze({
    pouncer: { pace: 0.9, stride: 1.06, bounce: 1.08, crouch: 1.18, attack: 1.14, air: 1.18, weight: 0.88, tail: 1.2 },
    "pack-hunter": { pace: 0.94, stride: 1, bounce: 0.92, crouch: 1.05, attack: 1.08, air: 0.98, weight: 1, tail: 1.05 },
    charger: { pace: 1.02, stride: 0.94, bounce: 0.8, crouch: 0.82, attack: 1.2, air: 0.72, weight: 1.22, tail: 0.78 },
    "burrow-grappler": { pace: 0.98, stride: 0.8, bounce: 0.72, crouch: 1.25, attack: 0.98, air: 0.74, weight: 1.18, tail: 0.72 },
    armored: { pace: 1.18, stride: 0.66, bounce: 0.48, crouch: 0.72, attack: 0.96, air: 0.46, weight: 1.45, tail: 0.5 },
    avian: { pace: 0.86, stride: 0.92, bounce: 1.12, crouch: 0.72, attack: 1.12, air: 1.38, weight: 0.72, tail: 0.72 },
    serpentine: { pace: 1.02, stride: 0.58, bounce: 0.62, crouch: 0.88, attack: 1.08, air: 0.66, weight: 0.9, tail: 1.42 },
    amphibious: { pace: 1.04, stride: 0.78, bounce: 0.78, crouch: 1.05, attack: 0.94, air: 0.88, weight: 1.05, tail: 1.1 },
    hopper: { pace: 0.82, stride: 1.06, bounce: 1.42, crouch: 1.32, attack: 1.04, air: 1.5, weight: 0.72, tail: 0.9 },
    reptilian: { pace: 0.94, stride: 0.86, bounce: 0.64, crouch: 1.05, attack: 1.12, air: 0.82, weight: 0.94, tail: 1.35 },
    rodent: { pace: 0.76, stride: 1.18, bounce: 1.08, crouch: 0.94, attack: 0.94, air: 1.12, weight: 0.62, tail: 1.2 },
    primate: { pace: 0.92, stride: 0.94, bounce: 0.9, crouch: 0.96, attack: 1.2, air: 0.9, weight: 1.06, tail: 0.7 },
    aquatic: { pace: 1.08, stride: 0.6, bounce: 0.54, crouch: 0.82, attack: 1.04, air: 0.62, weight: 0.92, tail: 1.52 },
    dragon: { pace: 1.16, stride: 0.82, bounce: 0.74, crouch: 0.86, attack: 1.28, air: 0.92, weight: 1.36, tail: 1.32 },
    skirmisher: { pace: 0.94, stride: 0.98, bounce: 0.9, crouch: 0.96, attack: 1, air: 1, weight: 0.94, tail: 0.9 },
});

function tuningFor(pet, family, profile) {
    const id = pet.id;
    const base = FAMILY_TUNING[family] ?? FAMILY_TUNING.skirmisher;
    const signature = petSignaturePerformance({
        id,
        name: pet.name,
        element: pet.element,
        rarity: pet.rarity,
        profile,
    });
    // Family language remains the foundation, but no two species inherit the
    // same numeric take. These dimensions are already consumed throughout all
    // eight banks, so the identity sheet changes breathing, gait, airborne
    // travel, anticipation, contact extension, tail follow-through and collapse
    // directly in the exported skeletal keyframes.
    return {
        ...base,
        pace: base.pace / signature.cadence,
        stride: base.stride * (0.91 + hashUnit(`${id}:stride`) * 0.18) * (0.96 + signature.agility * 0.04),
        bounce: base.bounce * (0.9 + hashUnit(`${id}:bounce`) * 0.2) * signature.breath,
        crouch: base.crouch * (0.9 + hashUnit(`${id}:crouch`) * 0.18) * signature.anticipation,
        attack: base.attack * (0.88 + hashUnit(`${id}:attack`) * 0.18) * signature.strikeDrive,
        air: base.air * (0.88 + hashUnit(`${id}:air`) * 0.2) * signature.dodgeLift,
        weight: base.weight * (0.9 + hashUnit(`${id}:weight`) * 0.18) * (0.78 + signature.weight * 0.22),
        tail: base.tail * (0.86 + hashUnit(`${id}:tail`) * 0.28),
        side: signature.asymmetry,
        signature,
    };
}

function scaledTimes(values, pace) {
    return values.map((value) => Number((value * pace).toFixed(4)));
}

function rigType(nodes) {
    if (nodes.has("claw_upper.L")) return "crab";
    if (nodes.has("wing_high.L")) return "moth";
    if (nodes.has("thorax")) return "insect";
    if (nodes.has("bat_wing_upper.L")) return "bat";
    if (nodes.has("wing_upper.L")) return "avian";
    if (nodes.has("upper_arm.L")) return "biped";
    if (nodes.has("front_upper.L")) return "quadruped";
    throw new Error("Unknown production pet rig topology");
}

function quadrupedBank(p, family) {
    const fL = "front_upper.L", fR = "front_upper.R", hL = "hind_upper.L", hR = "hind_upper.R";
    const charge = family === "charger" || family === "armored";
    const leap = charge ? 0.045 : 0.105 * p.air;
    const coil = 0.24 * p.crouch;
    const side = p.side;
    return [
        clip("idle", scaledTimes([0, 0.45, 0.9, 1.35, 1.8], p.pace), [
            t("root", [N, [0, 0.014 * p.bounce, 0], N, [0, 0.01 * p.bounce, 0], N]),
            r("spine", [[-0.035, 0, 0], [-0.065, 0.015, 0.012], [-0.035, 0, 0], [-0.058, -0.015, -0.012], [-0.035, 0, 0]]),
            r("head", [[0.025, -0.08, 0], [0.055, 0.12, 0.025], [0.015, 0.04, 0], [0.05, -0.14, -0.025], [0.025, -0.08, 0]]),
            r("tail_1", [[0, -0.05 * p.tail, 0], [0.025, 0.11 * p.tail, 0.03], [0, 0.02, 0], [-0.025, -0.12 * p.tail, -0.03], [0, -0.05 * p.tail, 0]]),
        ]),
        clip("idle_2", scaledTimes([0, 0.16, 0.38, 0.66, 0.98, 1.3], p.pace), [
            t("root", [N, [0, -0.018 * p.crouch, -0.02], [0, 0.05 * p.bounce, 0.015], [0, 0.018, 0], [0, -0.006, 0], N]),
            r("chest", [N, [-0.12 * p.crouch, 0, 0], [0.14, 0, 0], [0.05, 0, 0], [-0.03, 0, 0], N]),
            r("head", [[0, -0.08, 0], [0.12, -0.16, 0], [-0.1, 0.18, 0], [0.04, 0.12, 0], [0.02, -0.04, 0], [0, -0.08, 0]]),
            r(fL, [N, [0.16, 0, -0.04], [-0.24 * p.crouch, 0, -0.08], [0.08, 0, -0.02], N, N]),
            r(fR, [N, [0.16, 0, 0.04], [-0.24 * p.crouch, 0, 0.08], [0.08, 0, 0.02], N, N]),
        ]),
        clip("walk", scaledTimes([0, 0.24, 0.48, 0.72, 0.96], p.pace), [
            t("root", [N, [0, 0.032 * p.bounce, 0.012], [0, 0.004, 0.025], [0, 0.032 * p.bounce, 0.012], N]),
            r("spine", [[-0.055, 0, 0], [0.025, 0, 0], [-0.055, 0, 0], [0.025, 0, 0], [-0.055, 0, 0]]),
            r(fL, [[-0.42 * p.stride, 0, 0.03], [0.04, 0, 0], [0.42 * p.stride, 0, -0.03], [0.04, 0, 0], [-0.42 * p.stride, 0, 0.03]]),
            r(fR, [[0.42 * p.stride, 0, -0.03], [0.04, 0, 0], [-0.42 * p.stride, 0, 0.03], [0.04, 0, 0], [0.42 * p.stride, 0, -0.03]]),
            r(hL, [[0.38 * p.stride, 0, 0.03], [0.04, 0, 0], [-0.38 * p.stride, 0, -0.03], [0.04, 0, 0], [0.38 * p.stride, 0, 0.03]]),
            r(hR, [[-0.38 * p.stride, 0, -0.03], [0.04, 0, 0], [0.38 * p.stride, 0, 0.03], [0.04, 0, 0], [-0.38 * p.stride, 0, -0.03]]),
        ]),
        clip("gallop", scaledTimes([0, 0.15, 0.3, 0.45, 0.6], p.pace), [
            t("root", [N, [0, 0.085 * p.bounce, 0.035], [0, 0.024, 0.07], [0, 0.09 * p.bounce, 0.035], N]),
            r("spine", [[-0.18, 0, 0], [0.16, 0, 0], [-0.2, 0, 0], [0.18, 0, 0], [-0.18, 0, 0]]),
            r(fL, [[-0.62 * p.stride, 0, 0.03], [0.12, 0, 0], [0.58 * p.stride, 0, -0.03], [0.1, 0, 0], [-0.62 * p.stride, 0, 0.03]]),
            r(fR, [[-0.56 * p.stride, 0, -0.03], [0.1, 0, 0], [0.64 * p.stride, 0, 0.03], [0.12, 0, 0], [-0.56 * p.stride, 0, -0.03]]),
            r(hL, [[0.62 * p.stride, 0, 0.03], [-0.12, 0, 0], [-0.58 * p.stride, 0, -0.03], [-0.08, 0, 0], [0.62 * p.stride, 0, 0.03]]),
            r(hR, [[0.56 * p.stride, 0, -0.03], [-0.08, 0, 0], [-0.62 * p.stride, 0, 0.03], [-0.12, 0, 0], [0.56 * p.stride, 0, -0.03]]),
            r("tail_1", [[0, -0.1 * p.tail, 0], [0.05, 0.07 * p.tail, 0.02], [0, 0.12 * p.tail, 0], [-0.05, -0.05 * p.tail, -0.02], [0, -0.1 * p.tail, 0]]),
        ]),
        clip("gallop_jump", scaledTimes([0, 0.1, 0.24, 0.42, 0.64], p.pace), [
            t("root", [N, [0.035 * side, 0.06, -0.02], [0.12 * side, 0.18 * p.air, 0.03], [0.065 * side, 0.11 * p.air, 0.06], N]),
            r("pelvis", [N, [-0.12, 0, 0.08 * side], [0.18, 0, 0.2 * side], [0.08, 0, -0.08 * side], N]),
            r(fL, [N, [-0.36, 0, -0.08], [-0.6, 0, -0.16], [0.25, 0, 0.06], N]),
            r(fR, [N, [-0.32, 0, 0.08], [-0.54, 0, 0.16], [0.28, 0, -0.06], N]),
            r(hL, [N, [0.32, 0, 0.05], [0.58, 0, 0.1], [-0.2, 0, -0.04], N]),
            r(hR, [N, [0.28, 0, -0.05], [0.54, 0, -0.1], [-0.26, 0, 0.04], N]),
        ]),
        clip("attack", scaledTimes([0, 0.12, 0.3, 0.4, 0.54, 0.7, 0.85, 1], p.pace), [
            t("root", [N, [0, -0.03 * p.crouch, -0.04], [0, -0.045 * p.crouch, -0.075], [0, leap * 0.45, 0.1], [0, leap, 0.19 * p.attack], [0, leap * 0.35, 0.1], [0, 0, 0.025], N]),
            r("spine", [N, [-0.18 * p.crouch, 0, 0], [-coil, 0, 0], [0.2, 0, 0], [0.38 * p.attack, 0, 0], [0.15, 0, 0], [-0.05, 0, 0], N]),
            r("head", [[0, -0.06, 0], [0.14, -0.08, 0], [0.24, 0.08, 0], [-0.18, 0, 0], [-0.42 * p.attack, 0.04, 0], [-0.14, -0.04, 0], [0.03, -0.03, 0], [0, -0.06, 0]]),
            r(fL, [N, [-0.36, 0, -0.1], [-0.58, 0, -0.16], [0.4, 0, 0.07], [0.66 * p.attack, 0, 0.1], [0.16, 0, 0.02], N, N]),
            r(fR, [N, [-0.32, 0, 0.1], [-0.54, 0, 0.16], [0.36, 0, -0.07], [0.6 * p.attack, 0, -0.1], [0.14, 0, -0.02], N, N]),
            r(hL, [N, [0.2, 0, 0], [0.44, 0, 0], [0.08, 0, 0], [-0.16, 0, 0], [0.03, 0, 0], N, N]),
            r(hR, [N, [0.2, 0, 0], [0.44, 0, 0], [0.08, 0, 0], [-0.16, 0, 0], [0.03, 0, 0], N, N]),
        ]),
        clip("idle_hitreact1", scaledTimes([0, 0.08, 0.2, 0.38, 0.56], p.pace), [
            t("root", [N, [0.018 * side, -0.03, -0.09], [-0.008 * side, -0.01, -0.03], [0, 0.004, -0.01], N]),
            r("spine", [N, [-0.26 / p.weight, 0.05, 0.16 * side], [0.14, -0.03, -0.08 * side], [-0.04, 0, 0], N]),
            r("head", [[0, -0.06, 0], [0.32 / p.weight, -0.12 * side, -0.24 * side], [-0.11, 0.05 * side, 0.11 * side], [0.04, 0, 0], [0, -0.06, 0]]),
            r(fL, [N, [-0.34, 0, -0.14], [0.18, 0, 0.07], [-0.05, 0, -0.02], N]),
            r(fR, [N, [-0.31, 0, 0.14], [0.21, 0, -0.07], [-0.05, 0, 0.02], N]),
        ]),
        clip("death", scaledTimes([0, 0.1, 0.28, 0.52, 0.8, 1.1, 1.45], Math.max(0.94, p.pace * p.weight * 0.8)), [
            t("root", [N, [0, 0.035, -0.035], [0.02 * side, -0.01, -0.085], [0.06 * side, -0.11, -0.055], [0.085 * side, -0.23, -0.02], [0.095 * side, -0.29, 0], [0.095 * side, -0.3, 0]]),
            r("pelvis", [N, [-0.08, 0, -0.06 * side], [0.1, 0, 0.22 * side], [0.16, 0, 0.58 * side], [0.14, 0, 0.98 * side], [0.12, 0, 1.12 * side], [0.12, 0, 1.14 * side]]),
            r("spine", [N, [0.08, 0, 0], [-0.14, 0, -0.08 * side], [-0.28, 0, -0.14 * side], [-0.38, 0, -0.1 * side], [-0.42, 0, -0.08 * side], [-0.42, 0, -0.08 * side]]),
            r("head", [[0, -0.06, 0], [-0.08, 0.05, 0], [0.2, -0.08, -0.1 * side], [0.42, 0, -0.18 * side], [0.58, 0, -0.16 * side], [0.68, 0, -0.12 * side], [0.7, 0, -0.12 * side]]),
            r(fL, [N, [-0.28, 0, -0.1], [0.34, 0, 0.13], [0.56, 0, 0.18], [0.22, 0, 0.07], [0.16, 0, 0.05], [0.16, 0, 0.05]]),
            r(fR, [N, [-0.28, 0, 0.1], [0.34, 0, -0.13], [-0.1, 0, -0.09], [-0.25, 0, -0.07], [-0.28, 0, -0.05], [-0.28, 0, -0.05]]),
        ]),
    ];
}

function serpentineBank(p) {
    const side = p.side;
    const sway = 0.2 * p.tail;
    return [
        clip("idle", scaledTimes([0, 0.5, 1, 1.5, 2], p.pace), [
            t("root", [N, [0, 0.012, 0], N, [0, 0.01, 0], N]),
            r("spine", [[0, -sway * 0.35, 0], [0.03, sway * 0.45, 0.04], [0, sway * 0.2, 0], [-0.03, -sway * 0.5, -0.04], [0, -sway * 0.35, 0]]),
            r("head", [[0.02, -0.12, 0], [0.06, 0.16, 0.04], [0.01, 0.04, 0], [0.05, -0.18, -0.04], [0.02, -0.12, 0]]),
            r("tail_1", [[0, -sway, 0], [0.04, sway, 0.03], [0, sway * 0.4, 0], [-0.04, -sway, -0.03], [0, -sway, 0]]),
            r("tail_2", [[0, sway, 0], [-0.03, -sway, -0.02], [0, -sway * 0.4, 0], [0.03, sway, 0.02], [0, sway, 0]]),
        ]),
        clip("idle_2", scaledTimes([0, 0.2, 0.46, 0.76, 1.08, 1.4], p.pace), [
            t("root", [N, [0, -0.015, -0.02], [0, 0.055, 0], [0, 0.02, 0], [0, -0.005, 0], N]),
            r("chest", [N, [-0.12, -0.1 * side, 0], [0.18, 0.18 * side, 0.08 * side], [0.06, 0.1 * side, 0.03], [-0.04, -0.04 * side, 0], N]),
            r("head", [[0, -0.1, 0], [0.12, -0.2 * side, 0], [-0.14, 0.24 * side, 0.08 * side], [0.04, 0.14 * side, 0.03], [0, -0.05, 0], [0, -0.1, 0]]),
            r("tail_1", [N, [0, -0.14 * side, 0], [0.05, 0.28 * side, 0.06], [0, 0.12 * side, 0], [-0.03, -0.08 * side, -0.03], N]),
        ]),
        clip("walk", scaledTimes([0, 0.25, 0.5, 0.75, 1], p.pace), [
            t("root", [N, [0, 0.018, 0.016], [0, 0.005, 0.032], [0, 0.018, 0.016], N]),
            r("spine", [[0, -sway, -0.04], [0, 0, 0.04], [0, sway, -0.04], [0, 0, 0.04], [0, -sway, -0.04]]),
            r("chest", [[0, sway * 0.45, 0.03], [0, 0, -0.03], [0, -sway * 0.45, 0.03], [0, 0, -0.03], [0, sway * 0.45, 0.03]]),
            r("tail_1", [[0, sway, 0], [0, 0, 0], [0, -sway, 0], [0, 0, 0], [0, sway, 0]]),
            r("tail_2", [[0, -sway, 0], [0, 0, 0], [0, sway, 0], [0, 0, 0], [0, -sway, 0]]),
        ]),
        clip("gallop", scaledTimes([0, 0.18, 0.36, 0.54, 0.72], p.pace), [
            t("root", [N, [0, 0.035, 0.04], [0, 0.012, 0.08], [0, 0.035, 0.04], N]),
            r("spine", [[0, -sway * 1.5, -0.08], [0, 0.12 * side, 0.08], [0, sway * 1.5, -0.08], [0, -0.12 * side, 0.08], [0, -sway * 1.5, -0.08]]),
            r("chest", [[0, sway * 0.7, 0.05], [0, -0.08 * side, -0.05], [0, -sway * 0.7, 0.05], [0, 0.08 * side, -0.05], [0, sway * 0.7, 0.05]]),
            r("tail_1", [[0, sway * 1.4, 0], [0, 0, 0], [0, -sway * 1.4, 0], [0, 0, 0], [0, sway * 1.4, 0]]),
            r("tail_2", [[0, -sway * 1.3, 0], [0, 0, 0], [0, sway * 1.3, 0], [0, 0, 0], [0, -sway * 1.3, 0]]),
        ]),
        clip("gallop_jump", scaledTimes([0, 0.12, 0.28, 0.46, 0.68], p.pace), [
            t("root", [N, [0.04 * side, 0.04, -0.02], [0.13 * side, 0.11 * p.air, 0.03], [0.07 * side, 0.07 * p.air, 0.06], N]),
            r("spine", [N, [-0.1, -0.2 * side, 0.12 * side], [-0.16, -0.38 * side, 0.28 * side], [0.1, 0.2 * side, -0.12 * side], N]),
            r("tail_1", [N, [0.1, 0.24 * side, 0], [0.18, 0.46 * side, 0.08], [-0.08, -0.24 * side, -0.04], N]),
            r("tail_2", [N, [-0.08, -0.24 * side, 0], [-0.14, -0.44 * side, -0.08], [0.06, 0.22 * side, 0.04], N]),
        ]),
        clip("attack", scaledTimes([0, 0.14, 0.3, 0.42, 0.56, 0.7, 0.86, 1.02], p.pace), [
            t("root", [N, [0, -0.02, -0.04], [0, -0.03, -0.07], [0, 0.03, 0.09], [0, 0.055, 0.19 * p.attack], [0, 0.025, 0.1], [0, 0, 0.025], N]),
            r("spine", [N, [-0.14, -0.22 * side, 0], [-0.22, -0.38 * side, 0.08], [0.18, 0.2 * side, -0.04], [0.34, 0.42 * side, -0.12], [0.12, -0.12 * side, 0.04], [-0.04, 0, 0], N]),
            r("chest", [N, [-0.1, 0.18 * side, 0], [-0.18, 0.3 * side, 0], [0.14, -0.18 * side, 0], [0.28, -0.34 * side, 0.1], [0.1, 0.1 * side, 0], [-0.03, 0, 0], N]),
            r("head", [[0, -0.08, 0], [0.16, -0.16 * side, 0], [0.28, -0.24 * side, 0], [-0.2, 0.12 * side, 0], [-0.44 * p.attack, 0.2 * side, -0.08], [-0.14, -0.06 * side, 0], [0.03, -0.04, 0], [0, -0.08, 0]]),
            r("tail_1", [N, [0.04, 0.24 * side, 0], [0.08, 0.42 * side, 0.08], [-0.06, -0.18 * side, -0.04], [-0.12, -0.34 * side, -0.1], [0.04, 0.12 * side, 0.03], [0, 0, 0], N]),
        ]),
        clip("idle_hitreact1", scaledTimes([0, 0.08, 0.2, 0.38, 0.58], p.pace), [
            t("root", [N, [0.02 * side, -0.02, -0.08], [-0.01 * side, 0, -0.03], [0, 0, -0.01], N]),
            r("spine", [N, [-0.22, 0.2 * side, 0.16 * side], [0.12, -0.1 * side, -0.08 * side], [-0.04, 0, 0], N]),
            r("head", [[0, -0.08, 0], [0.3, -0.16 * side, -0.22 * side], [-0.1, 0.08 * side, 0.1 * side], [0.03, 0, 0], [0, -0.08, 0]]),
            r("tail_1", [N, [-0.08, -0.3 * side, -0.08], [0.05, 0.18 * side, 0.05], [-0.02, -0.06 * side, 0], N]),
        ]),
        clip("death", scaledTimes([0, 0.12, 0.3, 0.56, 0.84, 1.14, 1.5], Math.max(1, p.pace)), [
            t("root", [N, [0, 0.025, -0.03], [0.025 * side, -0.02, -0.07], [0.07 * side, -0.09, -0.04], [0.1 * side, -0.17, -0.01], [0.11 * side, -0.21, 0], [0.11 * side, -0.22, 0]]),
            r("pelvis", [N, [-0.06, 0, -0.06 * side], [0.08, 0, 0.2 * side], [0.14, 0, 0.52 * side], [0.12, 0, 0.84 * side], [0.1, 0, 0.96 * side], [0.1, 0, 0.98 * side]]),
            r("spine", [N, [0.06, 0.14 * side, 0], [-0.12, -0.18 * side, -0.08], [-0.24, -0.3 * side, -0.14], [-0.34, -0.36 * side, -0.12], [-0.38, -0.38 * side, -0.1], [-0.38, -0.38 * side, -0.1]]),
            r("head", [[0, -0.08, 0], [-0.08, 0.08 * side, 0], [0.18, -0.12 * side, -0.1 * side], [0.38, -0.18 * side, -0.16 * side], [0.54, -0.2 * side, -0.14 * side], [0.64, -0.18 * side, -0.12 * side], [0.66, -0.18 * side, -0.12 * side]]),
            r("tail_1", [N, [0.08, 0.22 * side, 0.06], [-0.08, -0.26 * side, -0.08], [-0.16, -0.42 * side, -0.14], [-0.22, -0.48 * side, -0.16], [-0.24, -0.5 * side, -0.16], [-0.24, -0.5 * side, -0.16]]),
        ]),
    ];
}

function bipedBank(p, family) {
    const aL = "upper_arm.L", aR = "upper_arm.R", lL = "thigh.L", lR = "thigh.R";
    const hopper = family === "hopper";
    const brawler = family === "primate" || family === "armored";
    const side = p.side;
    return [
        clip("idle", scaledTimes([0, 0.42, 0.84, 1.26, 1.68], p.pace), [
            t("root", [N, [0, 0.018 * p.bounce, 0], N, [0, 0.012 * p.bounce, 0], N]),
            r("chest", [[-0.03, 0, 0], [-0.06, 0.015, 0.012], [-0.03, 0, 0], [-0.052, -0.015, -0.012], [-0.03, 0, 0]]),
            r("head", [[0.025, -0.08, 0], [0.06, 0.05, 0.02], [0.012, 0.1, 0.025], [0.05, -0.04, -0.018], [0.025, -0.08, 0]]),
            r(aL, [[-0.14, 0, -0.07], [-0.18, 0, -0.1], [-0.14, 0, -0.07], [-0.11, 0, -0.05], [-0.14, 0, -0.07]]),
            r(aR, [[-0.14, 0, 0.07], [-0.11, 0, 0.05], [-0.14, 0, 0.07], [-0.18, 0, 0.1], [-0.14, 0, 0.07]]),
        ]),
        clip("idle_2", scaledTimes([0, 0.18, 0.42, 0.7, 1, 1.32], p.pace), [
            t("root", [N, [0, -0.02 * p.crouch, -0.015], [0, (hopper ? 0.08 : 0.05) * p.bounce, 0.015], [0, 0.018, 0], [0, -0.006, 0], N]),
            r("pelvis", [N, [-0.08 * p.crouch, 0, 0], [0.12, 0, 0], [0.04, 0, 0], [-0.03, 0, 0], N]),
            r("head", [[0, -0.1, 0], [-0.04, -0.18, -0.03], [0.1, 0.18, 0.05], [0.02, 0.22, 0.04], [0, -0.06, -0.02], [0, -0.1, 0]]),
            r(aL, [[-0.1, 0, -0.07], [-0.3, 0, -0.15], [0.02, 0, -0.02], [-0.14, 0, -0.07], [-0.1, 0, -0.07], [-0.1, 0, -0.07]]),
            r(aR, [[-0.1, 0, 0.07], [-0.3, 0, 0.15], [0.02, 0, 0.02], [-0.14, 0, 0.07], [-0.1, 0, 0.07], [-0.1, 0, 0.07]]),
        ]),
        clip("walk", scaledTimes([0, 0.22, 0.44, 0.66, 0.88], p.pace), [
            t("root", [N, [0, (hopper ? 0.06 : 0.04) * p.bounce, 0.014], [0, 0.01, 0.028], [0, (hopper ? 0.06 : 0.04) * p.bounce, 0.014], N]),
            r("pelvis", [[0.05, 0, 0.025], [-0.02, 0, -0.035], [0.05, 0, 0.025], [-0.02, 0, 0.035], [0.05, 0, 0.025]]),
            r(lL, [[0.44 * p.stride, 0, 0.04], [0.05, 0, 0], [-0.42 * p.stride, 0, -0.04], [0.05, 0, 0], [0.44 * p.stride, 0, 0.04]]),
            r(lR, [[-0.42 * p.stride, 0, -0.04], [0.05, 0, 0], [0.44 * p.stride, 0, 0.04], [0.05, 0, 0], [-0.42 * p.stride, 0, -0.04]]),
            r(aL, [[-0.3 * p.stride, 0, -0.08], [-0.07, 0, -0.03], [0.26 * p.stride, 0, 0.07], [-0.07, 0, -0.03], [-0.3 * p.stride, 0, -0.08]]),
            r(aR, [[0.26 * p.stride, 0, 0.08], [-0.07, 0, 0.03], [-0.3 * p.stride, 0, -0.07], [-0.07, 0, 0.03], [0.26 * p.stride, 0, 0.08]]),
        ]),
        clip("gallop", scaledTimes([0, 0.16, 0.32, 0.48, 0.64], p.pace), [
            t("root", [N, [0, (hopper ? 0.13 : 0.09) * p.bounce, 0.035], [0, 0.026, 0.07], [0, (hopper ? 0.13 : 0.095) * p.bounce, 0.035], N]),
            r("spine", [[-0.12, 0, 0], [0.16, 0, 0], [-0.14, 0, 0], [0.18, 0, 0], [-0.12, 0, 0]]),
            r(lL, [[0.6 * p.stride, 0, 0.05], [-0.2, 0, 0], [-0.56 * p.stride, 0, -0.05], [0.1, 0, 0], [0.6 * p.stride, 0, 0.05]]),
            r(lR, [[-0.56 * p.stride, 0, -0.05], [0.1, 0, 0], [0.6 * p.stride, 0, 0.05], [-0.2, 0, 0], [-0.56 * p.stride, 0, -0.05]]),
            r(aL, [[-0.46, 0, -0.12], [0.26, 0, 0.04], [0.48, 0, 0.1], [-0.18, 0, -0.04], [-0.46, 0, -0.12]]),
            r(aR, [[0.48, 0, 0.12], [-0.18, 0, 0.04], [-0.46, 0, -0.1], [0.26, 0, -0.04], [0.48, 0, 0.12]]),
        ]),
        clip("gallop_jump", scaledTimes([0, 0.1, 0.24, 0.42, 0.64], p.pace), [
            t("root", [N, [0.035 * side, 0.07, -0.025], [0.12 * side, 0.2 * p.air, 0.025], [0.06 * side, 0.13 * p.air, 0.055], N]),
            r("pelvis", [N, [-0.14, 0, -0.08 * side], [0.18, 0.08 * side, -0.2 * side], [0.1, -0.04 * side, 0.1 * side], N]),
            r(lL, [N, [0.4, 0, 0.08], [0.7, 0, 0.15], [-0.18, 0, -0.05], N]),
            r(lR, [N, [0.3, 0, -0.08], [0.6, 0, -0.15], [-0.28, 0, 0.05], N]),
            r(aL, [N, [-0.36, 0, -0.22], [-0.56, 0, -0.32], [0.22, 0, 0.14], N]),
            r(aR, [N, [-0.36, 0, 0.22], [-0.56, 0, 0.32], [0.22, 0, -0.14], N]),
        ]),
        clip("attack", scaledTimes([0, 0.14, 0.3, 0.4, 0.53, 0.68, 0.84, 1], p.pace), [
            t("root", [N, [0, -0.03 * p.crouch, -0.035], [0, -0.045 * p.crouch, -0.065], [0, 0.025, 0.09], [0, brawler ? 0.02 : 0.05 * p.air, 0.16 * p.attack], [0, 0.018, 0.08], [0, -0.008, 0.02], N]),
            r("spine", [N, [-0.12 * p.crouch, 0, 0], [-0.24 * p.crouch, 0, 0], [0.18, 0, -0.08 * side], [0.32 * p.attack, 0, 0.1 * side], [0.16, 0, -0.08 * side], [-0.06, 0, 0], N]),
            r("head", [[0, 0.06, 0], [0.06, -0.08, 0], [0.12, -0.14, 0], [-0.08, 0.08 * side, -0.1 * side], [-0.14, -0.1 * side, 0.12 * side], [0.04, 0.04, -0.05 * side], [0.02, 0, 0], [0, 0.06, 0]]),
            r(aL, [[-0.12, 0, -0.07], [-0.46, 0, -0.17], [-0.66, 0, -0.22], [0.76 * p.attack, 0, 0.12], [0.16, 0, -0.02], [-0.16, 0, -0.07], [-0.1, 0, -0.05], [-0.12, 0, -0.07]]),
            r(aR, [[-0.12, 0, 0.07], [-0.34, 0, 0.12], [-0.2, 0, 0.14], [-0.1, 0, 0.04], [-0.68 * p.attack, 0, 0.22], [0.76 * p.attack, 0, -0.12], [0.02, 0, 0], [-0.12, 0, 0.07]]),
            r(lL, [N, [0.12, 0, 0], [0.3, 0, 0], [-0.1, 0, 0], [-0.24, 0, 0], [0.04, 0, 0], N, N]),
        ]),
        clip("idle_hitreact1", scaledTimes([0, 0.08, 0.2, 0.38, 0.56], p.pace), [
            t("root", [N, [0.022 * side, -0.035, -0.09], [-0.012 * side, -0.012, -0.03], [0.006 * side, 0.004, -0.01], N]),
            r("spine", [N, [-0.28 / p.weight, 0.06, 0.18 * side], [0.15, -0.03, -0.09 * side], [-0.05, 0, 0.03 * side], N]),
            r("head", [N, [0.34 / p.weight, -0.12 * side, -0.28 * side], [-0.13, 0.06 * side, 0.13 * side], [0.05, 0, -0.04 * side], N]),
            r(aL, [[-0.12, 0, -0.07], [-0.44, 0, -0.31], [0.1, 0, 0.15], [-0.16, 0, -0.09], [-0.12, 0, -0.07]]),
            r(aR, [[-0.12, 0, 0.07], [-0.44, 0, 0.31], [0.1, 0, -0.15], [-0.16, 0, 0.09], [-0.12, 0, 0.07]]),
        ]),
        clip("death", scaledTimes([0, 0.1, 0.28, 0.52, 0.78, 1.08, 1.42], Math.max(0.94, p.pace * p.weight * 0.82)), [
            t("root", [N, [0, 0.04, -0.04], [0.02 * side, -0.02, -0.08], [0.055 * side, -0.13, -0.06], [0.075 * side, -0.26, -0.025], [0.08 * side, -0.31, 0], [0.08 * side, -0.32, 0]]),
            r("pelvis", [N, [-0.08, 0, -0.08 * side], [0.1, 0.04, 0.2 * side], [0.18, 0.04, 0.58 * side], [0.2, 0.02, 1 * side], [0.18, 0, 1.16 * side], [0.18, 0, 1.18 * side]]),
            r("chest", [N, [0.08, 0, 0], [-0.12, 0, -0.1 * side], [-0.28, 0, -0.16 * side], [-0.4, 0, -0.12 * side], [-0.44, 0, -0.08 * side], [-0.45, 0, -0.08 * side]]),
            r("head", [[0, 0.06, 0], [-0.1, -0.06, 0.04 * side], [0.18, 0.08, -0.1 * side], [0.42, 0.04, -0.18 * side], [0.58, 0, -0.2 * side], [0.68, 0, -0.16 * side], [0.7, 0, -0.16 * side]]),
            r(aL, [[-0.12, 0, -0.07], [-0.34, 0, -0.17], [0.17, 0, 0.2], [0.46, 0, 0.28], [0.28, 0, 0.15], [0.18, 0, 0.09], [0.18, 0, 0.09]]),
            r(aR, [[-0.12, 0, 0.07], [-0.34, 0, 0.17], [0.17, 0, -0.2], [-0.15, 0, -0.14], [-0.26, 0, -0.11], [-0.28, 0, -0.09], [-0.28, 0, -0.09]]),
        ]),
    ];
}

function avianBank(p, bat = false) {
    const wL = bat ? "bat_wing_upper.L" : "wing_upper.L";
    const wR = bat ? "bat_wing_upper.R" : "wing_upper.R";
    const lL = "thigh.L", lR = "thigh.R", side = p.side;
    return [
        clip("idle", scaledTimes([0, 0.36, 0.72, 1.08, 1.44, 1.8], p.pace), [
            t("root", [N, [0, 0.014 * p.bounce, 0], [0, 0.004, 0], [0, 0.016 * p.bounce, 0], [0, 0.004, 0], N]),
            r("chest", [[-0.02, 0, 0], [-0.045, 0, 0.012], [-0.018, 0, 0], [-0.05, 0, -0.012], [-0.018, 0, 0], [-0.02, 0, 0]]),
            r("head", [[0.02, -0.15, 0], [0.06, -0.18, -0.02], [-0.01, 0.12, 0.04], [0.07, 0.2, 0.04], [0.015, -0.05, -0.015], [0.02, -0.15, 0]]),
            r(wL, [[0.05, 0, -0.06], [0.01, 0, -0.09], [0.07, 0, -0.04], [0, 0, -0.08], [0.06, 0, -0.05], [0.05, 0, -0.06]]),
            r(wR, [[0.05, 0, 0.06], [0, 0, 0.08], [0.07, 0, 0.04], [0.01, 0, 0.09], [0.06, 0, 0.05], [0.05, 0, 0.06]]),
        ]),
        clip("idle_2", scaledTimes([0, 0.18, 0.4, 0.68, 0.96, 1.28], p.pace), [
            t("root", [N, [0, -0.015, 0], [0, 0.06 * p.air, 0], [0, 0.02, 0], [0, -0.008, 0], N]),
            r("chest", [N, [-0.1, 0, 0], [0.14, 0, 0], [0.06, 0, 0], [-0.04, 0, 0], N]),
            r("head", [[0, -0.1, 0], [-0.05, -0.2, 0], [0.08, 0.26, 0.04], [0.02, 0.12, 0.02], [0, -0.08, 0], [0, -0.1, 0]]),
            r(wL, [[0.04, 0, -0.04], [0.32, 0, -0.18], [-0.56, 0, -0.52], [-0.22, 0, -0.25], [0.08, 0, -0.08], [0.04, 0, -0.04]]),
            r(wR, [[0.04, 0, 0.04], [0.32, 0, 0.18], [-0.56, 0, 0.52], [-0.22, 0, 0.25], [0.08, 0, 0.08], [0.04, 0, 0.04]]),
        ]),
        clip("walk", scaledTimes([0, 0.22, 0.44, 0.66, 0.88], p.pace), [
            t("root", [N, [0, 0.03 * p.bounce, 0.012], [0, 0.004, 0.025], [0, 0.03 * p.bounce, 0.012], N]),
            r("pelvis", [[0.04, 0, 0.03], [-0.02, 0, -0.04], [0.04, 0, 0.03], [-0.02, 0, 0.04], [0.04, 0, 0.03]]),
            r(lL, [[0.44 * p.stride, 0, 0], [0.05, 0, 0], [-0.4 * p.stride, 0, 0], [0.05, 0, 0], [0.44 * p.stride, 0, 0]]),
            r(lR, [[-0.4 * p.stride, 0, 0], [0.05, 0, 0], [0.44 * p.stride, 0, 0], [0.05, 0, 0], [-0.4 * p.stride, 0, 0]]),
            r(wL, [[-0.04, 0, -0.08], [0.08, 0, -0.02], [-0.04, 0, 0.06], [0.08, 0, -0.02], [-0.04, 0, -0.08]]),
            r(wR, [[-0.04, 0, 0.08], [0.08, 0, 0.02], [-0.04, 0, -0.06], [0.08, 0, 0.02], [-0.04, 0, 0.08]]),
        ]),
        clip("gallop", scaledTimes([0, 0.15, 0.3, 0.45, 0.6], p.pace), [
            t("root", [N, [0, 0.1 * p.air, 0.035], [0, 0.04, 0.07], [0, 0.11 * p.air, 0.035], N]),
            r("spine", [[-0.18, 0, 0], [0.06, 0, 0], [-0.2, 0, 0], [0.08, 0, 0], [-0.18, 0, 0]]),
            r(lL, [[0.56, 0, 0], [-0.1, 0, 0], [-0.52, 0, 0], [0.12, 0, 0], [0.56, 0, 0]]),
            r(lR, [[-0.52, 0, 0], [0.12, 0, 0], [0.56, 0, 0], [-0.1, 0, 0], [-0.52, 0, 0]]),
            r(wL, [[-0.24, 0, -0.22], [0.34, 0, -0.48], [-0.18, 0, -0.3], [0.42, 0, -0.52], [-0.24, 0, -0.22]]),
            r(wR, [[-0.24, 0, 0.22], [0.34, 0, 0.48], [-0.18, 0, 0.3], [0.42, 0, 0.52], [-0.24, 0, 0.22]]),
        ]),
        clip("gallop_jump", scaledTimes([0, 0.1, 0.24, 0.42, 0.62], p.pace), [
            t("root", [N, [0.04 * side, 0.09, -0.02], [0.13 * side, 0.25 * p.air, 0.035], [0.07 * side, 0.15 * p.air, 0.06], N]),
            r("chest", [N, [-0.16, 0, 0.08 * side], [-0.22, -0.08 * side, 0.2 * side], [0.12, 0.04 * side, -0.08 * side], N]),
            r(wL, [[0.05, 0, -0.08], [-0.28, 0, -0.34], [-0.72, 0, -0.78], [0.38, 0, -0.42], [0.05, 0, -0.08]]),
            r(wR, [[0.05, 0, 0.08], [-0.28, 0, 0.34], [-0.72, 0, 0.78], [0.38, 0, 0.42], [0.05, 0, 0.08]]),
            r(lL, [N, [0.3, 0, 0], [0.6, 0, 0.08], [-0.2, 0, 0], N]),
            r(lR, [N, [0.24, 0, 0], [0.52, 0, -0.08], [-0.28, 0, 0], N]),
        ]),
        clip("attack", scaledTimes([0, 0.12, 0.3, 0.4, 0.54, 0.7, 0.85, 1], p.pace), [
            t("root", [N, [0, -0.025, -0.04], [0, 0.035, -0.055], [0, 0.12 * p.air, 0.11], [0, 0.17 * p.air, 0.2 * p.attack], [0, 0.06, 0.105], [0, 0.01, 0.025], N]),
            r("chest", [N, [-0.18, 0, 0], [-0.28, 0, 0], [0.32, 0, 0], [0.5 * p.attack, 0, 0], [0.18, 0, 0], [-0.06, 0, 0], N]),
            r("neck", [N, [0.12, 0, 0], [0.24, 0, 0], [-0.3, 0, 0], [-0.52 * p.attack, 0, 0], [-0.18, 0, 0], [0.08, 0, 0], N]),
            r("head", [[0, -0.12, 0], [0.16, -0.08, 0], [0.28, 0.06, 0], [-0.34, 0, 0], [-0.62 * p.attack, 0, 0], [-0.16, 0.08, 0], [0.06, -0.05, 0], [0, -0.12, 0]]),
            r(wL, [[0.05, 0, -0.06], [0.32, 0, -0.28], [-0.52, 0, -0.68], [-0.12, 0, -0.46], [0.28, 0, -0.22], [0.02, 0, -0.08], [0.06, 0, -0.05], [0.05, 0, -0.06]]),
            r(wR, [[0.05, 0, 0.06], [0.32, 0, 0.28], [-0.52, 0, 0.68], [-0.12, 0, 0.46], [0.28, 0, 0.22], [0.02, 0, 0.08], [0.06, 0, 0.05], [0.05, 0, 0.06]]),
        ]),
        clip("idle_hitreact1", scaledTimes([0, 0.08, 0.18, 0.34, 0.52], p.pace), [
            t("root", [N, [-0.025 * side, -0.025, -0.095], [0.01 * side, 0.015, -0.035], [-0.005 * side, 0, -0.01], N]),
            r("chest", [N, [-0.28 / p.weight, 0.06, -0.22 * side], [0.16, -0.03, 0.12 * side], [-0.05, 0, -0.04 * side], N]),
            r("head", [[0, -0.1, 0], [0.38 / p.weight, 0.18 * side, 0.28 * side], [-0.14, -0.08 * side, -0.12 * side], [0.04, -0.05, 0.03 * side], [0, -0.1, 0]]),
            r(wL, [[0.05, 0, -0.06], [-0.46, 0, -0.66], [0.28, 0, -0.24], [-0.05, 0, -0.1], [0.05, 0, -0.06]]),
            r(wR, [[0.05, 0, 0.06], [-0.18, 0, 0.42], [0.36, 0, 0.3], [-0.03, 0, 0.1], [0.05, 0, 0.06]]),
        ]),
        clip("death", scaledTimes([0, 0.1, 0.26, 0.48, 0.74, 1.04, 1.38], Math.max(0.9, p.pace)), [
            t("root", [N, [0, 0.055, -0.035], [-0.03 * side, 0.01, -0.08], [-0.07 * side, -0.11, -0.055], [-0.09 * side, -0.23, -0.02], [-0.1 * side, -0.28, 0], [-0.1 * side, -0.29, 0]]),
            r("pelvis", [N, [-0.08, 0, 0.08 * side], [0.1, 0, -0.22 * side], [0.16, 0, -0.6 * side], [0.14, 0, -1.02 * side], [0.12, 0, -1.16 * side], [0.12, 0, -1.18 * side]]),
            r("chest", [N, [0.1, 0, 0], [-0.12, 0, 0.08 * side], [-0.25, 0, 0.18 * side], [-0.36, 0, 0.14 * side], [-0.4, 0, 0.1 * side], [-0.4, 0, 0.1 * side]]),
            r("head", [[0, -0.1, 0], [-0.12, 0.1, 0], [0.22, -0.1, 0.12 * side], [0.42, 0, 0.2 * side], [0.58, 0, 0.16 * side], [0.68, 0, 0.12 * side], [0.7, 0, 0.12 * side]]),
            r(wL, [[0.05, 0, -0.06], [-0.3, 0, -0.4], [-0.78, 0, -0.9], [-0.26, 0, -0.46], [0.16, 0, -0.18], [0.26, 0, -0.12], [0.26, 0, -0.12]]),
            r(wR, [[0.05, 0, 0.06], [-0.3, 0, 0.4], [-0.78, 0, 0.9], [-0.08, 0, 0.38], [0.34, 0, 0.2], [0.38, 0, 0.14], [0.38, 0, 0.14]]),
        ]),
    ];
}

function arthropodBank(p, kind) {
    const frontL = "leg_front_upper.L", frontR = "leg_front_upper.R";
    const midL = "leg_mid_upper.L", midR = "leg_mid_upper.R";
    const rearL = "leg_rear_upper.L", rearR = "leg_rear_upper.R";
    const side = p.side;
    const attackL = kind === "crab" ? "claw_upper.L" : kind === "moth" ? "wing_high.L" : "horn";
    const attackR = kind === "crab" ? "claw_upper.R" : kind === "moth" ? "wing_high.R" : null;
    const paired = (left, right, amount) => [
        r(left, [[amount, 0, -0.08], [0, 0, 0], [-amount, 0, 0.08], [0, 0, 0], [amount, 0, -0.08]]),
        r(right, [[-amount, 0, 0.08], [0, 0, 0], [amount, 0, -0.08], [0, 0, 0], [-amount, 0, 0.08]]),
    ];
    const attackTracks = [
        r(attackL, [N, [-0.22, 0, -0.16], [-0.46, 0, -0.26], [0.54 * p.attack, 0, 0.2], [0.74 * p.attack, 0, 0.28], [0.18, 0, 0.06], N, N]),
    ];
    if (attackR) attackTracks.push(r(attackR, [N, [-0.22, 0, 0.16], [-0.46, 0, 0.26], [0.54 * p.attack, 0, -0.2], [0.74 * p.attack, 0, -0.28], [0.18, 0, -0.06], N, N]));
    return [
        clip("idle", scaledTimes([0, 0.45, 0.9, 1.35, 1.8], p.pace), [
            t("root", [N, [0, 0.01 * p.bounce, 0], N, [0, 0.008 * p.bounce, 0], N]),
            r("thorax", [[-0.02, 0, 0], [-0.04, 0.04, 0.015], [-0.02, 0, 0], [-0.04, -0.04, -0.015], [-0.02, 0, 0]]),
            r("head", [[0, -0.08, 0], [0.04, 0.12, 0.02], [0, 0.04, 0], [0.04, -0.14, -0.02], [0, -0.08, 0]]),
            r("abdomen", [[0, -0.04, 0], [0.03, 0.08, 0.02], [0, 0.02, 0], [-0.03, -0.08, -0.02], [0, -0.04, 0]]),
        ]),
        clip("idle_2", scaledTimes([0, 0.18, 0.42, 0.7, 1, 1.32], p.pace), [
            t("root", [N, [0, -0.012, -0.015], [0, 0.045 * p.bounce, 0.01], [0, 0.015, 0], [0, -0.005, 0], N]),
            r("thorax", [N, [-0.1, 0, 0], [0.14, 0, 0], [0.05, 0, 0], [-0.03, 0, 0], N]),
            r("head", [[0, -0.08, 0], [0.1, -0.16, 0], [-0.12, 0.18, 0.05], [0.04, 0.12, 0.03], [0, -0.04, 0], [0, -0.08, 0]]),
            r(attackL, [N, [-0.18, 0, -0.12], [0.28, 0, 0.18], [0.1, 0, 0.06], N, N]),
        ]),
        clip("walk", scaledTimes([0, 0.22, 0.44, 0.66, 0.88], p.pace), [
            t("root", [N, [0, 0.022 * p.bounce, 0.012], [0, 0.004, 0.025], [0, 0.022 * p.bounce, 0.012], N]),
            r("thorax", [[-0.04, 0, 0.03], [0.02, 0, -0.03], [-0.04, 0, 0.03], [0.02, 0, -0.03], [-0.04, 0, 0.03]]),
            ...paired(frontL, frontR, 0.34 * p.stride),
            ...paired(midL, midR, -0.3 * p.stride),
            ...paired(rearL, rearR, 0.32 * p.stride),
        ]),
        clip("gallop", scaledTimes([0, 0.15, 0.3, 0.45, 0.6], p.pace), [
            t("root", [N, [0, 0.055 * p.bounce, 0.035], [0, 0.015, 0.07], [0, 0.058 * p.bounce, 0.035], N]),
            r("thorax", [[-0.12, 0, 0], [0.1, 0, 0], [-0.14, 0, 0], [0.12, 0, 0], [-0.12, 0, 0]]),
            ...paired(frontL, frontR, 0.52 * p.stride),
            ...paired(midL, midR, -0.46 * p.stride),
            ...paired(rearL, rearR, 0.5 * p.stride),
        ]),
        clip("gallop_jump", scaledTimes([0, 0.1, 0.24, 0.42, 0.64], p.pace), [
            t("root", [N, [0.04 * side, 0.045, -0.02], [0.13 * side, (kind === "moth" ? 0.2 : 0.1) * p.air, 0.03], [0.07 * side, (kind === "moth" ? 0.12 : 0.06) * p.air, 0.06], N]),
            r("thorax", [N, [-0.12, 0, 0.08 * side], [0.18, 0, 0.22 * side], [0.08, 0, -0.08 * side], N]),
            r(frontL, [N, [-0.34, 0, -0.08], [-0.54, 0, -0.14], [0.22, 0, 0.05], N]),
            r(frontR, [N, [-0.3, 0, 0.08], [-0.5, 0, 0.14], [0.25, 0, -0.05], N]),
            r(rearL, [N, [0.3, 0, 0.05], [0.54, 0, 0.1], [-0.18, 0, -0.04], N]),
            r(rearR, [N, [0.26, 0, -0.05], [0.5, 0, -0.1], [-0.22, 0, 0.04], N]),
        ]),
        clip("attack", scaledTimes([0, 0.12, 0.3, 0.4, 0.54, 0.7, 0.85, 1], p.pace), [
            t("root", [N, [0, -0.02 * p.crouch, -0.035], [0, -0.035 * p.crouch, -0.06], [0, 0.02, 0.08], [0, 0.04, 0.16 * p.attack], [0, 0.015, 0.08], [0, 0, 0.02], N]),
            r("thorax", [N, [-0.16 * p.crouch, 0, 0], [-0.26 * p.crouch, 0, 0], [0.2, 0, 0], [0.38 * p.attack, 0, 0], [0.14, 0, 0], [-0.04, 0, 0], N]),
            r("head", [[0, -0.06, 0], [0.12, -0.08, 0], [0.22, 0.06, 0], [-0.16, 0, 0], [-0.38 * p.attack, 0.04, 0], [-0.12, -0.04, 0], [0.03, -0.03, 0], [0, -0.06, 0]]),
            ...attackTracks,
        ]),
        clip("idle_hitreact1", scaledTimes([0, 0.08, 0.2, 0.38, 0.56], p.pace), [
            t("root", [N, [0.018 * side, -0.025, -0.08], [-0.008 * side, -0.008, -0.025], [0, 0.003, -0.008], N]),
            r("thorax", [N, [-0.24 / p.weight, 0.05, 0.16 * side], [0.13, -0.03, -0.08 * side], [-0.04, 0, 0], N]),
            r("head", [[0, -0.06, 0], [0.3 / p.weight, -0.12 * side, -0.22 * side], [-0.1, 0.05 * side, 0.1 * side], [0.04, 0, 0], [0, -0.06, 0]]),
            r(frontL, [N, [-0.3, 0, -0.12], [0.16, 0, 0.06], [-0.04, 0, -0.02], N]),
            r(frontR, [N, [-0.28, 0, 0.12], [0.18, 0, -0.06], [-0.04, 0, 0.02], N]),
        ]),
        clip("death", scaledTimes([0, 0.1, 0.28, 0.52, 0.8, 1.1, 1.45], Math.max(1, p.pace * p.weight * 0.82)), [
            t("root", [N, [0, 0.03, -0.03], [0.02 * side, -0.01, -0.07], [0.055 * side, -0.09, -0.05], [0.08 * side, -0.18, -0.02], [0.09 * side, -0.22, 0], [0.09 * side, -0.23, 0]]),
            r("thorax", [N, [-0.08, 0, -0.06 * side], [0.1, 0, 0.22 * side], [0.16, 0, 0.58 * side], [0.14, 0, 0.98 * side], [0.12, 0, 1.12 * side], [0.12, 0, 1.14 * side]]),
            r("abdomen", [N, [0.08, 0, 0], [-0.14, 0, -0.08 * side], [-0.28, 0, -0.14 * side], [-0.38, 0, -0.1 * side], [-0.42, 0, -0.08 * side], [-0.42, 0, -0.08 * side]]),
            r("head", [[0, -0.06, 0], [-0.08, 0.05, 0], [0.2, -0.08, -0.1 * side], [0.42, 0, -0.18 * side], [0.58, 0, -0.16 * side], [0.66, 0, -0.12 * side], [0.68, 0, -0.12 * side]]),
            r(frontL, [N, [-0.26, 0, -0.1], [0.32, 0, 0.12], [0.5, 0, 0.16], [0.2, 0, 0.06], [0.14, 0, 0.04], [0.14, 0, 0.04]]),
            r(frontR, [N, [-0.26, 0, 0.1], [0.32, 0, -0.12], [-0.1, 0, -0.08], [-0.23, 0, -0.06], [-0.26, 0, -0.04], [-0.26, 0, -0.04]]),
        ]),
    ];
}

function bankFor(pet, family, profile, type) {
    const tuning = tuningFor(pet, family, profile);
    const bank = type === "avian" ? avianBank(tuning)
        : type === "bat" ? avianBank(tuning, true)
            : type === "insect" || type === "moth" || type === "crab" ? arthropodBank(tuning, type)
                : type === "biped" ? bipedBank(tuning, family)
                    : profile === "serpentine" || family === "serpentine" || family === "aquatic" ? serpentineBank(tuning)
                        : quadrupedBank(tuning, family);
    return { bank, tuning };
}

function modelPath(id) {
    return id.startsWith("starter-")
        ? resolve(rootPath, `public/pet-models/${id}.glb`)
        : resolve(rootPath, `public/pet-models/roster/${id}.glb`);
}

function starterProfile(id) {
    if (id.startsWith("starter-wind")) return "avian";
    if (id.startsWith("starter-water")) return "serpentine";
    if (id.startsWith("starter-earth")) return "heavy";
    return "quadruped";
}

async function authorPet(pet, manifest) {
    const id = pet.id;
    const path = modelPath(id);
    const sourceFile = await readFile(path);
    const parsed = parseGlb(sourceFile, id);
    const json = structuredClone(parsed.json);
    const priorBoundary = json.extras?.properAnimationSourceBoundary;
    const sourceBoundary = priorBoundary ?? {
        binLength: parsed.bin.byteLength,
        accessorCount: json.accessors?.length ?? 0,
        bufferViewCount: json.bufferViews?.length ?? 0,
    };
    let sourceBin = parsed.bin.subarray(0, sourceBoundary.binLength);
    if (priorBoundary) {
        json.accessors = json.accessors.slice(0, sourceBoundary.accessorCount);
        json.bufferViews = json.bufferViews.slice(0, sourceBoundary.bufferViewCount);
    }
    const nodeByName = new Map(json.nodes.map((node, index) => [node.name, index]));
    const nodes = new Set(nodeByName.keys());
    const type = rigType(nodes);
    const profile = manifest.entries[id]?.profile ?? starterProfile(id);
    const family = petCombatFamily({ name: pet.name, profile });
    const { bank, tuning } = bankFor(pet, family, profile, type);
    invariant(bank.length === 8, `${id}: expected eight authored clips`);

    const chunks = [{ offset: 0, bytes: sourceBin }];
    let byteLength = sourceBin.byteLength;
    json.bufferViews ??= [];
    json.accessors ??= [];
    const addAccessor = (array, accessorType, options = {}) => {
        const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
        const offset = align4(byteLength);
        chunks.push({ offset, bytes });
        json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength });
        byteLength = offset + bytes.byteLength;
        const width = accessorType === "VEC4" ? 4 : accessorType === "VEC3" ? 3 : 1;
        const accessor = { bufferView: json.bufferViews.length - 1, componentType: 5126, count: array.length / width, type: accessorType };
        if (options.min) accessor.min = options.min;
        if (options.max) accessor.max = options.max;
        json.accessors.push(accessor);
        return json.accessors.length - 1;
    };

    json.animations = [];
    for (const take of bank) {
        const input = addAccessor(new Float32Array(take.times), "SCALAR", { min: [take.times[0]], max: [take.times.at(-1)] });
        const samplers = [];
        const channels = [];
        for (const track of take.tracks) {
            const nodeIndex = nodeByName.get(track.node);
            invariant(nodeIndex !== undefined, `${id}/${take.name}: missing bone ${track.node}`);
            invariant(track.values.length === take.times.length, `${id}/${take.name}/${track.node}: keyframe count mismatch`);
            const node = json.nodes[nodeIndex];
            let values;
            let accessorType;
            if (track.path === "rotation") {
                const bind = new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1])).normalize();
                values = track.values.flatMap((euler) => bind.clone()
                    .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...euler, "XYZ")))
                    .normalize()
                    .toArray());
                accessorType = "VEC4";
            } else {
                const bind = node.translation ?? [0, 0, 0];
                values = track.values.flatMap((delta) => bind.map((value, axis) => value + delta[axis]));
                accessorType = "VEC3";
            }
            invariant(values.every(Number.isFinite), `${id}/${take.name}/${track.node}: non-finite keyframe`);
            const output = addAccessor(new Float32Array(values), accessorType);
            samplers.push({ input, output, interpolation: "LINEAR" });
            channels.push({ sampler: samplers.length - 1, target: { node: nodeIndex, path: track.path } });
        }
        json.animations.push({ name: take.name, samplers, channels });
    }

    json.asset = { ...json.asset, generator: `Shinobi Journey ${family} ${type} Animation Bank v3` };
    json.extras = {
        ...(json.extras ?? {}),
        properAnimationBank: PROPER_PET_ANIMATION_ASSET_REVISION,
        properAnimationFamily: family,
        properAnimationRig: type,
        properAnimationSignature: {
            seed: tuning.signature.seed,
            cadence: tuning.signature.cadence,
            agility: tuning.signature.agility,
            weight: tuning.signature.weight,
            anticipation: tuning.signature.anticipation,
            strikeDrive: tuning.signature.strikeDrive,
            asymmetry: tuning.signature.asymmetry,
        },
        animationAuthoring: "species-and-identity-directed-keyframes",
        properAnimationSourceBoundary: sourceBoundary,
    };
    json.buffers = [{ byteLength: align4(byteLength) }];
    const binary = new Uint8Array(align4(byteLength));
    for (const chunk of chunks) binary.set(chunk.bytes, chunk.offset);
    const encoded = encodeGlb(json, binary);
    await writeFile(path, encoded);

    if (manifest.entries[id]) {
        const entry = manifest.entries[id];
        entry.sha256 = createHash("sha256").update(encoded).digest("hex").toUpperCase();
        if (entry.validation) {
            entry.validation.bytes = encoded.byteLength;
            entry.validation.animations = 8;
        }
        entry.animationBank = {
            revision: PROPER_PET_ANIMATION_ASSET_REVISION,
            family,
            rig: type,
            signatureSeed: tuning.signature.seed,
            clips: json.animations.map((animation) => animation.name),
        };
    }
    return { id, name: pet.name, family, rig: type, bytes: encoded.byteLength };
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const catalog = [
    ...rawPetPool,
    ...STARTER_PETS.map((option) => option.pet),
    ...STARTER_EVOLUTIONS,
];
invariant(catalog.length === 160, `expected 160 production pets, found ${catalog.length}`);
invariant(new Set(catalog.map((pet) => pet.id)).size === 160, "production pet ids must be unique");

const selectedIds = new Set(process.argv.slice(2));
const selected = catalog.filter((pet) => !INDIVIDUAL_PET_ANIMATION_MODEL_IDS.has(pet.id)
    && (!selectedIds.size || selectedIds.has(pet.id)));
invariant(selected.length > 0, "No roster-wide pet ids matched.");
const results = [];
for (const pet of selected) results.push(await authorPet(pet, manifest));

manifest.version = Math.max(3, manifest.version ?? 0);
manifest.animationBank = {
    revision: PROPER_PET_ANIMATION_ASSET_REVISION,
    authoredModels: rawPetPool.filter((pet) => !INDIVIDUAL_PET_ANIMATION_MODEL_IDS.has(pet.id)).length,
    individualModels: rawPetPool.filter((pet) => INDIVIDUAL_PET_ANIMATION_MODEL_IDS.has(pet.id)).length,
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const byFamily = Object.fromEntries([...new Set(results.map((result) => result.family))].sort().map((family) => [
    family,
    results.filter((result) => result.family === family).length,
]));
const byRig = Object.fromEntries([...new Set(results.map((result) => result.rig))].sort().map((type) => [
    type,
    results.filter((result) => result.rig === type).length,
]));
console.log(JSON.stringify({ revision: PROPER_PET_ANIMATION_ASSET_REVISION, authored: results.length, byFamily, byRig }, null, 2));
