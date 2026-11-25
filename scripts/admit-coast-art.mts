/*
 * Admit the Unmapped Coast's paintings into the game.
 *
 * Geography is admitted by scripts/admit-coast-world.mts. This script brings in
 * the art that geography points at, from the art delivery in output/coast/
 * (gitignored) to shinobij.client/public/coast-map/, and records every file's
 * size and hash in shared/coast-art.json, which is committed.
 *
 *   node --import tsx scripts/admit-coast-art.mts
 *
 * What it admits, and the limit each kind must meet:
 *   floors      s<id>.webp                       1024 x 1024, at most 250,000 B
 *   interiors   <region>/interiors/<file>        1024 x 1024, at most 250,000 B
 *   landmarks   <region>/landmarks/<file>         512 x 512,  at most 128,000 B
 *   scenes      <region>/scenes/<file>            800 x 450,  at most 128,000 B
 *   markers     markers/<file>                    256 x 256,  at most 128,000 B
 *   atlas       atlas/hushstone-basin-v2.webp    1672 x 941,  at most 600,000 B
 *   boats       boats/<file>                                  at most 128,000 B
 *
 * Only art a coast site actually names is admitted, so a stray file in the
 * delivery never ships. Coast art lives in its own folder, not
 * public/sector-map/: the home map's manifest and thumbnail tests list that
 * folder file by file, and the coast is not part of the home map.
 *
 * The owner approved a byte allowance for the floors and for the rest of this
 * art on 2026-11-19 (scripts/verify-dist.mjs: maxCoastFloorArtBytes and
 * maxCoastSiteArtBytes). shared/coast-art.test.ts holds both to the totals this
 * script writes, so new art needs a re-run and a newly approved figure.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { OPEN_COAST_SECTOR_IDS } from '../shared/coast-world.ts';
import { coastRegionOf } from '../shared/world-maps.ts';
import settlementArt from '../shared/coast-settlement-art.json' with { type: 'json' };
import trailArt from '../shared/coast-trail-art.json' with { type: 'json' };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'output', 'coast');
const PUBLIC_DIR = join(ROOT, 'shinobij.client', 'public', 'coast-map');
const MANIFEST = join(ROOT, 'shared', 'coast-art.json');

const REGION_FOLDERS = ['saltstair-landing', 'brackwater-fields', 'briarwood-deep', 'whitecrown-passes', 'hushcrown-heights'];
/** The folder every asset path in a layouts.json is written relative to. */
const LAYOUT_BASE = 'saltstair-landing';

type Limit = { width?: number; height?: number; maxBytes: number };
const FLOOR: Limit = { width: 1024, height: 1024, maxBytes: 250_000 };
const LIMITS: Record<string, Limit> = {
    interiors: { width: 1024, height: 1024, maxBytes: 250_000 },
    landmarks: { width: 512, height: 512, maxBytes: 128_000 },
    scenes: { width: 800, height: 450, maxBytes: 128_000 },
    markers: { width: 256, height: 256, maxBytes: 128_000 },
    atlas: { width: 1672, height: 941, maxBytes: 600_000 },
    boats: { maxBytes: 128_000 },
};

const problems: string[] = [];
type Entry = { bytes: number; sha256: string };
const pending: { from: string; to: string }[] = [];

async function check(label: string, from: string, limit: Limit): Promise<Entry | null> {
    if (!existsSync(from)) { problems.push(`${label}: no file at ${from}`); return null; }
    const bytes = readFileSync(from);
    const meta = await sharp(bytes).metadata();
    if (meta.format !== 'webp') problems.push(`${label}: is ${meta.format}, not WebP`);
    if (limit.width !== undefined && (meta.width !== limit.width || meta.height !== limit.height)) {
        problems.push(`${label}: is ${meta.width} x ${meta.height}, not ${limit.width} x ${limit.height}`);
    }
    if (bytes.length > limit.maxBytes) problems.push(`${label}: is ${bytes.length} bytes, over ${limit.maxBytes}`);
    return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** `landmarks/x.webp` or `../region/landmarks/x.webp`, as a layout writes it, to `region/landmarks/x.webp`. */
export function coastArtRef(value: string): string {
    return posix.normalize(posix.join(LAYOUT_BASE, value));
}

// Floors: one per open sector.
const floors: Record<string, Entry> = {};
for (const sector of OPEN_COAST_SECTOR_IDS) {
    const from = join(SOURCE, REGION_FOLDERS[coastRegionOf(sector) - 1], `s${sector}-candidate.webp`);
    const entry = await check(`sector ${sector} floor`, from, FLOOR);
    if (!entry) continue;
    floors[String(sector)] = entry;
    pending.push({ from, to: join(PUBLIC_DIR, `s${sector}.webp`) });
}

// Site art: exactly what the delivered layouts name.
const files: Record<string, Entry> = {};
async function admit(ref: string, from: string, dimensions?: Limit): Promise<void> {
    if (files[ref]) return;
    const kind = ref.split('/').at(-2) ?? '';
    const limit = dimensions ?? LIMITS[kind];
    if (!limit) { problems.push(`${ref}: not an art folder this script admits`); return; }
    const entry = await check(ref, from, limit);
    if (!entry) return;
    files[ref] = entry;
    pending.push({ from, to: join(PUBLIC_DIR, ...ref.split('/')) });
}
for (const folder of REGION_FOLDERS) {
    const layoutFile = join(SOURCE, folder, 'layouts.json');
    if (!existsSync(layoutFile)) continue;
    const layouts = JSON.parse(readFileSync(layoutFile, 'utf8')).layouts as Record<string, any>;
    for (const layout of Object.values(layouts)) {
        if (layout.floor?.startsWith('floors/')) {
            const ref = posix.join(folder, layout.floor.replace(/-candidate\.webp$/, '.webp'));
            await admit(ref, join(SOURCE, folder, layout.floor), FLOOR);
        }
        for (const site of Object.values(layout.sites ?? {}) as any[]) {
            const named: string[] = [site.sprite, site.scene, ...(site.interior ? (site.interior.floors ?? [site.interior]).map((floor: any) => floor.floor) : [])];
            for (const value of named) {
                if (typeof value !== 'string' || !value) continue;
                const ref = coastArtRef(value);
                await admit(ref, join(SOURCE, ...ref.split('/')));
            }
        }
    }
}
// Map markers (the traveler portrait there is the game's own starter portrait and is not copied).
for (const name of readdirSync(join(SOURCE, LAYOUT_BASE, 'markers')).filter(file => file.endsWith('-v1.webp')).sort()) {
    await admit(`markers/${name}`, join(SOURCE, LAYOUT_BASE, 'markers', name));
}
await admit('atlas/hushstone-basin-v2.webp', join(SOURCE, 'atlas', 'hushstone-basin', 'hushstone-basin-v2.webp'));
for (const name of readdirSync(join(SOURCE, 'boats')).filter(file => file.endsWith('.webp')).sort()) {
    await admit(`boats/${name}`, join(SOURCE, 'boats', name));
}

const states: { kind: 'pin' | 'stand' | 'scene'; file: string }[] = JSON.parse(readFileSync(join(ROOT, 'shinobij.client/art-source/coast-states-v1/paintings.json'), 'utf8'));
for (const state of states) {
    const ref = state.file.slice('coast-map/'.length);
    if (!/^coast-map\/(markers|boats|landing)\/[a-z-]+-v1\.webp$/.test(state.file)) throw Error('Invalid coast state path');
    const dimensions = { pin: LIMITS.markers, stand: LIMITS.landmarks, scene: LIMITS.scenes }[state.kind];
    await admit(ref, join(SOURCE, 'coast-states-v1', state.file), dimensions);
}

if (problems.length) {
    console.error(`Refusing to admit the coast's art: ${problems.length} problem(s).`);
    for (const problem of problems.slice(0, 60)) console.error(`  - ${problem}`);
    process.exit(1);
}

// Settlement and trail paintings ship directly from public. Verify their receipts before pruning stale files.
const publicArt = { ...settlementArt, ...trailArt };
for (const [ref, entry] of Object.entries(publicArt)) {
    const bytes = readFileSync(join(PUBLIC_DIR, ref));
    if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw Error('Coast art changed: ' + ref);
}
const retained = new Set([...pending.map(file => file.to), ...Object.keys(publicArt).map(ref => join(PUBLIC_DIR, ref))]);
for (const file of readdirSync(PUBLIC_DIR, { recursive: true, withFileTypes: true })) {
    const candidate = join(file.parentPath, file.name);
    if (file.isFile() && !retained.has(candidate)) rmSync(candidate);
}
for (const { from, to } of pending) {
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
}
const total = (entries: Record<string, Entry>) => Object.values(entries).reduce((sum, entry) => sum + entry.bytes, 0);
const sortedFiles = Object.fromEntries(Object.keys(files).sort().map(ref => [ref, files[ref]]));
writeFileSync(MANIFEST, `${JSON.stringify({ floorBytes: total(floors), floors, siteBytes: total(files), files: sortedFiles }, null, 1)}\n`, 'utf8');
const byKind = new Map<string, number>();
for (const [ref, entry] of Object.entries(files)) byKind.set(ref.split('/').at(-2)!, (byKind.get(ref.split('/').at(-2)!) ?? 0) + entry.bytes);
console.log(`Admitted ${Object.keys(floors).length} floors (${total(floors)} B) and ${Object.keys(files).length} other files (${total(files)} B) to ${PUBLIC_DIR}`);
console.log([...byKind].map(([kind, bytes]) => `${kind} ${bytes}`).join(' | '));
