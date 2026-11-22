import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import art from './coast-art.json';
import settlementArt from './coast-settlement-art.json';
import { COAST_WORLD, OPEN_COAST_SECTOR_IDS } from './coast-world.js';

/*
 * The coast's admitted art against the files on disk, the geography that points
 * at it, and the byte allowances that pay for it. A painting changed without
 * re-running scripts/admit-coast-art.mts, a stray file in the folder, a site
 * naming art that was never admitted, or an allowance that no longer matches
 * what shipped all fail here.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ART_DIR = join(ROOT, 'shinobij.client', 'public', 'coast-map');
type Entry = { bytes: number; sha256: string };
const manifest = art as { floorBytes: number; floors: Record<string, Entry>; siteBytes: number; files: Record<string, Entry> };

/** Every file under the art folder, as forward-slash paths relative to it. */
function filesOnDisk(dir = ART_DIR): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
        ? filesOnDisk(join(dir, entry.name))
        : [relative(ART_DIR, join(dir, entry.name)).replaceAll('\\', '/')]);
}

function assertMatches(path: string, entry: Entry): number {
    const bytes = readFileSync(join(ART_DIR, ...path.split('/')));
    assert.equal(bytes.length, entry.bytes, `${path} changed size since it was admitted`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, `${path} changed since it was admitted`);
    assert.equal(bytes.subarray(0, 4).toString('latin1') + bytes.subarray(8, 12).toString('latin1'), 'RIFFWEBP', `${path} is not a WebP`);
    return bytes.length;
}

test('every open coast sector has exactly one admitted floor painting', () => {
    assert.deepEqual(Object.keys(manifest.floors).map(Number).sort((a, b) => a - b), [...OPEN_COAST_SECTOR_IDS]);
});

test('the art folder holds exactly the admitted files, and nothing else', () => {
    const expected = [...OPEN_COAST_SECTOR_IDS.map(sector => `s${sector}.webp`), ...Object.keys(manifest.files), ...Object.keys(settlementArt)].sort();
    assert.deepEqual(filesOnDisk().sort(), expected);
});

test('each file on disk is the one that was admitted, within its size limit', () => {
    let floorTotal = 0;
    for (const [sector, floor] of Object.entries(manifest.floors)) {
        const size = assertMatches(`s${sector}.webp`, floor);
        assert.ok(size <= 250_000, `s${sector}.webp is over 250,000 bytes`);
        floorTotal += size;
    }
    assert.equal(floorTotal, manifest.floorBytes);

    const limits: Record<string, number> = { floors: 250_000, interiors: 250_000, landmarks: 128_000, scenes: 128_000, markers: 128_000, landing: 128_000, atlas: 600_000, boats: 128_000 };
    let siteTotal = 0;
    for (const [path, entry] of Object.entries(manifest.files)) {
        const kind = path.split('/').at(-2) ?? '';
        assert.ok(kind in limits, `${path} is in a folder with no size limit`);
        const size = assertMatches(path, entry);
        assert.ok(size <= limits[kind], `${path} is over ${limits[kind]} bytes`);
        siteTotal += size;
    }
    assert.equal(siteTotal, manifest.siteBytes);
    for (const [path, entry] of Object.entries(settlementArt)) {
        const ceiling = path.startsWith('town/') ? 200_000 : path.includes('/scenes/') ? 400_000 : 128_000;
        assert.ok(assertMatches(path, entry) <= ceiling, path + ' exceeds its painting limit');
    }
});

test('every painting a coast site names was admitted', () => {
    let named = 0;
    for (const [sector, layout] of Object.entries(COAST_WORLD.layouts)) {
        if (layout.floor) assert.ok(manifest.files[layout.floor], `sector ${sector} names an unadmitted revised floor`);
        for (const site of Object.values(layout.sites)) {
            for (const ref of [site.sprite, site.scene, ...site.floors.map(floor => floor.art)]) {
                if (!ref) continue;
                named += 1;
                assert.ok(Object.hasOwn(manifest.files, ref), `sector ${sector} site ${site.id} names ${ref}, which was never admitted`);
            }
            for (const floor of site.floors) assert.ok(floor.art, `sector ${sector} site ${site.id}: an interior floor has no painting`);
            assert.ok(site.sprite && site.scene, `sector ${sector} site ${site.id} needs a landmark and an entry scene`);
        }
    }
    assert.ok(named > 100, 'the coast names its art');
    assert.ok(Object.hasOwn(manifest.files, 'atlas/hushstone-basin-v2.webp'), 'the world map is admitted');
    assert.deepEqual(Object.keys(manifest.files).filter(path => path.startsWith('boats/')).sort(), [
        'boats/shard-crossing-v1.webp', 'boats/shuttered-boat-coast-v1.webp', 'boats/shuttered-boat-home-v1.webp',
    ], 'both boats and the shard-lit crossing are admitted');
});

test('the byte allowances are exactly what was admitted', () => {
    const source = readFileSync(join(ROOT, 'scripts', 'verify-dist.mjs'), 'utf8');
    const town = Object.entries(settlementArt).filter(([ref]) => ref.startsWith('town/'));
    assert.deepEqual(town.map(([ref]) => ref), ['town/tier-1.webp', 'town/tier-2.webp', 'town/tier-3.webp']);
    const townBytes = town.reduce((sum, [, entry]) => sum + entry.bytes, 0);
    const streetBytes = Object.values(settlementArt).reduce((sum, entry) => sum + entry.bytes, 0) - townBytes;
    const sector = COAST_WORLD.layouts['105'];
    const houses = sector.sites['saltstair-houses-105'];
    const settlement = [sector.floor!, houses.sprite!, houses.scene!, houses.floors[0].art!]
        .reduce((sum, ref) => sum + manifest.files[ref].bytes, 0);
    for (const [name, total] of [['maxCoastFloorArtBytes', manifest.floorBytes], ['maxCoastSiteArtBytes', manifest.siteBytes - settlement], ['maxCoastSettlementArtBytes', settlement], ['maxCoastTownArtBytes', townBytes], ['maxCoastStreetAndHallsArtBytes', streetBytes]] as const) {
        const declared = new RegExp(`const ${name} = ([\\d_]+(?: \\+ [\\d_]+)*);`).exec(source);
        assert.ok(declared, `scripts/verify-dist.mjs declares ${name}`);
        assert.equal(declared[1].split(' + ').reduce((sum, term) => sum + Number(term.replaceAll('_', '')), 0), total,
            `${name} must equal the admitted bytes: re-run scripts/admit-coast-art.mts and get the owner to approve the new figure`);
        assert.match(source, new RegExp(`maxOtherClientBytes = [^;]*${name}`), `${name} is counted in the ceiling`);
    }
});
