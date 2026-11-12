/**
 * Admission for Cinderhold's composed floors (2026-11-08). The narrow sibling of
 * scripts/admit-sector-world.mjs for natively composed paintings: it validates the
 * candidate geometry and painted pixels BEFORE replacing anything, then writes
 * the floors, their hashes, the layouts and a provenance record.
 *
 *   node --import tsx scripts/admit-cinderhold-sectors.mts <candidate-dir>
 *
 * <candidate-dir> holds cinderhold-layouts.json (author-cinderhold-sectors.mts)
 * and s<artKey>-candidate.webp (compose-cinderhold-floors.py).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { validateSectorLayouts } from './validate-sector-layouts.mjs';
import { checkFloorAlignment } from './check-floor-alignment.mjs';

const dir = path.resolve(process.argv[2] ?? 'output/cinderhold');
const source = JSON.parse(await fs.readFile(path.join(dir, 'cinderhold-layouts.json'), 'utf8'));
const dataFile = 'shared/sector-floor-layout-data.json';
const data = JSON.parse(await fs.readFile(dataFile, 'utf8'));
const layouts = { ...data.layouts };
for (const [art, layout] of Object.entries(source.layouts)) layouts[art] = layout;
for (const [art, entry] of Object.entries(source.patched) as [string, { layout: unknown }][]) layouts[art] = entry.layout;

validateSectorLayouts(layouts);

// Painted-pixel checks run against a staging root holding the candidates in
// place, so the live public folder is untouched until everything passes.
const stage = path.join(dir, 'stage');
await fs.rm(stage, { recursive: true, force: true });
await fs.mkdir(path.join(stage, 'shinobij.client/public/sector-map'), { recursive: true });
for (const file of await fs.readdir('shinobij.client/public/sector-map')) {
    if (!file.endsWith('.webp')) continue; // thumbs/ is regenerated afterwards
    await fs.copyFile(path.join('shinobij.client/public/sector-map', file), path.join(stage, 'shinobij.client/public/sector-map', file));
}
const admitted: string[] = [...Object.keys(source.layouts), ...Object.keys(source.patched)];
for (const art of admitted) {
    const bytes = await fs.readFile(path.join(dir, `s${art}-candidate.webp`));
    const meta = await sharp(bytes).metadata();
    if (meta.width !== 1024 || meta.height !== 1024 || meta.format !== 'webp' || bytes.length > 250 * 1024) throw new Error('Invalid floor ' + art);
    await fs.copyFile(path.join(dir, `s${art}-candidate.webp`), path.join(stage, `shinobij.client/public/sector-map/s${art}.webp`));
}
const alignment = await checkFloorAlignment({ root: stage, out: path.join(dir, 'alignment'), render: true, layouts });
if (alignment.critical.length || alignment.interior.length || alignment.failedSeams.length) {
    throw new Error('Admission refused: ' + JSON.stringify({ critical: alignment.critical, interior: alignment.interior.map(r => ({ sector: r.sector, issues: r.issues })), seams: alignment.failedSeams.map(s => [s.a, s.b, s.difference]) }));
}

const floors = { ...data.floors };
const provenance: object[] = [];
for (const art of admitted) {
    const target = `shinobij.client/public/sector-map/s${art}.webp`;
    await fs.copyFile(path.join(dir, `s${art}-candidate.webp`), target);
    const bytes = await fs.readFile(target);
    floors[art] = createHash('sha256').update(bytes).digest('hex');
    const layout = layouts[art];
    provenance.push({ sector: layout.sector, artKey: Number(art), name: layout.name, sha256: floors[art], bytes: bytes.length,
        layoutSha256: createHash('sha256').update(JSON.stringify(layout)).digest('hex'),
        productionTool: 'owner-authorized-native-composition', recipe: 'scripts/compose-cinderhold-floors.py',
        sources: Number(art) in source.patched ? [`s${art}.webp (accepted floor, new climb painted)`]
            : layout.village ? ['s7.webp', 's2.webp', 's52.webp', 's66.webp', 'art-source/cinderhold-village/compound.webp (walled village, Figma generate_image, owner approved 2026-11-09)']
            : ['s7.webp', 's2.webp', 's52.webp', 's66.webp', 's99.webp (stronghold compound)'],
        status: 'composed-and-checked' });
}
const ordered = Object.fromEntries(Object.keys(layouts).sort((a, b) => Number(a) - Number(b)).map(k => [k, layouts[k]]));
const orderedFloors = Object.fromEntries(Object.keys(floors).sort((a, b) => Number(a) - Number(b)).map(k => [k, floors[k]]));
await fs.writeFile(dataFile, JSON.stringify({ layouts: ordered, floors: orderedFloors, landmarks: data.landmarks }, null, 2) + '\n');
const provFile = 'docs/art/connected-sector-world-provenance.json';
const prov = JSON.parse(await fs.readFile(provFile, 'utf8'));
// A re-admitted floor keeps the record it replaces (its prompt, references and
// visual review) under `previous`, so the review chain is never lost.
const prior = new Map(prov.floors.map((f: { artKey: number }) => [String(f.artKey), f]));
const carried = provenance.map((record) => {
    const old = prior.get(String((record as { artKey: number }).artKey)) as { sha256?: string; previous?: unknown } | undefined;
    if (!old || old.sha256 === (record as { sha256: string }).sha256) return old?.previous ? { ...record, previous: old.previous } : record;
    return { ...record, previous: old.previous && !('semanticReview' in old) ? old.previous : old };
});
prov.floors = [...prov.floors.filter((f: { artKey: number }) => !admitted.includes(String(f.artKey))), ...carried];
await fs.writeFile(provFile, JSON.stringify(prov, null, 2) + '\n');
console.log(`Admitted ${admitted.length} composed floors: ${admitted.join(', ')}`);
