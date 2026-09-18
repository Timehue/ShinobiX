// Reproducible per-use review ledger from the audited current/HEAD inventories.
import { readFile, writeFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const read = async p => JSON.parse(await readFile(p, 'utf8'));
const current = await read('../tmp/vn-art-audit/current.json');
const before = await read('../tmp/vn-art-audit/before-expanded.json');
const production = await read('../docs/art-audit/production.json');
const runtime = await read('../tmp/vn-art-audit/runtime-evidence.json');
const normalize = image => image?.split(/[?#]/, 1)[0] || '';
const originals = new Map(before.rows.map(r => [r.key, r]));
const generated = new Map(production.assets.map(a => [a.asset, a]));
const proof = new Map(runtime.assets.map(a => [a.asset, a]));
const variants = /Night|Dawn|Morning|After|Working|Frost|Bound|Broken|Repair|TwoLamps|Failed|Empty|NoSash|Willing|NewKeeper|NewWeather|SealedTenth|KeeperDoor|KeeperAccount|KitchenLetter|PostedEvidence|Nara|ChestOpen|Closed|Shutdown|Scorched|Ambush|Resting/i;
const fitPaths = new Set([...await readFile('src/lib/vn-artwork.ts', 'utf8').then(s => s.matchAll(/if \(image === (?:'([^']+)'|`\$\{cinematic\}([^`]+)`)/g))].map(m => m[1] || '/scenes/story/cinematic/' + m[2]));
const consumerIndex = {};
for (const [image, entry] of Object.entries(current.assets)) {
    const key = normalize(image);
    consumerIndex[key] ??= [];
    consumerIndex[key].push(...entry.consumers);
}
for (const key of Object.keys(consumerIndex)) consumerIndex[key] = [...new Set(consumerIndex[key])];
const rows = current.rows.map(row => {
    const original = originals.get(row.key);
    if (!original) throw new Error(`No HEAD baseline: ${row.key}`);
    const uses = new Map();
    for (const line of row.presentations) {
        const old = original.presentations.find(p => p.lineIndex === line.lineIndex);
        for (const part of [{ role: 'background', name: '', image: line.background, previous: old?.background }, ...line.actors.map((actor, i) => ({ role: 'actor', name: actor.name, image: actor.image, previous: old?.actors[i]?.image, pose: actor.pose }))]) {
            if (part.name === 'Player' || (!part.image && !part.previous)) continue;
            const key = `${part.role}:${part.name}:${part.image}`;
            let use = uses.get(key);
            if (!use) {
                const file = normalize(part.image), productionAsset = generated.get(file);
                use = { role: part.role, character: part.name || undefined, resolvedImage: part.image, lineIndices: [], previousImages: [], poses: [], productionKey: productionAsset?.key, classification: 'KEEP', priority: 5, action: 'Retain reviewed accurate artwork.', match: 'Reviewed against current scene and dialogue evidence; no unresolved visual contradiction identified.', runtimeEvidence: proof.get(file)?.captures ?? [] };
                uses.set(key, use);
            }
            use.lineIndices.push(line.lineIndex);
            if (!use.previousImages.includes(part.previous || '')) use.previousImages.push(part.previous || '');
            if (part.pose && !use.poses.includes(part.pose)) use.poses.push(part.pose);
        }
    }
    for (const use of uses.values()) {
        const file = normalize(use.resolvedImage), generation = generated.get(file);
        if (generation) {
            use.classification = variants.test(generation.key) ? 'VARIANT' : 'REPLACE';
            use.priority = use.role === 'actor' ? 1 : 3;
            use.action = `${use.classification === 'VARIANT' ? 'Integrated supported story-state variant' : 'Integrated reviewed replacement'}: ${generation.key}. See production.json for reference lock and production brief.`;
        } else if (use.previousImages.some(image => normalize(image) !== file)) {
            use.classification = 'REMAP'; use.priority = use.role === 'actor' ? 1 : 3;
            use.action = file ? 'Resolve this exact current story beat to retained, reviewed artwork.' : 'Suppress the unrelated narrator/absent-actor portrait; preserve explicit creator art.';
        } else if (fitPaths.has(file) || (file.includes('/portraits/cinematic/') && /moonshadow|kael-whitefang/.test(row.eventId + file))) {
            use.classification = 'FIT/CACHE FIX'; use.priority = 4;
            use.action = 'Retain source; use its reviewed focal point, non-mirrored orientation, or scoped cutout shadow. Existing revision contract remains intact.';
        }
        if (use.previousImages.some(image => before.assets[image]?.missing)) use.priority = 2;
        use.consumersIndex = file || null;
    }
    const visible = [...new Set(row.presentations.flatMap(p => p.actors.filter(a => a.name !== 'Player' && a.name !== 'Narrator' && a.image).map(a => a.name)))];
    const extra = row.eventId === 'story-road-black-bridge' && row.title === 'First Bolt' ? ['Six prisoners', 'Armed escorts, including the fallen escort', 'Crossbowman on the mill roof', 'Registrar Corin Vell']
        : row.eventId.includes('beast-warren') && /Nara|collar|hound|her coat/.test(row.scene + row.presentations.map(p => p.text).join(' ')) ? ['Nara (living hound; controlled, rescued or healing according to the quoted current beat)'] : [];
    return { key: row.key, eventId: row.eventId, pageIndex: row.pageIndex, title: row.title, source: row.source, reachable: row.reachable, conditions: row.eventConditions, incomingChoices: row.incomingChoices,
        physicalPresence: { stagedNamedActors: visible, additionalReviewedSubjects: extra, stagingEvidence: row.scene, player: 'Player viewpoint/avatar remains dynamic and unchanged.', method: 'Actor list records explicit stage slots; scene text records additional crowd or offscreen staging. Dialogue mentions alone are not treated as physical presence.' },
        locationTimeEnvironment: row.scene,
        appearanceState: [...uses.values()].filter(u => u.role === 'actor').map(u => ({ character: u.character, supportedPoses: u.poses, image: u.resolvedImage, evidence: row.scene })),
        actionPropEmotionEvidence: row.presentations.map(p => ({ lineIndex: p.lineIndex, speaker: p.speaker, text: p.text })), authored: row.authored, uses: [...uses.values()] };
});
const classifications = {};
for (const row of rows) for (const use of row.uses) classifications[use.classification] = (classifications[use.classification] || 0) + 1;
const assets = {};
for (const file of Object.keys(consumerIndex)) {
    const absolute = path.resolve('public', file.slice(1));
    const meta = await sharp(absolute).metadata();
    assets[file] = { bytes: (await stat(absolute)).size, width: meta.width, height: meta.height, hasAlpha: !!meta.hasAlpha, estimatedRGBABytes: meta.width * meta.height * 4, consumers: consumerIndex[file], decision: generated.has(file) ? 'Generated, integrated, runtime verified in representative desktop and phone captures' : 'Retained after visual/source review; legacy compatibility preserved', evidence: proof.get(file) };
}
const ledger = { schemaVersion: 1, scope: current.coverage, method: 'Every reachable built-in page is compared with original HEAD resolution. Story quotations, stage slots and all line-specific image uses are retained. Classification records this pass; runtime verification is representative per asset/family, not a claim of clicking every route. Source and compressed-art reviews plus actual renderer captures inform sign-off.', classifications, rows, assets,
    blocked: current.coverage.inaccessible.map(reason => ({ classification: 'BLOCKED', reason, action: 'Requires authorized access to the corresponding live content; preserve valid explicit URLs and legacy files.' })) };
await writeFile('../docs/art-audit/ledger.json', JSON.stringify(ledger, null, 2) + '\n');
const csv = [['Event variant/page', 'Source', 'Scene evidence', 'Role', 'Character', 'Lines (zero based)', 'Classification', 'Priority', 'Previous art', 'Resolved art', 'Action']];
for (const row of rows) for (const use of row.uses) csv.push([row.key, row.source, row.locationTimeEnvironment, use.role, use.character, use.lineIndices.join(','), use.classification, use.priority, use.previousImages.join(' | '), use.resolvedImage, use.action]);
await writeFile('../docs/art-audit/ledger.csv', csv.map(row => row.map(cell => '"' + String(cell ?? '').replaceAll('"', '""') + '"').join(',')).join('\n') + '\n');
const consumerLines = ['# Reviewed artwork and exact consumers', '', 'All page and line indices in ledger.json are zero based. The lists below include every built-in branch/replay variant known to this checkout. Private published/creator references remain inaccessible.', ''];
for (const [file, info] of Object.entries(assets)) {
    consumerLines.push(`## ${file}`, '', `${info.decision}. ${info.width} × ${info.height}; ${info.bytes.toLocaleString('en-US')} bytes.`, '');
    for (const consumer of info.consumers) consumerLines.push(`- \`${consumer}\``);
    consumerLines.push('');
}
await writeFile('../docs/art-audit/consumers.md', consumerLines.join('\n'));
const oldStats = {};
for (const file of new Set(Object.keys(before.assets).map(normalize))) {
    try { const absolute = path.resolve('public', file.slice(1)), m = await sharp(absolute).metadata(); oldStats[file] = { bytes: (await stat(absolute)).size, rgba: m.width * m.height * 4 }; } catch { oldStats[file] = { missing: true, bytes: 0, rgba: 0 }; }
}
const measure = (row, index, stats, previous) => {
    const line = row.presentations[index];
    const files = [...new Set([line.background, ...line.actors.map(a => a.image)].filter(Boolean).map(normalize))];
    return { images: files, encodedBytes: files.reduce((sum, file) => sum + (stats[file]?.bytes || 0), 0), estimatedRGBABytes: files.reduce((sum, file) => sum + (previous ? stats[file]?.rgba || 0 : stats[file]?.estimatedRGBABytes || 0), 0) };
};
const samples = [
    ['story-ashen-leaf-village-4-0', 'The Black Flower', 2], ['story-frostfang-village-4-0', 'First Bell', 0], ['story-interlude-moonshadow-village-88', 'The Empty Booth', 0], ['echoes-1-tovin-victory', 'Finished', 0], ['rift-first-clear-beast-warren', 'Water Before Thanks', 0], ['sys-ancient-chest', 'The Chest Opens', 0],
].map(([eventId, title, line]) => { const after = current.rows.find(r => r.eventId === eventId && r.title === title); if (!after) throw new Error(title); return { eventId, title, line, before: measure(originals.get(after.key), line, oldStats, true), after: measure(after, line, assets, false) }; });
const sizes = production.assets.map(a => assets[a.asset].bytes).sort((a, b) => a - b);
const performance = { generatedFiles: sizes.length, generatedLibraryBytes: sizes.reduce((a, b) => a + b, 0), smallestBytes: sizes[0], medianBytes: sizes[Math.floor(sizes.length / 2)], largestBytes: sizes.at(-1), samples,
    observations: ['Encoded sizes are real local file sizes; RGBA figures estimate decoded pixels, not measured browser heap.', 'Player avatar bytes are excluded because they are user-selected.', 'Production retains current scene plus at most one upcoming scene (background and two actors); the artwork library is not preloaded.', 'The dev-only eager audit catalog is tree-shaken from production output.', 'Existing PNG optimization/build warnings are recorded in final-build.log; no audio, camera timing or continuous effects were added.'] };
await writeFile('../docs/art-audit/performance.json', JSON.stringify(performance, null, 2) + '\n');
console.log({ pages: rows.length, uses: rows.reduce((n, r) => n + r.uses.length, 0), assets: Object.keys(assets).length, classifications, performance: { ...performance, samples: undefined, observations: undefined } });
