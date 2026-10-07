import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { validateSectorLayouts, validateSpecialSectorLayout } from './validate-sector-layouts.mjs';
import { checkFloorAlignment } from './check-floor-alignment.mjs';
import { validateArtworkInputs, validateRenderedReview, validateSemanticReview, validateVerifiedEdgeReferences } from './sector-art-review-proof.mjs';
import { sectorExits } from '../shared/sector-links.ts';
const out = 'output/connected-world';
const layouts = JSON.parse(await fs.readFile(out + '/layouts.json', 'utf8'));
validateSectorLayouts(layouts);
const reviewed = JSON.parse(await fs.readFile(out + '/visual-review.json', 'utf8'));
const semantic = JSON.parse(await fs.readFile(out + '/semantic-review.json', 'utf8'));
const floorArtifacts = [], floors = {}, landmarks = {}, copies = [];
const specialArgument = process.argv.indexOf('--special99');
let special;
if (specialArgument >= 0) {
    const recipeFile = path.resolve(process.argv[specialArgument + 1]), recipe = JSON.parse(await fs.readFile(recipeFile, 'utf8'));
    const planInput = recipe.inputs.find(input => input.file.endsWith('art-and-collision-plan.json'));
    const plan = JSON.parse(await fs.readFile(planInput.file, 'utf8')), layout = plan.layout;
    validateSpecialSectorLayout(layout);
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    assert.equal(recipe.layoutSha256, hash(JSON.stringify(layout)));
    for (const input of [...recipe.inputs, ...recipe.frozenCode]) assert.equal(hash(await fs.readFile(input.file)), input.sha256);
    const bytes = await fs.readFile(recipe.file), meta = await sharp(bytes).metadata();
    assert.equal(hash(bytes), recipe.paintingSha256); assert.equal(meta.width, 1024); assert.equal(meta.height, 1024);
    assert.equal(meta.format, 'webp'); assert(bytes.length <= 250 * 1024);
    const approvalFile = path.join(path.dirname(recipeFile), 'physical-approval-sector-99.json'), approval = JSON.parse(await fs.readFile(approvalFile, 'utf8'));
    assert.equal(approval.paintingSha256, recipe.paintingSha256); assert.equal(approval.layoutSha256, recipe.layoutSha256);
    assert(approval.physicallyReviewedWhole && approval.physicallyReviewedMask && approval.physicalReviewPerformed);
    assert.deepEqual(approval.findings, []); assert.deepEqual(approval.physicallyReviewedTiles, Array.from({ length: 144 }, (_, t) => t));
    assert.deepEqual(approval.physicallyReviewedViewports, [1366, 390]);
    const playtest = JSON.parse(await fs.readFile(approval.playtestFile, 'utf8'));
    assert.equal(playtest.paintingSha256, recipe.paintingSha256); assert(playtest.all144SnapOracleChecksPassed);
    assert(playtest.normalGraphUnchanged && playtest.twelveInteriorRoomsUnchanged && playtest.pvpMultipliersUnchanged);
    assert.deepEqual(playtest.errors, []);
    const delivery = JSON.parse(await fs.readFile(path.resolve(path.dirname(recipeFile), '../art-delivery.json'), 'utf8'));
    assert.equal(delivery.paintingSha256, recipe.paintingSha256);
    special = { layout, recipe, recipeFile, approvalFile, delivery };
} else {
    const existing = JSON.parse(await fs.readFile('shared/sector-floor-layout-data.json', 'utf8'));
    assert(!existing.layouts[99], 'Supply --special99 with its reviewed recipe; never silently discard an admitted arena');
}
for (const layout of Object.values(layouts)) {
    const p = JSON.parse(await fs.readFile(`${out}/s${layout.artKey}-provenance.json`, 'utf8'));
    const layoutHash = createHash('sha256').update(JSON.stringify(layout)).digest('hex');
    if (p.layoutSha256 !== layoutHash) throw new Error('Painting uses a superseded layout: ' + layout.sector);
    const bytes = await fs.readFile(p.output), hash = createHash('sha256').update(bytes).digest('hex');
    const meta = await sharp(bytes).metadata();
    if (reviewed[String(layout.artKey)] !== hash || p.sha256 !== hash) throw new Error('Unreviewed painting ' + layout.sector);
    await validateArtworkInputs({manifest:p.references,sector:layout.sector,layoutSha256:layoutHash,prompt:p.prompt});
    const rendered = await validateRenderedReview({file:path.join(out,`candidate-alignment/sector-${layout.sector}-mask.png`),
        paintingSha256:hash,layoutSha256:layoutHash});
    const semanticReview = validateSemanticReview({sector:layout.sector,paintingSha256:hash,layoutSha256:layoutHash,
        imageSha256:rendered.imageSha256,entries:semantic.entries});
    validateVerifiedEdgeReferences({references:p.references,exits:sectorExits(layout.sector)});
    if (meta.width !== 1024 || meta.height !== 1024 || meta.format !== 'webp' || bytes.length > 250 * 1024) throw new Error('Invalid floor ' + layout.sector);
    floors[layout.artKey] = hash;
    copies.push([p.output, `shinobij.client/public/sector-map/s${layout.artKey}.webp`]);
    floorArtifacts.push({ sector: layout.sector, artKey: layout.artKey, name: layout.name, sha256: hash, bytes: bytes.length,
        quality: p.quality, source: path.basename(p.source), prompt: p.prompt, layoutSha256:layoutHash,
        references:p.references, productionTool:p.references.tool, semanticReview, status: 'visually-reviewed' });
}
const spriteArtifacts = JSON.parse(await fs.readFile(out + '/landmark-provenance.json', 'utf8'));
for (const [key, p] of Object.entries(spriteArtifacts)) {
    if (!key.endsWith(':rift')) continue; // Permanent landmarks already belong to the complete floor painting.
    const bytes = await fs.readFile(p.output), stats = await sharp(bytes).stats(), meta = await sharp(bytes).metadata();
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== p.sha256 || !meta.hasAlpha || stats.channels[3].min !== 0) throw new Error('Invalid transparent landmark ' + key);
    landmarks[key] = hash;
    copies.push([p.output, 'shinobij.client/public/landmarks/' + path.basename(p.output)]);
}
// Geometry and hashed visual approval cannot substitute for painted-pixel checks.
const alignment = await checkFloorAlignment({ layouts, candidates: true, render: false, out: path.resolve(out, 'admission-alignment') });
if (alignment.critical.length || alignment.interior.length || alignment.failedSeams.length)
    throw new Error('Artwork admission refused: resolve the reported collision or road-seam defects first.');
if (special) {
    const { layout, recipe, recipeFile, approvalFile, delivery } = special;
    layouts[99] = layout; floors[99] = recipe.paintingSha256;
    copies.push([recipe.file, 'shinobij.client/public/sector-map/s99.webp']);
    floorArtifacts.push({ sector: 99, artKey: 99, name: layout.name, sha256: recipe.paintingSha256,
        bytes: recipe.bytes, quality: recipe.quality, layoutSha256: recipe.layoutSha256,
        productionTool: 'owner-authorized-native-composition', recipeFile, physicalApproval: approvalFile,
        mapTravelOnly: true, interiorAndRewardsUnchanged: true, prompt: delivery.prompts,
        generatedAssets: delivery.assets, status: 'visually-reviewed' });
}
// All validation finishes before any painting or runtime geometry is replaced.
for (const [source, destination] of copies) await fs.copyFile(source, destination);
await fs.writeFile('shared/sector-floor-layout-data.json', JSON.stringify({ layouts, floors, landmarks }, null, 2) + '\n');
await fs.mkdir('docs/art', { recursive: true });
await fs.writeFile('docs/art/connected-sector-world-provenance.json', JSON.stringify({
    generated: '2026-10-04', provider: floorArtifacts.some(f=>f.productionTool==='owner-authorized-native-composition')?'image_gen-with-owner-authorized-native-composition':'image_gen', floors: floorArtifacts,
    landmarks: Object.fromEntries(Object.entries(spriteArtifacts).filter(([key]) => key.endsWith(':rift')).map(([key, p]) => [key, {
        source: path.basename(p.source), prompt: p.prompt, sha256: p.sha256, bytes: p.bytes,
    }])),
}, null, 2) + '\n');
console.log('Admitted ' + floorArtifacts.length + ' reviewed painting/mask pairs and ' + Object.keys(landmarks).length + ' regional landmarks.');
