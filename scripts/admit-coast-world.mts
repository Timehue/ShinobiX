/*
 * Admit the Unmapped Coast's geography into the game.
 *
 * The art agent delivers each region to output/coast/<region>/ (gitignored):
 * floor paintings, a layouts.json of walk masks and sites, and one shared
 * coast-roads.json of pins, roads and exits. This script is the only thing that
 * turns that delivery into game data. It checks the delivery, then writes
 * shared/coast-world.json, which IS committed and is what the server reads.
 *
 *   node --import tsx scripts/admit-coast-world.mts
 *
 * It admits geography only: masks, exits, sites and interiors. Paintings are
 * admitted separately, with their own byte allowance (scripts/verify-dist.mjs).
 * A region with no layouts yet keeps its pins and roads so no exit ever moves
 * when its floors arrive; its sectors are simply not open.
 *
 * shared/coast-world.test.ts re-runs every check below against the committed
 * file, so CI proves the data without needing the delivery folder.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coastWorldProblems, type CoastWorldData } from '../shared/coast-world-rules.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'output', 'coast');
const OUT = join(ROOT, 'shared', 'coast-world.json');

/** Region folders in region-number order. A missing folder is a region not painted yet. */
const REGIONS = [
    { number: 1, name: 'Saltstair Landing', folder: 'saltstair-landing' },
    { number: 2, name: 'Brackwater Fields', folder: 'brackwater-fields' },
    { number: 3, name: 'Briarwood Deep', folder: 'briarwood-deep' },
    { number: 4, name: 'Whitecrown Passes', folder: 'whitecrown-passes' },
    // The northern rim above the haunted basin. Owner ruling 2026-11-19: no
    // volcano; the last region is haunted forest, as the atlas already paints.
    { number: 5, name: 'Hushcrown Heights', folder: 'hushcrown-heights' },
] as const;

/**
 * The art pack labels terrain by how it looks. The game has five gameplay
 * biomes, and a biome sets weather, ambience, the combat backdrop and which
 * jutsu type gets the terrain bonus, so the coast reuses those five and adds
 * none. This is the mapping, a balance choice the owner approved on
 * 2026-11-19: tidal flats fight as neutral ground, the high passes as snow.
 */
const BIOME_OF_TERRAIN: Record<string, string> = { coastal: 'central', mountain: 'snow' };

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>;

/**
 * Every asset path in a layouts.json is written relative to the Saltstair
 * folder. This turns one into the path it has under public/coast-map/ once
 * scripts/admit-coast-art.mts has copied it: `<region>/<kind>/<file>`.
 */
const artRef = (value: string) => posix.normalize(posix.join('saltstair-landing', value));

const roads = readJson(join(SOURCE, 'saltstair-landing', 'coast-roads.json'));
const space = readJson(join(SOURCE, 'saltstair-landing', 'continuous-space.json'));

const layouts: CoastWorldData['layouts'] = {};
for (const region of REGIONS) {
    const file = join(SOURCE, region.folder, 'layouts.json');
    if (!existsSync(file)) continue;
    for (const layout of Object.values(readJson(file).layouts) as any[]) {
        const sites: CoastWorldData['layouts'][string]['sites'] = {};
        for (const site of Object.values(layout.sites ?? {}) as any[]) {
            const floors = site.interior
                ? (site.interior.floors ?? [site.interior]).map((floor: any) => ({
                    title: String(floor.title ?? site.interior.title ?? site.name),
                    ...(typeof floor.floor === 'string' && floor.floor ? { art: artRef(floor.floor) } : {}),
                    mask: floor.mask,
                    spawn: floor.spawn,
                    doors: floor.doors ?? [],
                    stations: (floor.stations ?? []).map((station: any) => ({
                        name: station.name,
                        approach: station.approach,
                        target: station.target,
                        detail: station.detail ?? '',
                        ...(station.locked ? { locked: station.locked } : {}),
                        ...(station.clue !== undefined ? { clue: station.clue } : {}),
                    })),
                    stairs: (floor.stairs ?? []).map((stair: any) => ({
                        label: stair.label, tile: stair.tile, to: stair.to, arrival: stair.arrival, target: stair.target,
                    })),
                }))
                : [];
            sites[site.id] = {
                id: site.id,
                name: site.name,
                role: site.role ?? '',
                verb: site.verb ?? '',
                description: site.description ?? '',
                approach: site.approach,
                returnTile: site.returnTile ?? site.approach,
                footprint: site.footprint,
                left: site.left, top: site.top, width: site.width,
                ...(typeof site.sprite === 'string' && site.sprite ? { sprite: artRef(site.sprite) } : {}),
                ...(typeof site.scene === 'string' && site.scene ? { scene: artRef(site.scene) } : {}),
                actions: site.actions ?? [],
                // The art pack's suggestion for which quest uses the site. A
                // hint for authors, never read by the game.
                proposedQuest: site.quest ?? '',
                floors,
            };
        }
        layouts[String(layout.sector)] = {
            name: layout.name,
            ...(layout.floor?.startsWith('floors/') ? { floor: posix.join(region.folder, layout.floor.replace(/-candidate\.webp$/, '.webp')) } : {}),
            biome: BIOME_OF_TERRAIN[layout.biome] ?? layout.biome,
            terrain: layout.biome,
            contestable: layout.contestable === true,
            mask: layout.mask,
            water: layout.hydrology?.waterTiles ?? [],
            sites,
        };
    }
}

const data: CoastWorldData = {
    version: String(space.version),
    atlas: { width: roads.width, height: roads.height },
    regions: REGIONS.map(region => region.name),
    points: roads.points.map((point: any) => ({ sector: point.sector, x: point.x, y: point.y, region: point.region })),
    roads: roads.roads.map((road: any) => [road.a, road.b] as [number, number]),
    exits: Object.fromEntries(Object.entries(roads.exits as Record<string, any[]>).map(([sector, exits]) => [sector, exits.map(exit => ({
        id: exit.id, sector: exit.sector, direction: exit.direction, tile: exit.tile,
        destinationSector: exit.destinationSector, destinationExitId: exit.destinationExitId,
        destinationTile: exit.destinationTile, lane: exit.lane,
    }))])),
    layouts,
    space: {
        chunks: space.chunks.map((chunk: any) => ({ sector: chunk.sector, x: chunk.x, y: chunk.y, size: chunk.size })),
        roads: space.roads.map((road: any) => ({ a: road.a, b: road.b, points: road.points, length: road.length })),
    },
};

const problems = coastWorldProblems(data);
if (problems.length) {
    console.error(`Refusing to admit the coast: ${problems.length} problem(s).`);
    for (const problem of problems.slice(0, 60)) console.error(`  - ${problem}`);
    process.exit(1);
}

writeFileSync(OUT, `${JSON.stringify(data)}\n`, 'utf8');
const open = Object.keys(layouts).length;
const siteCount = Object.values(layouts).reduce((sum, layout) => sum + Object.keys(layout.sites).length, 0);
console.log(`Admitted ${data.points.length} sectors (${open} open), ${data.roads.length} roads, ${siteCount} sites to ${OUT}`);
