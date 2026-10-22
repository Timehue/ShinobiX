import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, relative, resolve, sep } from 'node:path';
import { runtimePetModels } from './lib/pet-runtime-audit.mjs';
import { parseStudioGlb } from './lib/pet-studio-glb.mjs';
import { PET_REVIEW_RENDER_FILES, petReviewRendererSha256 } from './check-pet-shape-review.mjs';

const repo = resolve(import.meta.dirname, '../..');
const baseline = process.argv.find(arg => arg.startsWith('--base='))?.slice(7)
    ?? 'c1576ed5ec7ac5cc895571c3268920839c039168';
const BASE_RENDERER_SHA256 = 'b2253b71fbcb21a83d82de35ab5783dd57b525cfc94740fb131dd1eb0049a897';
const AZURE_REVISION = '20261021-azure-terminal-collapse-v3';
const AZURE_ID = 'mythic-6';
const AZURE_SOURCE_SHA256 = 'ccbd1932c455bab07859fca73b5c9b75c6197087beb35fbfbf602477ed0ba723';
const AZURE_BATTLE_SHA256 = 'adef4034b636c5c97041a3f0d35e541efd128fdd6b45af0d2de998ec7aa1f18d';
const EXPECTED_COMPONENT_SHA256 = '00dfcc369924555ee93b1feb92c814433ba97317fa9a684c4936c0c3f8e92f56';
const EXPECTED_GROUND_HELPER_SHA256 = '50e1aaf35ffa423648f60b6d25e1d1f9c07e7c79f84d1bfdd0d4c65f604912b8';
const REVIEW_DIR = 'docs/audits/pet-parallel-review-c-2026-10-20/mythic-6-private-v3';
const NORMALIZATION = value => value.replaceAll('\r\n', '\n');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const absolute = path => resolve(repo, path);
const git = (...args) => execFileSync('git', args, { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
const replaceOnce = (source, before, after, label) => {
    assert.equal(source.split(before).length - 1, 1, `${label}: expected one baseline anchor`);
    return source.replace(before, after);
};

assert.match(baseline, /^[a-f0-9]{40}$/);
git('cat-file', '-e', `${baseline}^{commit}`);

// Recreate the aggregate renderer fingerprint used by existing visual receipts.
const baseRenderer = createHash('sha256');
const rendererFiles = [];
const rendererBefore = new Map();
for (const path of PET_REVIEW_RENDER_FILES) {
    const before = NORMALIZATION(git('show', `${baseline}:${path}`).toString('utf8'));
    const after = NORMALIZATION(await readFile(absolute(path), 'utf8'));
    rendererBefore.set(path, before);
    baseRenderer.update(path + '\0').update(before).update('\0');
    rendererFiles.push({ path, baselineSha256: hash(Buffer.from(before)), currentSha256: hash(Buffer.from(after)), unchanged: before === after });
}
assert.equal(baseRenderer.digest('hex'), BASE_RENDERER_SHA256, 'the specified receipt renderer fingerprint does not match the baseline');

// The renderer diff is intentionally enumerated: only the Azure terminal-death
// metadata guard, its dead-to-revive timer, and their host transforms may differ.
const componentPath = 'shinobij.client/src/components/PetModel3D.tsx';
let expectedComponent = rendererBefore.get(componentPath);
const currentComponent = NORMALIZATION(await readFile(absolute(componentPath), 'utf8'));
const componentChanges = [
    [
        'userData?: { characterMotion?: PetCharacterMotionBank }',
        'userData?: { characterMotion?: PetCharacterMotionBank; deathPoseRepair?: { revision?: string } }',
        'read the optional GLB death-pose metadata',
    ],
    [
        '    const lastMotion = useRef<PetModelFrame["motion"]>("idle");',
        '    const lastMotion = useRef<PetModelFrame["motion"]>("idle");\n    const authoredDeathRecoveryUntil = useRef(-Infinity);',
        'track the short recovery interval',
    ],
    [
        '        if (timelineReset) {\n            rigMotion.reset();',
        '        if (timelineReset) {\n            authoredDeathRecoveryUntil.current = -Infinity;\n            rigMotion.reset();',
        'reset the recovery interval on timeline reset',
    ],
    [
        '        if (motionChanged) {\n            lastMotion.current = f.motion;',
        "        if (motionChanged) {\n            if (lastMotion.current === 'dead') authoredDeathRecoveryUntil.current = timeline + .35;\n            lastMotion.current = f.motion;",
        'start the .35 second dead-to-revive interval',
    ],
    [
        '        const deathPose = petDeathChoreography(motionAge, config.targetHeight, config.profile);',
        "        const deathPose = petDeathChoreography(motionAge, config.targetHeight, config.profile);\n        // This take authors the complete, floor-calibrated fall on its root.\n        // Applying the generic host collapse again rolls the creature twice.\n        const authoredTerminalDeath = dead && gltf.userData?.deathPoseRepair?.revision === '20261021-azure-terminal-collapse-v3';",
        'gate the authored terminal-death take by its exact revision',
    ],
    [
        'const rootHeight = bob + dodgeHeight + avianDiveArc + victoryArc + actionLift + utilityLift + entryLift + (dead ? deathPose.lift - deathPose.sink : 0);',
        'const rootHeight = authoredTerminalDeath ? 0 : bob + dodgeHeight + avianDiveArc + victoryArc + actionLift + utilityLift + entryLift + (dead ? deathPose.lift - deathPose.sink : 0);',
        'suppress the second generic root collapse only for the authored take',
    ],
    [
        'b.rotation.x = THREE.MathUtils.lerp(b.rotation.x, bakedSupport ? 0 : authoredPitch * bodyAccent + techniquePose.pitch, petAnimationBlend(presentationDelta, dead ? 4 : 15));',
        'b.rotation.x = THREE.MathUtils.lerp(b.rotation.x, bakedSupport || authoredTerminalDeath ? 0 : authoredPitch * bodyAccent + techniquePose.pitch, petAnimationBlend(presentationDelta, dead ? 4 : 15));',
        'guard authored death pitch',
    ],
    [
        'b.rotation.y = THREE.MathUtils.lerp(b.rotation.y, bakedSupport ? 0 : (heroPose.yaw + personalityYaw + entryYaw + victoryYaw) * bodyAccent + techniquePose.yaw, petAnimationBlend(presentationDelta, 13));',
        'b.rotation.y = THREE.MathUtils.lerp(b.rotation.y, bakedSupport || authoredTerminalDeath ? 0 : (heroPose.yaw + personalityYaw + entryYaw + victoryYaw) * bodyAccent + techniquePose.yaw, petAnimationBlend(presentationDelta, 13));',
        'guard authored death yaw',
    ],
    [
        'b.rotation.z = THREE.MathUtils.lerp(b.rotation.z, bakedSupport ? 0 : authoredRoll * bodyAccent + techniquePose.roll + flankCollapse, petAnimationBlend(presentationDelta, 11));',
        'b.rotation.z = THREE.MathUtils.lerp(b.rotation.z, bakedSupport || authoredTerminalDeath ? 0 : authoredRoll * bodyAccent + techniquePose.roll + flankCollapse, petAnimationBlend(presentationDelta, 11));',
        'guard authored death roll',
    ],
    [
        'b.position.x = THREE.MathUtils.lerp(b.position.x, bakedSupport ? 0 : weightX, weightBlend);\n        b.position.y = THREE.MathUtils.lerp(b.position.y, bakedSupport ? 0 : weightY, weightBlend);\n        b.position.z = THREE.MathUtils.lerp(b.position.z, bakedSupport ? 0 : driveZ, weightBlend);',
        'b.position.x = THREE.MathUtils.lerp(b.position.x, bakedSupport || authoredTerminalDeath ? 0 : weightX, weightBlend);\n        b.position.y = THREE.MathUtils.lerp(b.position.y, bakedSupport || authoredTerminalDeath ? 0 : weightY, weightBlend);\n        b.position.z = THREE.MathUtils.lerp(b.position.z, bakedSupport || authoredTerminalDeath ? 0 : driveZ, weightBlend);',
        'guard generic authored-death body offsets',
    ],
    [
        '        if (dead && authoredCombatRig && deathPose.fall > 0.3) {',
        "        const authoredCollapseContact = gltf.userData?.deathPoseRepair?.revision === '20261021-azure-terminal-collapse-v3'\n            && (dead || timeline < authoredDeathRecoveryUntil.current);\n        if (authoredCollapseContact || (dead && authoredCombatRig && deathPose.fall > 0.3)) {",
        'extend exact floor contact only through this authored death and recovery',
    ],
    [
        'const groundY = petModelGroundY(prepared.surface);',
        '// Whole-rig crossfades can lower a paw between two individually\n            // grounded poses. Check every vertex for this authored collapse\n            // and its short revive blend; ordinary deaths retain the cheap probe.\n            const groundY = petModelGroundY(prepared.surface, authoredCollapseContact);',
        'request exact vertex contact only while the Azure metadata guard is active',
    ],
];
for (const [before, after, label] of componentChanges) expectedComponent = replaceOnce(expectedComponent, before, after, label);
if (currentComponent !== expectedComponent) {
    const actualLines = currentComponent.split('\n'), expectedLines = expectedComponent.split('\n');
    const differingLines = [];
    for (let index = 0; index < Math.max(actualLines.length, expectedLines.length); index++) {
        if (actualLines[index] !== expectedLines[index]) differingLines.push({ line: index + 1, expected: expectedLines[index], actual: actualLines[index] });
        if (differingLines.length >= 12) break;
    }
    console.error(JSON.stringify(differingLines, null, 2));
}
assert.equal(currentComponent, expectedComponent, 'PetModel3D differs beyond the enumerated Azure terminal-death guard');
assert.equal(hash(await readFile(absolute(componentPath))), EXPECTED_COMPONENT_SHA256, 'current PetModel3D does not match the reviewed candidate component');

// The optional exact sampler preserves the previous 512-sample/0.5%-quantile
// behavior when exact is omitted or false.
const helperPath = 'shinobij.client/src/lib/pet-model-ground-contact.ts';
const helperBefore = NORMALIZATION(git('show', `${baseline}:${helperPath}`).toString('utf8'));
const helperCurrent = NORMALIZATION(await readFile(absolute(helperPath), 'utf8'));
let expectedHelper = helperBefore;
for (const [before, after, label] of [
    ['petModelGroundY(surface: THREE.Object3D): number | null', 'petModelGroundY(surface: THREE.Object3D, exact = false): number | null', 'default exact mode to false'],
    ['const stride = Math.max(1, Math.ceil(positions.count / 512));', 'const stride = exact ? 1 : Math.max(1, Math.ceil(positions.count / 512));', 'retain the prior sparse stride by default'],
    ['return heights[Math.floor((heights.length - 1) * .005)];', 'return heights[exact ? 0 : Math.floor((heights.length - 1) * .005)];', 'retain the prior percentile by default'],
]) expectedHelper = replaceOnce(expectedHelper, before, after, label);
assert.equal(helperCurrent, expectedHelper, 'ground-contact helper differs beyond its optional exact sampling mode');
assert.equal(hash(await readFile(absolute(helperPath))), EXPECTED_GROUND_HELPER_SHA256, 'ground-contact helper hash differs from the reviewed candidate');
const groundTestOutput = execFileSync(process.execPath, ['--import', 'tsx', '--test', 'src/lib/pet-model-ground-contact.test.ts'], {
    cwd: absolute('shinobij.client'), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
});
assert.match(groundTestOutput, /pass 3/);
assert.match(groundTestOutput, /fail 0/);

for (const entry of rendererFiles) {
    if (entry.path !== componentPath) assert.equal(entry.unchanged, true, `${entry.path} changed; existing 160-pet receipts need a different compatibility proof`);
}
const currentRendererSha256 = await petReviewRendererSha256(repo);

// A byte- and receipt-bound false-guard proof for every existing non-Azure rig.
const shapeReviews = JSON.parse(await readFile(absolute('docs/audits/pet-animation-shape-reviews.json'), 'utf8')).pets;
const priorCompatibility = JSON.parse(await readFile(absolute('docs/audits/oni-coordinated-technique-renderer-compatibility-2026-10-17.json'), 'utf8'));
assert.equal(priorCompatibility.priorRendererSha256, '5f9f24e92abe45bafcccd21f72a1ba8de81e0f0cd2a44f6f2aa440ee08e0d1cb');
assert.equal(priorCompatibility.rendererSha256, BASE_RENDERER_SHA256);
assert.equal(priorCompatibility.identities, 160);
const priorCompatibilityPets = new Map(priorCompatibility.pets.map(pet => [pet.id, pet]));
const publicRoot = absolute('shinobij.client/public/pet-models');
const unaffected = runtimePetModels.filter(row => row.pet.id !== AZURE_ID);
assert.equal(unaffected.length, 160, 'the unchanged scope is not exactly the 160 non-Azure runtime identities');
const pets = [];
for (const row of unaffected) {
    const receipt = shapeReviews[row.pet.id];
    assert.ok(receipt, `${row.pet.id}: existing visual receipt missing`);
    let rendererReceiptBasis = 'direct baseline renderer receipt';
    if (receipt.rendererSha256 !== BASE_RENDERER_SHA256) {
        assert.equal(receipt.rendererSha256, priorCompatibility.priorRendererSha256, `${row.pet.id}: renderer receipt has no accepted compatibility chain`);
        const compatibilityPet = priorCompatibilityPets.get(row.pet.id);
        assert.ok(compatibilityPet, `${row.pet.id}: missing from prior renderer compatibility audit`);
        rendererReceiptBasis = 'prior renderer receipt covered by exact-asset compatibility audit';
    }
    const sourceBytes = await readFile(row.path);
    const sourceSha256 = hash(sourceBytes);
    assert.equal(sourceSha256, receipt.sha256, `${row.pet.id}: current source differs from its existing visual receipt`);
    const sourceJson = parseStudioGlb(sourceBytes).json;
    const sourceRevision = sourceJson.extras?.deathPoseRepair?.revision ?? null;
    assert.notEqual(sourceRevision, AZURE_REVISION, `${row.pet.id} source activates Azure-specific rendering`);

    const battlePath = resolve(publicRoot, 'warfront-lod', relative(publicRoot, row.path));
    const battleBytes = await readFile(battlePath);
    const battleSha256 = hash(battleBytes);
    assert.equal(battleSha256, receipt.lodSha256, `${row.pet.id}: current battle model differs from its existing visual receipt`);
    const battleJson = parseStudioGlb(battleBytes).json;
    const battleRevision = battleJson.extras?.deathPoseRepair?.revision ?? null;
    assert.notEqual(battleRevision, AZURE_REVISION, `${row.pet.id} battle model activates Azure-specific rendering`);
    if (rendererReceiptBasis !== 'direct baseline renderer receipt') {
        const compatibilityPet = priorCompatibilityPets.get(row.pet.id);
        const sourceLocal = relative(resolve(repo), row.path).replaceAll('\\', '/');
        const battleLocal = relative(resolve(repo), battlePath).replaceAll('\\', '/');
        assert.equal(compatibilityPet.assets.find(asset => asset.path === sourceLocal)?.sha256, sourceSha256, `${row.pet.id}: source receipt is not pinned in the renderer compatibility audit`);
        assert.equal(compatibilityPet.assets.find(asset => asset.path === battleLocal)?.sha256, battleSha256, `${row.pet.id}: battle receipt is not pinned in the renderer compatibility audit`);
    }
    const bank = sourceJson.extras?.characterMotion;
    assert.ok(bank, `${row.pet.id}: source has no character motion metadata`);
    // Both guards are constant-false for all reachable motion/timeline states
    // whenever this exact revision is absent. Enumerate all state combinations
    // to make that invariant durable rather than inferring it from one frame.
    let guardStates = 0;
    for (const dead of [false, true]) for (const inRecovery of [false, true]) {
        const authoredTerminalDeath = dead && sourceRevision === AZURE_REVISION;
        const authoredCollapseContact = sourceRevision === AZURE_REVISION && (dead || inRecovery);
        assert.equal(authoredTerminalDeath, false);
        assert.equal(authoredCollapseContact, false);
        for (const bakedSupport of [false, true]) {
            assert.equal(bakedSupport || authoredTerminalDeath, bakedSupport);
            guardStates++;
        }
        for (const legacyFloorProbe of [false, true])
            assert.equal(authoredCollapseContact || legacyFloorProbe, legacyFloorProbe);
    }
    pets.push({ id: row.pet.id, sourceSha256, battleSha256, sourceDeathPoseRevision: sourceRevision, battleDeathPoseRevision: battleRevision, rendererReceiptBasis, guardStates });
}

// Validate the private Azure pair and the complete-review receipt. This is
// compatibility provenance only; it does not promote the candidate or close
// any unrelated review holds.
const privateDir = 'shinobij.client/.tmp/sol-azure-death-v3';
const review = JSON.parse(await readFile(absolute(`${REVIEW_DIR}/review.json`), 'utf8'));
const evidenceIndex = JSON.parse(await readFile(absolute(`${REVIEW_DIR}/evidence-index.json`), 'utf8'));
assert.equal(review.id, AZURE_ID);
assert.equal(review.verdict, 'PASS_PRIVATE_V3_DEATH_RUNTIME');
assert.equal(review.candidate.metadataRevision, AZURE_REVISION);
assert.equal(review.candidate.sourceSha256, AZURE_SOURCE_SHA256);
assert.equal(review.candidate.battleSha256, AZURE_BATTLE_SHA256);
assert.equal(review.candidate.componentSha256, EXPECTED_COMPONENT_SHA256);
assert.equal(review.candidate.groundContactHelperSha256, EXPECTED_GROUND_HELPER_SHA256);
assert.equal(review.runtimeReview.metadataVerifiedThroughGltfUserData, true);
assert.equal(review.runtimeReview.hostGuardVerified, true);
assert.equal(evidenceIndex.candidateSourceSha256, AZURE_SOURCE_SHA256);
assert.equal(evidenceIndex.candidateBattleSha256, AZURE_BATTLE_SHA256);
assert.equal(evidenceIndex.petModel3DComponentSha256, EXPECTED_COMPONENT_SHA256);
assert.equal(evidenceIndex.groundContactHelperSha256, EXPECTED_GROUND_HELPER_SHA256);
const azurePair = [];
const azureRecipe = JSON.parse(await readFile(absolute(`${privateDir}/recipe.json`), 'utf8'));
for (const [stage, expectedHash] of [['source', AZURE_SOURCE_SHA256], ['battle', AZURE_BATTLE_SHA256]]) {
    const path = `${privateDir}/${stage}.glb`;
    const bytes = await readFile(absolute(path));
    assert.equal(hash(bytes), expectedHash, `${path}: differs from the private reviewed hash`);
    const extras = parseStudioGlb(bytes).json.extras;
    assert.equal(extras?.deathPoseRepair?.revision, AZURE_REVISION, `${path}: exact guard metadata missing`);
    const recipe = azureRecipe.find(item => item.stage === stage);
    assert.equal(recipe?.sha256, expectedHash, `${stage}: build recipe hash differs from private reviewed model`);
    assert.equal(recipe?.revision, AZURE_REVISION, `${stage}: build recipe is for a different revision`);
    assert.equal(extras.deathPoseRepair.sourceSha256, recipe.sourceSha256, `${stage}: GLB metadata does not pin its actual source input`);
    azurePair.push({ stage, path, sha256: expectedHash, deathPoseRepairRevision: extras.deathPoseRepair.revision, sourceSha256: extras.deathPoseRepair.sourceSha256 });
}
for (const item of [...evidenceIndex.captureManifests, ...evidenceIndex.personallyViewedPixelSheets]) {
    const normalizedPath = item.path.replaceAll('\\', '/');
    const match = normalizedPath.match(/(?:^|\/)(docs\/(?:audits|screenshots)\/.+)$/);
    assert.ok(match, `review evidence path is outside the expected docs tree: ${item.path}`);
    const bytes = await readFile(absolute(match[1]));
    assert.equal(bytes.byteLength, item.bytes, `${match[1]}: review evidence byte count changed`);
    assert.equal(hash(bytes), item.sha256, `${match[1]}: review evidence fingerprint changed`);
}

const report = {
    schema: 1,
    baselineCommit: baseline,
    priorRendererSha256: BASE_RENDERER_SHA256,
    currentRendererSha256,
    rendererFiles,
    componentChange: { path: componentPath, sha256: EXPECTED_COMPONENT_SHA256, enumeratedAzureOnly: true, changeCount: componentChanges.length },
    groundContactHelper: { path: helperPath, sha256: EXPECTED_GROUND_HELPER_SHA256, exactDefaultsFalseAndPreservesOldSampling: true, regressionTest: 'node --import tsx --test src/lib/pet-model-ground-contact.test.ts: 3 passed, 0 failed' },
    unaffectedIdentities: pets.length,
    unaffectedAssetsChecked: pets.length * 2,
    unaffectedAllMatchExistingSourceBattleReceipts: true,
    azureRevisionAbsentFromAllUnaffectedAssets: true,
    guardCombinationsChecked: pets.reduce((total, pet) => total + pet.guardStates, 0),
    azurePrivatePair: azurePair,
    azureReview: { path: `${REVIEW_DIR}/review.json`, verdict: review.verdict, evidenceIndexPath: `${REVIEW_DIR}/evidence-index.json`, hashedEvidenceFilesChecked: evidenceIndex.captureManifests.length + evidenceIndex.personallyViewedPixelSheets.length },
    scopeLimit: 'Renderer compatibility proof only. It preserves prior visual receipts for the 160 non-Azure identities; it is not new art approval and does not close the seven outstanding pet review holds.',
    pets,
};
const output = absolute('docs/audits/pet-azure-terminal-renderer-compatibility-2026-10-21.json');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ identities: report.unaffectedIdentities, assets: report.unaffectedAssetsChecked, guardCombinations: report.guardCombinationsChecked, azureEvidenceFilesChecked: report.azureReview.hashedEvidenceFilesChecked, rendererSha256: currentRendererSha256, output }, null, 2));
