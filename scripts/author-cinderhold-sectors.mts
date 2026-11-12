/**
 * Authoring only (2026-11-08): the walk geometry for Cinderhold's home block
 * (sectors 67-74) and the two road stubs that join it to the Lavafront (58, 66).
 *
 * It follows scripts/author-sector-world.mjs exactly for terrain, routes and
 * obstacles, with two Cinderhold rules: every sector but the gate (67, where the
 * walled village stands) holds a garrison stronghold, and obstacles are ash-rock (`#`)
 * because the block has no water or forest. One reviewed mining seam is chosen
 * per sector on a rock cell beside open ground.
 *
 *   node --import tsx scripts/author-cinderhold-sectors.mts <out-dir>
 *
 * writes <out-dir>/cinderhold-layouts.json. scripts/compose-cinderhold-floors.py
 * paints from it; scripts/admit-cinderhold-sectors.mts admits both.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { SECTOR_PLACES, CINDERHOLD_SECTORS } from '../shared/sector-geo.ts';
import { sectorExits } from '../shared/sector-links.ts';
import { pathInMask, tileNeighbors } from '../shared/sector-walk-mask.ts';
import { SECTOR_FLOOR_LAYOUTS } from '../shared/sector-floor-layouts.ts';
import { sectorRoadRoutes } from './sector-road-routes.mjs';

type Site = { left: number; top: number; width: number; approach: number; footprint: [number, number, number] };
type Layout = {
    sector: number; artKey: number; region: string; biome: string; name: string; mask: string[];
    sites: Record<string, Site>; bakedLandmarks: true;
    exits: { tile: number; direction: string; destination: number }[];
    village?: { name: string; left: number; top: number; width: number; approach: number };
};

const out = path.resolve(process.argv[2] ?? 'output/cinderhold');
await fs.mkdir(out, { recursive: true });
const tile = (x: number, y: number) => y * 12 + x;
const layouts: Record<number, Layout> = {};
const mining: Record<number, { approach: number; target: number }> = {};

for (const place of SECTOR_PLACES.filter(p => CINDERHOLD_SECTORS.includes(p.id))) {
    const exits = sectorExits(place.id);
    const cells = Array.from({ length: 12 }, () => Array<string>(12).fill('.'));
    const get = (n: number) => cells[Math.floor(n / 12)]![n % 12]!;
    const put = (n: number, v: string) => { cells[Math.floor(n / 12)]![n % 12] = v; };
    const maskNow = () => cells.map(r => r.join(''));
    const boundary = Array.from({ length: 144 }, (_, n) => n).filter(n => n < 12 || n >= 132 || n % 12 === 0 || n % 12 === 11);
    const gateTiles = new Set(exits.flatMap(e => [e.tile, ...tileNeighbors(e.tile)]));
    const ring = [...Array.from({ length: 12 }, (_, x) => x), ...Array.from({ length: 11 }, (_, y) => (y + 1) * 12 + 11),
        ...Array.from({ length: 11 }, (_, x) => 142 - x), ...Array.from({ length: 10 }, (_, y) => 120 - y * 12)];
    const rotation = place.id * 7 % ring.length;
    const borderBlocks = [...ring.slice(rotation), ...ring.slice(0, rotation)].filter(n => !gateTiles.has(n) && ![0, 11, 132, 143].includes(n));
    for (const n of [0, 11, 132, 143, ...borderBlocks.slice(0, Math.ceil((boundary.length - exits.length) / 2) - 4)]) put(n, '#');
    const arrivals = SECTOR_PLACES.flatMap(p => sectorExits(p.id)).filter(e => e.destinationSector === place.id).map(e => e.destinationTile);
    const hub = 78;
    put(hub, '=');
    for (const exit of exits) {
        put(exit.tile, '=');
        const routeMask = cells.map(r => r.slice());
        for (const n of boundary) if (!exits.some(e => e.tile === n)) routeMask[Math.floor(n / 12)]![n % 12] = '#';
        const route = pathInMask(routeMask.map(r => r.join('')), exit.tile, hub);
        if (!route) throw new Error('Unreachable gate ' + exit.id);
        for (const n of route) put(n, '=');
    }
    const sites: Record<string, Site> = {};
    for (let n = 0; n < 144; n++) if ('.='.includes(get(n)) && !pathInMask(maskNow(), hub, n)) put(n, '#');
    const candidates: number[] = [];
    for (let y = 1; y <= 9; y++) for (let x = 1; x <= 9; x++) candidates.push(tile(x, y));
    candidates.sort((a, b) => ((a * 73 + place.id * 19) % 149) - ((b * 73 + place.id * 19) % 149));
    // Every Cinderhold sector keeps a garrison stronghold (2x2, free approach below).
    {
        const size = 2;
        const chosen = candidates.find(n => {
            const x = n % 12, y = Math.floor(n / 12);
            if (x + size > 10 || y + size > 10) return false;
            const footprint: number[] = [];
            for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) footprint.push(tile(x + dx, y + dy));
            if (footprint.some(t => arrivals.includes(t) || get(t) !== '.' || tileNeighbors(t).some(adj => arrivals.includes(adj) || exits.some(e => e.tile === adj)))) return false;
            const approach = tile(x + Math.floor(size / 2), y + size);
            if (get(approach) !== '.') return false;
            const proposal = cells.map(r => r.slice());
            footprint.forEach(t => { proposal[Math.floor(t / 12)]![t % 12] = 'B'; });
            const mask = proposal.map(r => r.join(''));
            const open = Array.from({ length: 144 }, (_, t) => t).filter(t => '.='.includes(mask[Math.floor(t / 12)]![t % 12]!));
            return !open.some(t => !pathInMask(mask, hub, t));
        });
        if (chosen === undefined) throw new Error('No stronghold site in ' + place.id);
        const x = chosen % 12, y = Math.floor(chosen / 12);
        for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) put(tile(x + dx, y + dy), 'B');
        const approach = tile(x + Math.floor(size / 2), y + size);
        put(approach, '=');
        pathInMask(maskNow(), hub, approach)!.forEach(n => put(n, '='));
        sites.stronghold = { left: (x + size / 2) / 12 * 100, top: (y + size) / 12 * 100, width: size / 12 * 100, approach, footprint: [x, y, size] };
    }
    const routes = sectorRoadRoutes({ sector: place.id, mask: maskNow(), sites, exits });
    const paintedRoad = new Set(routes.flat());
    for (let n = 0; n < 144; n++) if (get(n) === '=' && !paintedRoad.has(n)) put(n, '.');
    const protectedTiles = new Set([...arrivals, ...exits.map(e => e.tile), hub, ...Object.values(sites).map(s => s.approach)]);
    for (const seed of candidates) {
        if (cells.flat().filter(c => !'.='.includes(c)).length >= 42) break;
        const queue = [seed], visited = new Set<number>(); let added = 0;
        for (let i = 0; i < queue.length && added < 6; i++) {
            const n = queue[i]!;
            if (visited.has(n)) continue; visited.add(n);
            if (n % 12 < 1 || n % 12 > 10 || n < 12 || n >= 132 || get(n) !== '.' || protectedTiles.has(n)) continue;
            if (cells.flat().filter(c => !'.='.includes(c)).length >= 42) break;
            put(n, '#');
            const mask = maskNow();
            if (Array.from({ length: 144 }, (_, t) => t).some(t => '.='.includes(get(t)) && !pathInMask(mask, hub, t))) { put(n, '.'); continue; }
            added++; queue.push(...tileNeighbors(n));
        }
    }
    for (const n of arrivals) if (!'.='.includes(get(n))) throw new Error('Blocked reciprocal arrival in ' + place.id + ': ' + n);
    const riftTile = candidates.find(n => get(n) === '.' && !protectedTiles.has(n)
        && tileNeighbors(n).every(t => !arrivals.includes(t) && !exits.some(e => e.tile === t)));
    if (riftTile !== undefined) sites.rift = { left: (riftTile % 12 + .5) / 12 * 100, top: (Math.floor(riftTile / 12) + 1) / 12 * 100,
        width: 100 / 12, approach: riftTile, footprint: [riftTile % 12, Math.floor(riftTile / 12), 1] };
    const roadDestinations = new Set([...exits.map(e => e.tile), sites.stronghold!.approach]);
    let trimmed;
    do {
        trimmed = false;
        for (let n = 0; n < 144; n++) if (get(n) === '=' && !roadDestinations.has(n)
            && tileNeighbors(n).filter(t => get(t) === '=').length <= 1) { put(n, '.'); trimmed = true; }
    } while (trimmed);
    // Mining seam: an interior rock cell beside open, non-road ground that is not
    // a protected approach. The gatherer stands on the open cell.
    const seamTarget = candidates.find(n => get(n) === '#' && tileNeighbors(n).some(t => get(t) === '.' && !protectedTiles.has(t) && t !== riftTile));
    if (seamTarget === undefined) throw new Error('No mining seam in ' + place.id);
    const seamApproach = tileNeighbors(seamTarget).find(t => get(t) === '.' && !protectedTiles.has(t) && t !== riftTile)!;
    mining[place.id] = { approach: seamApproach, target: seamTarget };
    const layout: Layout = { sector: place.id, artKey: place.artKey, region: place.region, biome: place.biome, name: place.name,
        mask: maskNow(), sites, bakedLandmarks: true,
        exits: exits.map(e => ({ tile: e.tile, direction: e.direction, destination: e.destinationSector })) };
    // Same rule validateSectorLayouts enforces: painted road == routes between
    // real destinations. Drop any road cell no route uses, then re-trim leaves.
    for (let pass = 0; pass < 4; pass++) {
        const routed = new Set(sectorRoadRoutes(layout).flat());
        const stray = [...layout.mask.join('')].flatMap((c, n) => c === '=' && !routed.has(n) ? [n] : []);
        if (!stray.length) break;
        stray.forEach(n => put(n, '.'));
        layout.mask = maskNow();
    }
    layouts[place.artKey] = layout;
}

/**
 * Cinderhold Gates (67) is the village's gate sector, laid out by hand like the
 * four player villages' gates (2026-11-09): the walled village fills the 4x4
 * centre (tiles 52-91), its gate faces the approach on tile 102, and the road is
 * a tree from every exit to that gate. Exit tiles are the ones sectorExits(67)
 * already uses, so travel and the neighbours' road mouths are unchanged.
 */
{
    const gate = SECTOR_PLACES.find(p => p.id === 67)!;
    const mask = [
        '###..=..####',
        '#....=......',
        '.....=...#..',
        '...===....##',
        '====BBBB....',
        '=..=BBBB....',
        '...=BBBB....',
        '...=BBBB...#',
        '#..====....#',
        '##...=......',
        '#....=......',
        '####.=..####',
    ];
    const riftTile = 93;
    layouts[gate.artKey] = {
        sector: gate.id, artKey: gate.artKey, region: gate.region, biome: gate.biome, name: gate.name, mask,
        sites: { rift: { left: (riftTile % 12 + .5) / 12 * 100, top: (Math.floor(riftTile / 12) + 1) / 12 * 100,
            width: 100 / 12, approach: riftTile, footprint: [riftTile % 12, Math.floor(riftTile / 12), 1] } },
        bakedLandmarks: true,
        exits: sectorExits(gate.id).map(e => ({ tile: e.tile, direction: e.direction, destination: e.destinationSector })),
        village: { name: 'Cinderhold Village', left: 50, top: 50, width: 100 / 3, approach: 102 },
    };
    mining[gate.id] = { approach: 32, target: 33 };
}

/** Carve the new climb into an existing (accepted) floor: the shortest open-ground
 * path from the new exit to the existing road network, touching that network at
 * exactly one tile so the road stays a tree (sectorRoadRoutes needs that). */
const patched: Record<number, { layout: Layout; carved: number[] }> = {};
for (const sector of [58, 66]) {
    const place = SECTOR_PLACES.find(p => p.id === sector)!;
    const original = SECTOR_FLOOR_LAYOUTS[place.artKey] as unknown as Layout;
    const mask = original.mask.map(r => r.split(''));
    const get = (n: number) => mask[Math.floor(n / 12)]![n % 12]!;
    const painted = new Set(original.exits.map(e => e.tile));
    const fresh = sectorExits(sector).filter(e => !painted.has(e.tile));
    if (fresh.length === 0) continue; // already carved and admitted (a re-run)
    if (fresh.length !== 1) throw new Error(`Expected one new exit on ${sector}, got ${fresh.length}`);
    const exit = fresh[0]!;
    if (get(exit.tile) !== '.') throw new Error(`New exit tile ${exit.tile} on ${sector} is not open ground`);
    // BFS over '.' tiles only, stopping on the first tile adjacent to a road.
    // Inward steps are tried first so the climb leaves the board edge straight
    // instead of running along the border.
    const inward = { north: 12, south: -12, west: 1, east: -1 }[exit.direction];
    const ordered = (t: number) => tileNeighbors(t).sort((a, b) => Number(b - t === inward) - Number(a - t === inward));
    const previous = new Map<number, number | null>([[exit.tile, null]]), queue = [exit.tile];
    let join: number | null = null;
    for (let i = 0; i < queue.length && join === null; i++) {
        const t = queue[i]!;
        if (tileNeighbors(t).some(n => get(n) === '=')) { join = t; break; }
        for (const n of ordered(t)) if (get(n) === '.' && !previous.has(n)) { previous.set(n, t); queue.push(n); }
    }
    if (join === null) throw new Error('No open path from the new exit on ' + sector);
    const carved: number[] = [];
    for (let t: number | null = join; t !== null; t = previous.get(t) ?? null) carved.push(t);
    const roadNeighbours = carved.flatMap(t => tileNeighbors(t).filter(n => get(n) === '='));
    if (new Set(roadNeighbours).size !== 1) throw new Error(`Climb into ${sector} would loop the road network: ${roadNeighbours}`);
    carved.forEach(t => { mask[Math.floor(t / 12)]![t % 12] = '='; });
    const layout: Layout = { ...original, mask: mask.map(r => r.join('')),
        exits: sectorExits(sector).map(e => ({ tile: e.tile, direction: e.direction, destination: e.destinationSector })) };
    // The road network must still be exactly the routes between real destinations.
    const routed = new Set(sectorRoadRoutes(layout).flat());
    const roads = [...layout.mask.join('')].flatMap((c, n) => c === '=' ? [n] : []);
    if (roads.length !== routed.size || roads.some(n => !routed.has(n))) throw new Error('Purposeless road after carving ' + sector);
    patched[place.artKey] = { layout, carved: carved.reverse() };
}

await fs.writeFile(path.join(out, 'cinderhold-layouts.json'), JSON.stringify({ layouts, mining, patched }, null, 2) + '\n');
for (const l of Object.values(layouts)) console.log(`\n${l.sector} ${l.name}  exits ${l.exits.map(e => `${e.direction}->${e.destination}@${e.tile}`).join(' ')}\n${l.mask.join('\n')}`);
for (const [art, p] of Object.entries(patched)) console.log(`\nart ${art} (sector ${p.layout.sector}) carved ${p.carved.join(',')}\n${p.layout.mask.join('\n')}`);
