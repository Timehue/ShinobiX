/** Layout first: deterministic guides, prompts and runtime geometry share one source. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeSectorLayoutGuide } from './sector-layout-guide.mjs';
import { SECTOR_PLACES } from '../shared/sector-geo.ts';
import { sectorExits } from '../shared/sector-links.ts';
import { pathInMask, tileNeighbors } from '../shared/sector-walk-mask.ts';
import { shrineForSector } from '../shared/shrines.ts';
import { HOME_SECTORS } from '../shinobij.client/src/data/war-map-sectors.ts';
import { sectorWorldPrompt } from './sector-world-prompt.mjs';
import { sectorRoadRoutes } from './sector-road-routes.mjs';
import { validateSectorLayouts } from './validate-sector-layouts.mjs';

const out = path.resolve('output/connected-world');
await fs.mkdir(out, { recursive: true });
const villages = { 1: 'Stormveil Village', 9: 'Ashen Leaf Village', 17: 'Moonshadow Village', 26: 'Frostfang Village' };
const layouts = {};
const tasks = [];
for (const place of SECTOR_PLACES) {
    if ([54, 99].includes(place.id)) continue;
    const exits = sectorExits(place.id);
    const village = villages[place.id];
    const cells = Array.from({ length: 12 }, () => Array(12).fill('.'));
    const tile = (x, y) => y * 12 + x;
    const get = n => cells[Math.floor(n / 12)][n % 12];
    const put = (n, value) => { cells[Math.floor(n / 12)][n % 12] = value; };
    const boundary = Array.from({ length: 144 }, (_, n) => n).filter(n => n < 12 || n >= 132 || n % 12 === 0 || n % 12 === 11);
    const gateTiles = new Set(exits.flatMap(e => [e.tile, ...tileNeighbors(e.tile)]));
    // Two-thirds of the non-exit border reads as a real terrain boundary.
    const ring = [...Array.from({ length: 12 }, (_, x) => x), ...Array.from({ length: 11 }, (_, y) => (y + 1) * 12 + 11),
        ...Array.from({ length: 11 }, (_, x) => 142 - x), ...Array.from({ length: 10 }, (_, y) => 120 - y * 12)];
    const rotation = place.id * 7 % ring.length;
    const borderBlocks = [...ring.slice(rotation), ...ring.slice(0, rotation)].filter(n => !gateTiles.has(n) && ![0, 11, 132, 143].includes(n));
    for (const n of [0, 11, 132, 143, ...borderBlocks.slice(0, Math.ceil((boundary.length - exits.length) / 2) - 4)]) put(n, '#');
    if (village) for (let y = 4; y <= 7; y++) for (let x = 4; x <= 7; x++) put(tile(x, y), 'B');
    const arrivals = SECTOR_PLACES.flatMap(p => sectorExits(p.id)).filter(e => e.destinationSector === place.id).map(e => e.destinationTile);
    const hub = village ? 102 : 78;
    put(hub, '=');
    for (const exit of exits) {
        put(exit.tile, '=');
        const routeMask = cells.map(r => r.slice());
        for (const n of boundary) if (!exits.some(e => e.tile === n)) routeMask[Math.floor(n / 12)][n % 12] = '#';
        const route = pathInMask(routeMask.map(r => r.join('')), exit.tile, hub);
        if (!route) throw new Error('Unreachable gate ' + exit.id);
        for (const n of route) put(n, '=');
        // Keep the exact reciprocal arrival lane clear too.
    }
    const hydrology = { kind: 'pond', waterTiles: [], bridgeTiles: [] };
    const riverSectors = [8, 18, 35, 38];
    if (riverSectors.includes(place.id)) {
        const columns = [2, 3, 8, 9].filter(x => !exits.some(e => ['north', 'south'].includes(e.direction) && e.tile % 12 === x));
        columns.sort((a, b) => {
            const score = x => { const count = cells.filter(r => r[x] === '=').length; return count === 0 ? 100 : count; };
            return score(a) - score(b);
        });
        const x = columns[0];
        if (x === undefined) throw new Error('No coherent river corridor');
        hydrology.kind = 'river';
        for (let y = 0; y < 12; y++) {
            const n = tile(x, y);
            if (get(n) === '=') hydrology.bridgeTiles.push(n);
            else { put(n, '~'); hydrology.waterTiles.push(n); }
        }
    }
    // A bay occupies a shore, not a scattering of isolated swimming-pool tiles.
    if ([2, 7].includes(place.id)) {
        hydrology.kind = 'harbor';
        for (const [y, endX] of [[7, 0], [8, 2], [9, 3], [10, 4], [11, 4]]) {
            for (let x = 0; x <= endX; x++) {
                const n = tile(x, y);
                if (get(n) !== '=') { put(n, '~'); hydrology.waterTiles.push(n); }
            }
        }
    }
    const sites = {};
    // Isolated corner pockets are terrain, never separate navigable islands.
    for (let n = 0; n < 144; n++) if ('.='.includes(get(n)) && !pathInMask(cells.map(r => r.join('')), hub, n)) put(n, '#');
    const candidates = [];
    for (let y = 1; y <= 9; y++) for (let x = 1; x <= 9; x++) candidates.push(tile(x, y));
    candidates.sort((a, b) => ((a * 73 + place.id * 19) % 149) - ((b * 73 + place.id * 19) % 149));
    const hasStronghold = !village && Object.values(HOME_SECTORS).some(ids => ids.includes(place.id));
    for (const kind of [...(hasStronghold ? ['stronghold'] : []), ...(shrineForSector(place.id) ? ['shrine'] : []), ...([4, 5].includes(place.id) ? ['cairn'] : [])]) {
        // Buildings occupy two tiles horizontally, with a free approach below.
        const size = ['rift', 'cairn'].includes(kind) ? 1 : 2;
        const chosen = candidates.find(n => {
            const x = n % 12, y = Math.floor(n / 12);
            if (x + size > 10 || y + size > 10) return false;
            const footprint = [];
            for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) footprint.push(tile(x + dx, y + dy));
            const occupiedSites = new Set(Object.values(sites).flatMap(s => {
                const [sx, sy, ss] = s.footprint, taken = [];
                for (let dy = 0; dy < ss; dy++) for (let dx = 0; dx < ss; dx++) taken.push(tile(sx + dx, sy + dy));
                return taken;
            }));
            if (footprint.some(t => arrivals.includes(t) || get(t) !== '.' || tileNeighbors(t).some(adj => occupiedSites.has(adj) || arrivals.includes(adj) || exits.some(e => e.tile === adj)))) return false;
            const approach = tile(x + Math.floor(size / 2), y + size);
            if (get(approach) !== '.') return false;
            const proposal = cells.map(r => r.slice());
            footprint.forEach(t => { proposal[Math.floor(t / 12)][t % 12] = 'B'; });
            const mask = proposal.map(r => r.join(''));
            const open = Array.from({ length: 144 }, (_, t) => t).filter(t => '.='.includes(mask[Math.floor(t / 12)][t % 12]));
            if (open.some(t => !pathInMask(mask, hub, t))) return false;
            return true;
        });
        if (chosen === undefined) throw new Error('No site ' + kind + ' in ' + place.id);
        const x = chosen % 12, y = Math.floor(chosen / 12);
        for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) put(tile(x + dx, y + dy), 'B');
        const approach = tile(x + Math.floor(size / 2), y + size);
        put(approach, '=');
        const route = pathInMask(cells.map(r => r.join('')), hub, approach);
        route.forEach(n => put(n, '='));
        sites[kind] = { left: (x + size / 2) / 12 * 100, top: (y + size) / 12 * 100,
            width: size / 12 * 100, approach, footprint: [x, y, size] };
    }
    // Collapse overlapping construction routes to the exact destination network
    // before placing terrain. This also removes broad hub aprons and unused tails.
    const routes = sectorRoadRoutes({ sector: place.id, mask: cells.map(r => r.join('')), sites,
        exits, village: village ? { approach: 102 } : undefined });
    const paintedRoad = new Set(routes.flat());
    for (let n = 0; n < 144; n++) if (get(n) === '=' && !paintedRoad.has(n)) {
        if (hydrology.bridgeTiles.includes(n)) {
            put(n, '~'); hydrology.waterTiles.push(n);
            hydrology.bridgeTiles = hydrology.bridgeTiles.filter(t => t !== n);
        } else put(n, '.');
    }
    // Place distinctive obstacles only where connectivity and arrivals survive.
    const protectedTiles = new Set([...arrivals, ...exits.map(e => e.tile), hub, ...Object.values(sites).map(s => s.approach)]);
    let waterUsed = hydrology.waterTiles.length > 0;
    for (const seed of candidates) {
        if (cells.flat().filter(c => !'.='.includes(c)).length >= 42) break;
        const queue = [seed], visited = new Set(), addedTiles = []; let added = 0;
        const water = !waterUsed && !village && ['stormveil', 'moonshadow', 'frostborder'].includes(place.region);
        for (let i = 0; i < queue.length && added < 6; i++) {
            const n = queue[i];
            if (visited.has(n)) continue; visited.add(n);
            if (n % 12 < 1 || n % 12 > 10 || n < 12 || n >= 132 || get(n) !== '.' || protectedTiles.has(n)) continue;
            if (cells.flat().filter(c => !'.='.includes(c)).length >= 42) break;
            const old = get(n); put(n, water ? '~' : place.id % 2 ? 'T' : '#');
            const mask = cells.map(r => r.join(''));
            if (Array.from({ length: 144 }, (_, t) => t).some(t => '.='.includes(get(t)) && !pathInMask(mask, hub, t))) { put(n, old); continue; }
            added++; addedTiles.push(n); queue.push(...tileNeighbors(n));
        }
        if (water && added >= 4) { waterUsed = true; hydrology.waterTiles.push(...addedTiles); }
        else if (water) addedTiles.forEach(n => put(n, 'T'));
    }
    for (const n of arrivals) {
        if (!'.='.includes(get(n))) throw new Error('Blocked reciprocal arrival in ' + place.id + ': ' + n);
    }
    // Quest rifts appear only while a quest is active. Their anchor is ordinary
    // accessible terrain: no permanent foundation, spur, obstacle or dormant prop.
    const riftTile = candidates.find(n => get(n) === '.' && !protectedTiles.has(n)
        && tileNeighbors(n).every(t => !arrivals.includes(t) && !exits.some(e => e.tile === t)));
    if (riftTile !== undefined) sites.rift = { left: (riftTile % 12 + .5) / 12 * 100,
        top: (Math.floor(riftTile / 12) + 1) / 12 * 100, width: 100 / 12,
        approach: riftTile, footprint: [riftTile % 12, Math.floor(riftTile / 12), 1] };
    // A hub is a routing aid, not a destination. Remove its unused tail and every
    // other road leaf unless it serves a real exit, permanent landmark or village.
    const roadDestinations = new Set([...exits.map(e => e.tile),
        ...Object.entries(sites).filter(([kind]) => kind !== 'rift').map(([, s]) => s.approach),
        ...(village ? [102] : [])]);
    let trimmed;
    do {
        trimmed = false;
        for (let n = 0; n < 144; n++) if (get(n) === '=' && !roadDestinations.has(n)
            && tileNeighbors(n).filter(t => get(t) === '=').length <= 1) { put(n, '.'); trimmed = true; }
    } while (trimmed);
    const mask = cells.map(r => r.join(''));
    const layout = { sector: place.id, artKey: place.artKey, region: place.region, biome: place.biome, name: place.name,
        mask, sites, bakedLandmarks: true, cairnId: place.id === 4 ? 'sv-signal-cairn' : place.id === 5 ? 'sv-rain-split-cairn' : undefined,
        hydrology: hydrology.waterTiles.length ? hydrology : undefined,
        village: village ? { name: village, left: 50, top: 50, width: 100 / 3, approach: 102 } : undefined,
        exits: exits.map(e => ({ tile: e.tile, direction: e.direction, destination: e.destinationSector })) };
    layouts[place.artKey] = layout;
    const guide = await writeSectorLayoutGuide(layout, { out });
    const prompt = sectorWorldPrompt(place, layout);
    await fs.writeFile(path.join(out, 's' + place.artKey + '-prompt.txt'), prompt);
    tasks.push({ ...place, guide, prompt, output: path.resolve('shinobij.client/public/sector-map/s' + place.artKey + '.webp') });
}
validateSectorLayouts(layouts);
await fs.writeFile(path.join(out, 'layouts.json'), JSON.stringify(layouts, null, 2));
await fs.writeFile(path.join(out, 'tasks.json'), JSON.stringify(tasks, null, 2));
console.log('Authored ' + tasks.length + ' unique connected sector plans. No artwork admitted yet.');
