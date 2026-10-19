import {assertReviewedDistinctPebblePayload} from '../../scripts/lib/pet-reviewed-payload.mjs';
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { rawPetPool } from "../data/pet-pool.ts";
import { STARTER_PETS } from "../data/starter-pets.ts";
import { STARTER_EVOLUTIONS } from "../data/pet-evolutions.ts";
import {
    INDIVIDUAL_PET_ANIMATION_MODEL_IDS,
    PET_RIG_REPAIR_REVISIONS,
    PET_CHARACTER_MOTION_ASSET_REVISION,
    PROPER_PET_ANIMATION_ASSET_REVISION,
} from "./pet-proper-animation-assets.ts";
import { PET_SHOWDOWN_ANIMATION_ASSET_REVISION } from "./pet-showdown-animation-assets.ts";
import { petCombatModel } from "./pet-3d-models.ts";

const CORE_CLIPS = [
    "idle", "idle_2", "walk", "gallop", "gallop_jump", "attack", "idle_hitreact1", "death",
];
const IDENTITY_CLIPS = [
    ...CORE_CLIPS, "entrance", "cast", "guard", "rest", "victory",
];
const catalog = [
    ...rawPetPool,
    ...STARTER_PETS.map((option) => option.pet),
    ...STARTER_EVOLUTIONS,
];

// Fitted chains retain the original bone frames and their authored curves.
// Only these independently reviewed append-only repairs may use legacy limbs.
const reviewedLimbRepairs: Record<string, string> = {
    'legendary-13': 'polarBearAnatomicalLimbExperiment',
    'legendary-15': 'chimeraAnatomicalLimbRepair',
    'legendary-17': 'behemothAnatomicalLimbRepair',
    'legendary-23': 'sphinxAnatomicalLimbRepair',
    'legendary-24': 'raijuAnatomicalLimbRepair',
    'legendary-26': 'manticoreAnatomicalLimbRepair',
    'mythic-4': 'oniAnatomicalLimbRepair',
    'mythic-0': 'eclipseKitsuneAnatomicalLimbRepair',
    'mythic-1': 'worldstormDragonAnatomicalLimbRepair',
    'mythic-3': 'solarStagAnatomicalLimbRepair',
    'mythic-6': 'azureRyujinAnatomicalLimbRepair',
    'mythic-12': 'skyglassKirinAnatomicalLimbRepair',
    'mythic-13': 'thunderbloomKirinAnatomicalLimbRepair',
    'mythic-14': 'gravepeakBehemothAnatomicalLimbRepair',
    'mythic-15': 'celestialLionAnatomicalLimbRepair',
    'starter-fire': 'cinderCubAnatomicalLimbRepair',
    'mythic-10': 'ashCrownPhoenixAnatomicalLegRepair',
};
const reviewedTorsoActions: Record<string, string> = {
    'legendary-7': '20261017-moon-serpent-supported-actions-v2',
    'legendary-8': '20261017-storm-lion-coordinated-actions-v1',
    'legendary-11': '20261017-thunder-drake-coordinated-actions-v1',
};

function parseGlb(path: string) {
    const file = readFileSync(path);
    assert.equal(file.subarray(0, 4).toString("ascii"), "glTF", `${path}: missing GLB magic`);
    assert.equal(file.readUInt32LE(8), file.byteLength, `${path}: GLB length mismatch`);
    const jsonLength = file.readUInt32LE(12);
    return JSON.parse(file.subarray(20, 20 + jsonLength).toString("utf8").replace(/[\0\s]+$/u, ""));
}

test("all 161 production pets have complete proper skeletal animation banks", () => {
    assert.equal(catalog.length, 161);
    assert.equal(new Set(catalog.map((pet) => pet.id)).size, 161);
    const families = new Set<string>();
    const rigs = new Set<string>();
    const signatureSeeds = new Set<number>();
    const identityFingerprints = new Set<string>();
    const showcaseFingerprints = new Set<string>();
    let individual = 0;
    let identityAuthored = 0;

    for (const pet of catalog) {
        const individuallyAuthored = INDIVIDUAL_PET_ANIMATION_MODEL_IDS.has(pet.id);
        const path = individuallyAuthored
            ? resolve(import.meta.dirname, `../../public/pet-models/showdown-v2/${pet.id}.glb`)
            : pet.id.startsWith("starter-")
                ? resolve(import.meta.dirname, `../../public/pet-models/${pet.id}.glb`)
                : resolve(import.meta.dirname, `../../public/pet-models/roster/${pet.id}.glb`);
        const json = parseGlb(path);
        const distinctPebble = pet.id==='starter-earth' && Boolean(json.extras?.pebbleDistinctRebuild);
        if(distinctPebble)assertReviewedDistinctPebblePayload(path,readFileSync(path),json);
        const limbRepair = json.extras?.[reviewedLimbRepairs[pet.id]];
        if (limbRepair) {
            assert.equal(json.skins[0].joints.length, pet.id === 'mythic-15' ? 41 : pet.id === 'mythic-10' ? 29 : ['mythic-3', 'mythic-13', 'mythic-14', 'starter-fire'].includes(pet.id) ? 35 : 33, `${pet.id}: fitted anatomical joint count`);
            if (pet.id === 'mythic-3') {
                assert.equal(json.extras.solarStagAnatomicalNeckRepair.fitted.length, 2);
                assert.equal(json.extras.solarStagAnatomicalNeckRepair.clips.length, 13);
            }
            if (pet.id === 'starter-fire') {
                assert.equal(json.extras.cinderCubAnatomicalNeckRepair.fitted.length, 2);
                assert.equal(json.extras.cinderCubAnatomicalNeckRepair.clips.length, 13);
            }
            if (pet.id === 'mythic-15') {
                assert.equal(json.extras.celestialLionAnatomicalNeckRepair.fitted.length, 2);
                assert.equal(json.extras.celestialLionAnatomicalNeckRepair.clips.length, 13);
            }
            if (pet.id === 'mythic-14') {
                assert.equal(json.extras.gravepeakBehemothAnatomicalNeckRepair.fitted.length, 2);
                assert.equal(json.extras.gravepeakBehemothAnatomicalNeckRepair.clips.length, 13);
            }
            if (pet.id === 'mythic-13') {
                assert.equal(json.extras.thunderbloomKirinAnatomicalNeckRepair.fitted.length, 2);
                assert.equal(json.extras.thunderbloomKirinAnatomicalNeckRepair.clips.length, 13);
            }
            assert.equal(limbRepair.legs.length, pet.id === 'mythic-10' ? 2 : 4);
            assert.match(limbRepair.sourceSha256, /^[a-f0-9]{64}$/);
        }
        assert.deepEqual(
            json.animations?.map((animation: { name: string }) => animation.name),
            IDENTITY_CLIPS,
            `${pet.id}: incomplete clip set`,
        );

        if (individuallyAuthored) {
            individual += 1;
            assert.equal(json.extras?.showdownAnimationBank, PET_SHOWDOWN_ANIMATION_ASSET_REVISION);
            assert.equal(json.extras?.animationAuthoring, "bespoke-species-performance-v3");
            assert.equal(json.extras?.showdownAnimationIdentity?.key, pet.id);
            assert.match(json.extras?.showdownAnimationIdentity?.fingerprint, /^[A-F0-9]{24}$/u);
            showcaseFingerprints.add(json.extras.showdownAnimationIdentity.fingerprint);
        } else {
            identityAuthored += 1;
            assert.equal(json.extras?.properAnimationBank, PROPER_PET_ANIMATION_ASSET_REVISION, `${pet.id}: stale animation revision`);
            assert.equal(typeof json.extras?.properAnimationFamily, "string");
            assert.equal(typeof json.extras?.properAnimationRig, "string");
            assert.equal(json.extras?.animationAuthoring, "individual-species-performance-v5");
            assert.equal(typeof json.extras?.properAnimationSignature?.seed, "number");
            assert.equal(typeof json.extras?.properAnimationSignature?.cadence, "number");
            assert.equal(typeof json.extras?.properAnimationSignature?.strikeDrive, "number");
            assert.equal(typeof json.extras?.properAnimationIdentity?.key, "string");
            assert.equal(typeof json.extras?.properAnimationIdentity?.motif, "string");
            assert.equal(typeof json.extras?.properAnimationIdentity?.entrance, "string");
            assert.equal(typeof json.extras?.properAnimationIdentity?.victory, "string");
            assert.match(json.extras?.properAnimationIdentity?.fingerprint, /^[A-F0-9]{24}$/u);
            assert.ok(json.extras.properAnimationSignature.cadence >= 0.84 && json.extras.properAnimationSignature.cadence <= 1.18);
            assert.ok(json.extras.properAnimationSignature.strikeDrive >= 0.78 && json.extras.properAnimationSignature.strikeDrive <= 1.48);
            signatureSeeds.add(json.extras.properAnimationSignature.seed);
            identityFingerprints.add(json.extras.properAnimationIdentity.fingerprint);
            families.add(json.extras.properAnimationFamily);
            rigs.add(json.extras.properAnimationRig);
        }

        for (const [index, animation] of json.animations.entries()) {
            assert.ok(animation.channels.length >= 4, `${pet.id}/${animation.name}: take is too sparse`);
            const originalCount = json.extras.performanceRefinement?.sourceBoundary.channels[index] ?? animation.channels.length;
            assert.ok(originalCount <= (pet.id === "starter-lightning-l" || distinctPebble ? 16 : pet.id === "mythic-15" ? 13 : 9), `${pet.id}/${animation.name}: original body take became generic`);
            for (const channel of animation.channels.slice(originalCount)) {
                const name = json.nodes[channel.target.node].name;
                const contactBank = json.extras.characterMotion?.revision === PET_CHARACTER_MOTION_ASSET_REVISION;
                if (contactBank && name === 'root' && channel.target.path === 'translation') continue;
                assert.equal(channel.target.path, 'rotation', 'articulation only adds joint rotations or a verified support root');
                const coordinated = json.extras?.coordinatedActionRepair;
                const reviewedTorso = limbRepair || (reviewedTorsoActions[pet.id]
                    && coordinated?.revision === reviewedTorsoActions[pet.id]
                    && coordinated.clips.some((clip: { name: string }) => clip.name === animation.name));
                if (contactBank && reviewedTorso && ['chest', 'pelvis'].includes(name)) continue;
                const tailClearance = json.extras?.frostWyrmTailClearance;
                if (contactBank && pet.id === 'legendary-19' && name === 'tail_1'
                    && tailClearance?.revision === '20261017-frost-wyrm-tail-clearance-v1'
                    && tailClearance.clips.some((clip: { name: string }) => clip.name === animation.name)) continue;
                if (contactBank && pet.id === 'mythic-3' && limbRepair && ['head', 'neck', 'legacy_face_head', 'legacy_face_neck'].includes(name)) {
                    assert.equal(json.extras.solarStagAnatomicalNeckRepair.revision, '20261017-solar-stag-anatomical-neck-v1');
                    assert.ok(json.extras.solarStagAnatomicalNeckRepair.fitted.some((fitted: { node: number; oldNode: number }) => fitted.node === channel.target.node || fitted.oldNode === channel.target.node));
                    continue;
                }
                if (contactBank && pet.id === 'mythic-10' && limbRepair && ['head', 'neck', 'legacy_face_head', 'legacy_face_neck'].includes(name)) {
                    const neckRepair = json.extras.ashCrownPhoenixAnatomicalNeckRepair;
                    assert.equal(neckRepair.revision, '20261018-ash-crown-phoenix-anatomical-neck-v4');
                    assert.equal(neckRepair.fitted.length, 2);
                    assert.equal(neckRepair.clips.reduce((sum: number, clip: { tracks: number }) => sum + clip.tracks, 0), 18);
                    assert.ok(neckRepair.fitted.some((fitted: { node: number; oldNode: number }) => fitted.node === channel.target.node || fitted.oldNode === channel.target.node));
                    continue;
                }
                if (contactBank && pet.id === 'mythic-13' && limbRepair && ['head', 'neck', 'legacy_face_head', 'legacy_face_neck'].includes(name)) {
                    const neckRepair = json.extras.thunderbloomKirinAnatomicalNeckRepair;
                    assert.equal(neckRepair.revision, '20261018-thunderbloom-kirin-anatomical-neck-v1');
                    assert.equal(neckRepair.fitted.length, 2);
                    assert.ok(neckRepair.fitted.some((fitted: { node: number; oldNode: number }) => fitted.node === channel.target.node || fitted.oldNode === channel.target.node));
                    continue;
                }
                if (contactBank && pet.id === 'mythic-14' && limbRepair) {
                    const neckRepair = json.extras.gravepeakBehemothAnatomicalNeckRepair;
                    assert.equal(neckRepair.revision, '20261018-gravepeak-behemoth-anatomical-neck-v1');
                    if (['head', 'neck', 'legacy_face_head', 'legacy_face_neck'].includes(name)) {
                        assert.ok(neckRepair.fitted.some((f: { node: number; oldNode: number }) => f.node === channel.target.node || f.oldNode === channel.target.node));
                        continue;
                    }
                    const legacy = name.match(/^legacy_(upper_arm|forearm|hand|thigh|shin|foot)\.([LR])$/);
                    if (legacy) {
                        const part = ['upper_arm', 'forearm', 'hand'].includes(legacy[1]) ? 'front' : 'hind';
                        const section = ['upper_arm', 'thigh'].includes(legacy[1]) ? 'upper' : ['forearm', 'shin'].includes(legacy[1]) ? 'lower' : 'paw';
                        assert.ok(json.nodes.some((n: { name: string }) => n.name === part + '_' + section + '.' + legacy[2]));
                        continue;
                    }
                    if (name === 'spine' && coordinated?.revision === '20261018-gravepeak-behemoth-coordinated-actions-v1' && ['attack', 'cast', 'idle_hitreact1'].includes(animation.name)) continue;
                }
                if (contactBank && pet.id === 'mythic-15' && limbRepair) {
                    const neckRepair = json.extras.celestialLionAnatomicalNeckRepair;
                    assert.equal(neckRepair.revision, '20261018-celestial-lion-anatomical-neck-v3');
                    if (['head', 'neck', 'legacy_face_head', 'legacy_face_neck'].includes(name)) {
                        assert.ok(neckRepair.fitted.some((f: { node: number; oldNode: number }) => f.node === channel.target.node || f.oldNode === channel.target.node));
                        continue;
                    }
                    if (name === 'spine' && coordinated?.revision === '20261018-celestial-lion-coordinated-actions-v3' && ['attack', 'cast', 'idle_hitreact1'].includes(animation.name)) continue;
                }
                if (contactBank && pet.id === 'starter-fire' && limbRepair) {
                    const neckRepair = json.extras.cinderCubAnatomicalNeckRepair;
                    assert.equal(neckRepair.revision, '20261018-cinder-cub-anatomical-neck-v2');
                    if (['head', 'neck', 'legacy_face_head', 'legacy_face_neck'].includes(name)) {
                        assert.ok(neckRepair.fitted.some((f: { node: number; oldNode: number }) => f.node === channel.target.node || f.oldNode === channel.target.node));
                        continue;
                    }
                    if (name === 'spine' && coordinated?.revision === '20261018-cinder-cub-coordinated-actions-v2' && ['attack', 'cast', 'idle_hitreact1'].includes(animation.name)) continue;
                }
                const retainedLimb = /^legacy_(?:front|hind)_(?:upper|lower|paw)\.[LR]$/.test(name)
                    || (pet.id === 'mythic-10' && /^legacy_(?:thigh|shin|foot)\.[LR]$/.test(name));
                const inspectedName = contactBank && limbRepair && retainedLimb
                    ? name.slice('legacy_'.length) : name;
                if (inspectedName !== name) {
                    assert.ok(json.skins[0].joints.some((node: number) => json.nodes[node].name === inspectedName), `${pet.id}: retained limb has no fitted replacement`);
                }
                const inspected = contactBank
                    ? /^(?:(?:front_upper|front_lower|front_paw|hind_upper|hind_lower|hind_paw|thigh|forearm|hand|shin|foot|wing_mid|wing_tip|bat_wing_lower|claw_pincer|leg_(?:front|mid|rear)_(?:upper|lower|foot))\.[LR]|tail_[23]|neck|scarf_2)$/
                    : /^(?:(?:front_lower|front_paw|hind_lower|hind_paw|forearm|hand|shin|foot|wing_mid|wing_tip|bat_wing_lower|claw_pincer|leg_(?:front|mid|rear)_(?:lower|foot))\.[LR]|tail_[23]|neck|scarf_2)$/;
                assert.match(inspectedName, inspected, `${pet.id}/${animation.name}: extra curves must belong to inspected anatomy`);
            }
            assert.ok(animation.channels.length <= json.skins[0].joints.length + 1, 'the bank stays within one rotation per joint plus its root translation');
            assert.equal(new Set(animation.channels.map((channel: { target: { node: number; path: string } }) => `${channel.target.node}:${channel.target.path}`)).size, animation.channels.length, 'joint tracks cannot compete');
            assert.equal(animation.channels.length, animation.samplers.length);
            for (const sampler of animation.samplers) {
                const input = json.accessors[sampler.input];
                assert.ok(input.min?.[0] === 0 && input.max?.[0] > 0, `${pet.id}/${animation.name}: invalid timeline`);
            }
        }
        const death = json.animations.find((animation: { name: string }) => animation.name === "death");
        assert.ok(death.channels.some((channel: { target: { node: number; path: string } }) => json.nodes[channel.target.node]?.name === "root" && channel.target.path === "translation"), `${pet.id}: death has no grounded root collapse`);
    }

    assert.equal(individual, 4);
    assert.equal(identityAuthored, 157);
    assert.equal(individual + identityAuthored, 161, "every production pet must be identity-directed");
    assert.equal(signatureSeeds.size, 157, "every generated GLB needs a distinct identity signature");
    assert.equal(identityFingerprints.size, 157, "every generated GLB needs a distinct performance fingerprint");
    assert.equal(showcaseFingerprints.size, 4, "every bespoke showcase GLB needs a distinct performance fingerprint");
    assert.equal(new Set([...identityFingerprints, ...showcaseFingerprints]).size, 161, "all production performances must be unique");
    assert.ok(families.size >= 12, "family coverage collapsed into too few motion styles");
    assert.deepEqual([...rigs].sort(), ["avian", "bat", "biped", "crab", "insect", "moth", "quadruped"]);
});

test("all 161 catalog identities resolve to a versioned runtime GLB with the full clip contract", () => {
    for (const pet of catalog) {
        const model = petCombatModel(pet);
        assert.ok(model, `${pet.id}: production model resolution failed`);
        const [assetUrl, revision] = model.url.split("?v=");
        assert.ok(revision, `${pet.id}: runtime GLB is not cache-versioned`);
        const expectedRevision = PET_RIG_REPAIR_REVISIONS[model.visualId] ?? (INDIVIDUAL_PET_ANIMATION_MODEL_IDS.has(model.visualId)
            ? PET_SHOWDOWN_ANIMATION_ASSET_REVISION
            : PROPER_PET_ANIMATION_ASSET_REVISION);
        assert.equal(revision, expectedRevision, `${pet.id}: stale runtime asset revision`);
        const path = resolve(import.meta.dirname, `../../public${assetUrl}`);
        const json = parseGlb(path);
        assert.deepEqual(
            json.animations?.map((animation: { name: string }) => animation.name),
            IDENTITY_CLIPS,
            `${pet.id}: resolved runtime GLB has an incomplete state contract`,
        );
    }
});

test("Celestial Lion has the full pet animation bank and animated wings in every clip", () => {
    const pet = catalog.find((entry) => entry.id === "mythic-15");
    assert.equal(pet?.name, "Celestial Lion");
    assert.equal(pet?.element, "Wind");
    const json = parseGlb(resolve(import.meta.dirname, "../../public/pet-models/roster/mythic-15.glb"));
    assert.deepEqual(json.animations.map((animation: { name: string }) => animation.name), IDENTITY_CLIPS);
    assert.equal(json.extras.properAnimationIdentity.key, "mythic-15:celestial lion");
    assert.equal(json.extras.properAnimationIdentity.motif, "feather");
    const wingRoots = ["angel_wing_upper.L", "angel_wing_mid.L", "angel_wing_upper.R", "angel_wing_mid.R"];
    for (const take of json.animations) {
        const animatedBones = new Set(take.channels.map((channel: { target: { node: number } }) => json.nodes[channel.target.node]?.name));
        for (const bone of wingRoots) assert.ok(animatedBones.has(bone), `${take.name}: ${bone} has no motion`);
    }
});
