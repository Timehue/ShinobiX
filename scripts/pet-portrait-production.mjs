import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = join(root, 'shinobij.client/public');
const productionRoot = join(root, 'shinobij.client/art-source/pet-portrait-refresh');
const manifestPath = join(productionRoot, 'production.json');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const relativePublic = (name) => join(publicRoot, name);
// Existing reviewed single-character frames avoid stacked-figure/checkerboard
// defects in these legacy idle illustrations. Their battle files stay intact.
const reviewedReferencePoses = {
    'standard-3': 'standard-3-windup.webp',
    'standard-30': 'standard-30-recover.webp',
    'standard-40': 'standard-40-recover.webp',
    'rare-2': 'rare-2-recover.webp',
    'rare-40': 'rare-40-run-a.webp',
};

const scenes = {
    Fire: [
        'a weathered shinobi village training courtyard at golden hour, stone paving, bamboo fencing, tiled eaves and a softly glowing distant lantern',
        'an old mountain shrine approach in warm late afternoon, mossy stone steps, cedar trees and distant tiled gates',
        'a quiet terracotta-roofed village lookout at sunset, carved wooden beams, hazy mountain silhouettes and amber clouds',
    ],
    Water: [
        'a clear shallow stream through a shinobi village garden, smooth stepping stones, a softly blurred wooden bridge and bamboo in morning mist',
        'a rain-cleared shrine courtyard, reflective stone paving, a traditional tiled gate and cool indigo shadows with warm lantern light',
        'a secluded waterfall pool beside ancient stone shrine steps, mist-softened cedar trees and luminous blue-green reflections',
    ],
    Wind: [
        'a mountain village rooftop training terrace, weathered tiles, distant pagoda eaves, hazy green peaks and a few windblown leaves',
        'a quiet bamboo grove with a narrow stone shinobi trail, distant shrine gate, sunlit drifting leaves and layered atmospheric depth',
        'a cliffside shinobi watchtower, old timber rails, rolling mountain mist and pale moving clouds',
    ],
    Lightning: [
        'a shinobi training courtyard after rain at blue hour, wet stone paving, a softly blurred tiled gate, bamboo, a warm lantern and distant storm glow',
        'a mountain shrine terrace beneath gathering storm clouds, old stone lanterns, windswept cedar branches and a restrained cool rim light',
        'a moonlit village watch post, rain-dark roof tiles, distant lantern windows and dramatic indigo clouds with subtle gold accents',
    ],
    Earth: [
        'an ancient shinobi monastery garden, textured stone paving, moss-covered walls, a small stone lantern and softly lit bamboo',
        'an old woodland shrine trail, broad cedar roots, mossy stepping stones, distant torii beams and filtered amber light',
        'a mountain fortress training ground, weathered carved stone, sparse grasses, hazy tiled rooftops and warm afternoon light',
    ],
};
const specialScenes = {
    'mythic-0': 'a moonlit ancient shrine approach, distant torii gates, gently drifting blank paper charms, pale lunar mist and restrained blue rim light; its existing tails form the composition',
    'mythic-4': 'fractured basalt before a ruined ancient sealing gate, low mist, weathered stone and subdued red reflected light that echoes the existing markings',
    'mythic-7': 'a bamboo shinobi training courtyard after rain, warm lantern reflections on stone paving and a softly blurred tiled gate, with a mischievous confident atmosphere',
    'legendary-1': 'a mountain shinobi watchtower roof, dramatic distant storm clouds, restrained background lightning, cool rim light and windblown mist',
    'rare-39': 'a coastal shinobi lookout above misty water, weathered timber and stone, distant signal pennants and pale sea light',
    'standard-38': 'a village rooftop ledge at dusk, a tiny stolen coin resting on the tiles nearby, softly blurred lantern windows and indigo mountains',
    'starter-earth': 'a mossy stone training path in an old shinobi monastery garden, a softly blurred tiled gate, bamboo and warm morning light',
};

function inventory() {
    const source = readFileSync(join(root, 'api/pet/_catalog.ts'), 'utf8');
    const catalog = JSON.parse(source.slice(source.indexOf('=') + 1).trim().replace(/;$/, ''));
    const pets = Object.values(catalog).sort((a, b) => Number(!a.id.startsWith('starter-')) - Number(!b.id.startsWith('starter-')) || a.id.localeCompare(b.id, undefined, { numeric: true }));
    if (pets.length !== 161 || new Set(pets.map((pet) => pet.id)).size !== 161) throw new Error('Expected 161 unique production companion identities.');
    return pets;
}

function spec(pet, index) {
    const id = pet.id;
    const element = pet.element || 'Earth';
    const source = id === 'starter-earth' ? 'pet-portraits/pebble-tortoise-chibi-v2.webp'
        : id === 'standard-1' ? 'pet-portraits/standard-1-card-v2.webp'
        : id === 'standard-17' ? 'pet-portraits/standard-17-card-v2.webp'
        : /^mythic-1[0-5]$/.test(id) ? `pet-portraits/breeding-mythics/${id}.webp`
        : id.startsWith('starter-') && /-[rl]$/.test(id) ? `pet-evos/${id}.webp`
        : `pet-poses/${reviewedReferencePoses[id] || `${id}-idle.webp`}`;
    if (!existsSync(relativePublic(source))) throw new Error(`Missing identity reference ${source}`);
    const showcaseAtlas = `pet-models/warfront-impostors/showdown-v2/${id}.webp`;
    const atlas = existsSync(relativePublic(showcaseAtlas)) ? showcaseAtlas : `pet-models/warfront-impostors/${id.startsWith('starter-') ? '' : 'roster/'}${id}.webp`;
    const references = [source];
    // Model-baked images are read-only identity references, never production outputs.
    if (!id.startsWith('starter-') && existsSync(relativePublic(atlas))) references.push(atlas);
    const scene = specialScenes[id] || scenes[element]?.[index % 3] || scenes.Earth[index % 3];
    const fidelity = id.startsWith('starter-')
        ? 'This is a starter or its evolved form: preserve the supplied creature almost exactly. Keep its exact face, eyes, expression, silhouette, pose, anatomy, proportions, colors, markings, clothing and equipment. The environment is the primary change. Do not redesign or mature it.'
        : 'Keep this exact companion recognizable and faithful to the game: preserve species, face, colors, markings, silhouette, proportions, costume and equipment. If Image 2 is supplied it is a grid of poses of the ONE production model, provided only to confirm the anatomy and outfit; never reproduce the grid or duplicate the creature. Resolve old illustration details against that production identity. Add no new wearable equipment.';
    const prompt = `Use case: identity-preserve. Asset: one finished square companion hero portrait for Shinobi Journey, a polished shinobi RPG. Image 1 is the edit target and main character reference: ${pet.name} (${id}). ${fidelity} Replace the empty or old backdrop with a complete, professionally painted setting: ${scene}. The scene fills the entire image edge to edge, with a grounded contact shadow or a physically appropriate perch/water surface. Unified collection style: clean anime ink, refined restrained cel shading with convincing rounded volume, tactile cloth and fur/feathers/scales, softly painted environments, indigo shadows and natural atmospheric depth. Retain the existing stylized character design; do not turn it photorealistic or generic. One complete creature dominates at about 75-80 percent of canvas height; keep all ears, feet, wings, weapons and tails inside safe margins for square and slightly wide card crops. Face and eyes read clearly at 200px. Background has lower detail and contrast than the subject. ${pet.rarity === 'mythic' || pet.rarity === 'legendary' ? 'Use dramatic but controlled hero lighting and atmospheric depth, keeping any elemental effects sparse and behind the silhouette.' : 'Use elegant grounded environmental lighting and subtle atmosphere, avoiding excessive magic effects.'} Forbidden motif: no single inward spiral village insignia, pointed spiral-leaf crest, spiral-centered flame crest, or spiral carving on any banner, lantern, headplate, cloth or stone surface; use plain unmarked surfaces instead. No additional characters, duplicate heads, extra limbs, new weapons, redesigned armor, text, watermark, logo, UI frame, border, collage or multiple panels. Return one finished portrait.`;
    return { id, name: pet.name, element, rarity: pet.rarity, references, referenceSha256: references.map((file) => digest(readFileSync(relativePublic(file)))), scene, prompt, output: `pet-portraits/shinobi-v1/${id}.webp`, status: 'queued' };
}

function readManifest() { return JSON.parse(readFileSync(manifestPath, 'utf8')); }
function pendingEntries(manifest) {
    const pilot = ['mythic-0', 'mythic-4', 'mythic-7', 'rare-39', 'standard-38'];
    const rank = (entry) => entry.id.startsWith('starter-') ? -1 : pilot.includes(entry.id) ? pilot.indexOf(entry.id) : 100;
    return manifest.entries.filter((entry) => entry.status === 'queued').sort((a, b) => rank(a) - rank(b));
}
function atomicWrite(path, contents) {
    for (let attempt = 0; ; attempt++) {
        try {
            writeFileSync(`${path}.next`, contents);
            renameSync(`${path}.next`, path);
            return;
        } catch (error) {
            if (attempt >= 7) throw error;
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 80);
        }
    }
}
function saveManifest(manifest) {
    atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const reviewed = manifest.entries.filter((entry) => entry.status === 'reviewed' && (!manifest.symbolPolicy?.required
        || (entry.symbolReview?.passed && entry.symbolReview.sourceSha256 === entry.sourceSha256 && entry.symbolReview.outputSha256 === entry.outputSha256)));
    const urls = Object.fromEntries(reviewed.map((entry) => [entry.id, `/${entry.output}?v=${entry.outputSha256.slice(0, 12)}`]));
    atomicWrite(join(root, 'shinobij.client/src/lib/pet-portrait-assets.generated.ts'), `// Generated by scripts/pet-portrait-production.mjs. Portrait artwork only.\nexport const PET_SCENIC_PORTRAITS: Readonly<Record<string, string>> = ${JSON.stringify(urls, null, 4)};\n`);
}

const [command = 'status', ...args] = process.argv.slice(2);
if (command === 'init') {
    if (existsSync(manifestPath)) throw new Error('Production manifest exists; resume it instead of replacing progress.');
    mkdirSync(productionRoot, { recursive: true });
    saveManifest({ version: 1, provider: 'built-in image_gen', scope: 'All 161 companions, including five starters and ten evolution forms; portrait artwork only', protectedAssets: ['pet-models/**', 'pet-poses/**', 'pet-rally/**', 'pet-evos/**', 'pet-portraits/pebble-tortoise-chibi-v2-cutout.webp'], entries: inventory().map(spec) });
} else if (command === 'status') {
    const manifest = readManifest();
    const counts = manifest.entries.reduce((all, entry) => ({ ...all, [entry.status]: (all[entry.status] || 0) + 1 }), {});
    console.log(JSON.stringify({ total: manifest.entries.length, counts, next: pendingEntries(manifest).slice(0, 6).map(({ id, name, references }) => ({ id, name, references })) }, null, 2));
} else if (command === 'next') {
    const count = Math.max(1, Math.min(8, Number(args[0]) || 4));
    console.log(JSON.stringify(pendingEntries(readManifest()).slice(0, count)));
} else if (command === 'record-prompts') {
    const prompts = JSON.parse(args[0] === '--json' ? args[1] : readFileSync(resolve(args[0]), 'utf8'));
    const manifest = readManifest();
    for (const [id, prompt] of Object.entries(prompts)) {
        const entry = manifest.entries.find((item) => item.id === id);
        if (!entry || typeof prompt !== 'string' || !prompt.trim()) throw new Error(`Invalid prompt for ${id}`);
        entry.prompt = prompt;
    }
    saveManifest(manifest);
} else if (command === 'record-reviews') {
    const reviews = JSON.parse(args[0] === '--json' ? args[1] : readFileSync(resolve(args[0]), 'utf8'));
    if (!Array.isArray(reviews)) throw new Error('Expected an array of { id, notes } visual reviews.');
    const manifest = readManifest();
    for (const { id, notes } of reviews) {
        const entry = manifest.entries.find((item) => item.id === id);
        if (!entry || !['candidate', 'reviewed'].includes(entry.status) || typeof notes !== 'string' || notes.trim().length < 40) throw new Error(`Missing staged output or specific visual review for ${id}`);
        if (digest(readFileSync(join(productionRoot, entry.master))) !== entry.sourceSha256 || digest(readFileSync(relativePublic(entry.output))) !== entry.outputSha256) throw new Error(`Review bytes do not match the staged image: ${id}`);
        entry.qualityReview = { passed: true, scope: 'Full-resolution artwork and identity-reference comparison', sourceSha256: entry.sourceSha256, outputSha256: entry.outputSha256, notes: notes.trim(), reviewedAt: new Date().toISOString() };
        entry.review = notes.trim();
        entry.status = 'reviewed';
    }
    saveManifest(manifest);
    console.log(JSON.stringify({ visualReviewsRecorded: reviews.length }));
} else if (command === 'record-symbol-reviews') {
    const reviews = JSON.parse(args[0] === '--json' ? args[1] : readFileSync(resolve(args[0]), 'utf8'));
    if (!Array.isArray(reviews)) throw new Error('Expected an array of { id, notes } visual symbol reviews.');
    const manifest = readManifest();
    for (const { id, notes } of reviews) {
        const entry = manifest.entries.find((item) => item.id === id);
        if (!entry || entry.status !== 'reviewed' || typeof notes !== 'string' || notes.trim().length < 40) throw new Error(`Missing reviewed artwork or specific symbol inspection for ${id}`);
        if (digest(readFileSync(join(productionRoot, entry.master))) !== entry.sourceSha256 || digest(readFileSync(relativePublic(entry.output))) !== entry.outputSha256) throw new Error(`Symbol review bytes do not match the image: ${id}`);
        entry.symbolReview = { passed: true, sourceSha256: entry.sourceSha256, outputSha256: entry.outputSha256, notes: notes.trim(), reviewedAt: new Date().toISOString() };
    }
    saveManifest(manifest);
    console.log(JSON.stringify({ symbolReviewsRecorded: reviews.length }));
} else if (command === 'revise') {
    const [id, correction] = args;
    const manifest = readManifest();
    const entry = manifest.entries.find((item) => item.id === id);
    if (!entry || !correction) throw new Error('Usage: revise <id> <specific correction>');
    if (entry.sourceSha256) entry.revisionHistory = [...(entry.revisionHistory || []), { supersededSourceSha256: entry.sourceSha256, supersededOutputSha256: entry.outputSha256, correction }];
    delete entry.qualityReview;
    delete entry.symbolReview;
    entry.status = 'queued';
    entry.revisionNotes = [...(entry.revisionNotes || []), correction];
    entry.prompt += ` Mandatory identity correction: ${correction}`;
    saveManifest(manifest);
} else if (command === 'identity-notes') {
    const manifest = readManifest();
    const models = JSON.parse(readFileSync(relativePublic('pet-models/roster-manifest.json'), 'utf8')).entries;
    for (const entry of manifest.entries) {
        if (entry.status !== 'queued' || args.includes(entry.id) || entry.modelIdentity || !models[entry.id]) continue;
        const model = models[entry.id];
        entry.modelIdentity = model.visualReview?.reason?.split(/(?<=[.!?])\s+/)[0] || '';
        entry.modelProfile = model.profile;
        entry.prompt += ` Approved current production identity: ${entry.modelIdentity} Body profile: ${entry.modelProfile}. The approved model identity takes priority over obsolete accessories or anatomy in Image 1. Do not invent new physical features.`;
    }
    saveManifest(manifest);
} else if (command === 'reference-repairs') {
    const manifest = readManifest();
    for (const entry of manifest.entries) {
        const showcaseAtlas = `pet-models/warfront-impostors/showdown-v2/${entry.id}.webp`;
        if (entry.status === 'queued' && !entry.id.startsWith('starter-') && existsSync(relativePublic(showcaseAtlas))) {
            entry.references[1] = showcaseAtlas;
            entry.referenceSha256[1] = digest(readFileSync(relativePublic(showcaseAtlas)));
        }
        const reviewed = reviewedReferencePoses[entry.id];
        if (!reviewed || entry.status !== 'queued') continue;
        entry.references[0] = `pet-poses/${reviewed}`;
        entry.referenceSha256[0] = digest(readFileSync(relativePublic(entry.references[0])));
    }
    saveManifest(manifest);
} else if (command === 'anatomy-notes') {
    const manifest = readManifest();
    const previous = ' Avian anatomy lock: exactly two standing legs and two feathered bird wings, which may remain folded beside the body. Do not add separate humanoid arms, hands, or additional taloned limbs. Preserve only equipment actually visible on the current production model.';
    const current = " Avian anatomy lock: use exactly two hind legs and the model's existing two wing/forelimbs. Preserve anthropomorphic wing-hands only if present in Image 2. Do not add a separate extra pair of arms, wings, hands or taloned limbs. Equipment and limb forms must follow the current production model.";
    for (const entry of manifest.entries) {
        if (entry.status !== 'queued' || args.includes(entry.id) || entry.modelProfile !== 'avian') continue;
        entry.prompt = entry.prompt.replace(previous, '');
        if (entry.prompt.includes(current)) continue;
        entry.anatomyNotesApplied = true;
        entry.prompt += current;
    }
    saveManifest(manifest);
} else if (command === 'accept') {
    const [id, sourcePath, sharpModulePath] = args;
    const manifest = readManifest();
    const entry = manifest.entries.find((item) => item.id === id);
    if (!entry || !sourcePath) throw new Error('Usage: accept <id> <generated-source-path> [sharp-module-path]');
    const sharp = sharpModulePath ? (await import(pathToFileURL(resolve(sharpModulePath)).href)).default : (await import('sharp')).default;
    const sourceBytes = readFileSync(sourcePath);
    const masterPath = join(productionRoot, 'masters', `${id}.png`);
    mkdirSync(dirname(masterPath), { recursive: true });
    copyFileSync(sourcePath, masterPath);
    const outputPath = relativePublic(entry.output);
    mkdirSync(dirname(outputPath), { recursive: true });
    // Delivery encoding only; generation/editing is performed by image_gen.
    await sharp(sourceBytes).resize(640, 640, { fit: 'cover' }).webp({ quality: 83, effort: 6 }).toFile(outputPath);
    const metadata = await sharp(outputPath).metadata();
    if (metadata.width !== 640 || metadata.height !== 640 || metadata.format !== 'webp' || metadata.hasAlpha) throw new Error(`Invalid opaque delivery portrait: ${id}`);
    entry.status = 'candidate';
    delete entry.qualityReview;
    delete entry.symbolReview;
    entry.sourceSha256 = digest(sourceBytes);
    entry.master = `masters/${id}.png`;
    entry.outputSha256 = digest(readFileSync(outputPath));
    entry.bytes = readFileSync(outputPath).length;
    entry.review = 'Awaiting a specific full-resolution visual review before publication.';
    saveManifest(manifest);
    console.log(JSON.stringify({ id, output: entry.output, bytes: entry.bytes }));
} else if (command === 'audit') {
    const manifest = readManifest();
    const ids = inventory().map((pet) => pet.id);
    if (manifest.entries.length !== ids.length || ids.some((id) => !manifest.entries.find((entry) => entry.id === id))) throw new Error('Portrait manifest does not cover the exact current roster.');
    const reviewed = manifest.entries.filter((entry) => entry.status === 'reviewed');
    const pending = manifest.entries.filter((entry) => entry.status !== 'reviewed');
    const sharp = (await import('sharp')).default;
    const hashes = new Set();
    for (const entry of manifest.entries) {
        entry.references.forEach((file, index) => {
            if (digest(readFileSync(relativePublic(file))) !== entry.referenceSha256[index]) throw new Error(`Protected identity reference changed: ${file}`);
        });
        if (entry.status !== 'reviewed') continue;
        if (!entry.prompt || !entry.review || !entry.master) throw new Error(`Missing production provenance: ${entry.id}`);
        if (!entry.qualityReview?.passed || entry.qualityReview.sourceSha256 !== entry.sourceSha256 || entry.qualityReview.outputSha256 !== entry.outputSha256) throw new Error(`Missing or stale full-resolution visual review: ${entry.id}`);
        if (manifest.symbolPolicy?.required && (!entry.symbolReview?.passed || entry.symbolReview.sourceSha256 !== entry.sourceSha256 || entry.symbolReview.outputSha256 !== entry.outputSha256)) throw new Error(`Missing or stale visual symbol review: ${entry.id}`);
        const bytes = readFileSync(relativePublic(entry.output));
        if (digest(bytes) !== entry.outputSha256 || bytes.length !== entry.bytes) throw new Error(`Delivery bytes changed: ${entry.id}`);
        if (digest(readFileSync(join(productionRoot, entry.master))) !== entry.sourceSha256) throw new Error(`Selected master changed: ${entry.id}`);
        if (hashes.has(entry.outputSha256)) throw new Error(`Duplicate portrait output: ${entry.id}`);
        hashes.add(entry.outputSha256);
        const metadata = await sharp(bytes).metadata();
        if (metadata.width !== 640 || metadata.height !== 640 || metadata.format !== 'webp' || metadata.hasAlpha) throw new Error(`Invalid full-background portrait: ${entry.id}`);
    }
    const outputDir = relativePublic('pet-portraits/shinobi-v1');
    const expected = new Set(reviewed.map((entry) => `${entry.id}.webp`));
    const stray = existsSync(outputDir) ? readdirSync(outputDir).filter((file) => !expected.has(file)) : [];
    if (stray.length) throw new Error(`Unreviewed or obsolete delivery files remain: ${stray.join(', ')}`);
    console.log(JSON.stringify({ identities: ids.length, reviewed: reviewed.length, pending: pending.length, deliveryBytes: reviewed.reduce((sum, entry) => sum + entry.bytes, 0), referencesUnchanged: true, duplicateOrObsoleteDeliveries: 0 }, null, 2));
    if (pending.length && !args.includes('--partial')) throw new Error(`Still missing ${pending.length} requested portraits.`);
} else {
    throw new Error(`Unknown command ${command}`);
}
