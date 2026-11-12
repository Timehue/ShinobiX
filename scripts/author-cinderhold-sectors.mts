/**
 * Authoring only: the walk geometry for Cinderhold's home block (sectors 67-74),
 * the road stubs that join it to the Lavafront (58, 66), and the landmark cells
 * every repainted floor bakes in (58, 59, 60, 66 and 67-74).
 *
 * 2026-11-11 rebuild: Cinderhold's pins became a tidy ring around the crest, so
 * every road leaves its floor on the side the map draws it. The eight walk masks
 * are now authored by hand around their landmarks instead of rolled from a seed,
 * so each sector has its own character:
 *
 *   67 Cinderhold Gates     walled village, beacon pillars flanking the north
 *                           road, a lava pool and a ruined outwork in the corners
 *   68 Basalt Steps         a fire shrine (beacon tower) and stepped basalt
 *   69 Smokevent Terraces   rock terraces with four steam vents
 *   70 Magma Cistern        a stone-walled lava cistern
 *   71 Ashfall Barracks     a ruined barracks hall and a broken wall line
 *   72 Obsidian Drill Yard  obsidian outcrops and old drill-yard machinery
 *   73 Caldera Rim          the caldera's lava lake along the north rim
 *   74 Slagwater Crossing   a slag (lava) channel the road bridges
 *
 * Mask letters (authoring only; every one but `r`/`m` is a blocked `#` cell in
 * the admitted layout): L lava lake, C lava cistern, S slag channel, V steam vent,
 * U ruin, F beacon/fire shrine, K basalt formation, O obsidian outcrop,
 * M mining seam target, m its gatherer's standing cell, r the rift tile.
 *
 * The Lavafront floors keep every live exit, road mouth and arrival tile. Their
 * masks are the accepted ones; only the new Cinderhold roads are added, and their
 * landmarks are painted on cells that were already blocked.
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
import { tileNeighbors } from '../shared/sector-walk-mask.ts';
import { SECTOR_FLOOR_LAYOUTS } from '../shared/sector-floor-layouts.ts';
import { sectorRoadRoutes } from './sector-road-routes.mjs';

type Site = { left: number; top: number; width: number; approach: number; footprint: [number, number, number] };
type Layout = {
    sector: number; artKey: number; region: string; biome: string; name: string; mask: string[];
    sites: Record<string, Site>; bakedLandmarks: true;
    exits: { tile: number; direction: string; destination: number }[];
    village?: { name: string; left: number; top: number; width: number; approach: number };
};
type Landmark = { kind: string; tiles: number[]; fall?: number[] };

const out = path.resolve(process.argv[2] ?? 'output/cinderhold');
await fs.mkdir(out, { recursive: true });
const tile = (x: number, y: number) => y * 12 + x;

const KINDS: Record<string, string> = {
    L: 'lava-lake', C: 'lava-cistern', S: 'slag-channel', V: 'steam-vent', U: 'ruin', F: 'beacon', K: 'basalt', O: 'obsidian',
};

const AUTHORED: Record<number, string[]> = {
    67: [
        '##M#==..KKK#',
        '#.m..=.....#',
        '....F=F.....',
        '.....====...',
        '....BBBB=...',
        '....BBBB====',
        '....BBBB=...',
        '....BBBB=r..',
        '......===...',
        'L...........',
        'LLL.......UU',
        'LLLL....UUUU',
    ],
    68: [
        '#####=.=####',
        '.....=.=.FF#',
        '.....=.=.FF#',
        '#....===.r.#',
        '#....=......',
        '.....=......',
        '..BB.=......',
        '..BB.=..KK.#',
        'Mm.===...KK#',
        '#....=....K#',
        '#....=.....#',
        '##...=...###',
    ],
    69: [
        '############',
        '#..........#',
        '#.MKK..BB..#',
        '..mV...BB.##',
        '#V......=..#',
        '.....=======',
        '..K..=..KK..',
        '....V=......',
        '#r...=.....#',
        '.KK..=...KK.',
        '.....=..V...',
        '#....=.....#',
    ],
    70: [
        '###......###',
        'Mm.........#',
        '.......BB..#',
        '...#...BB...',
        '..#.....=...',
        '============',
        '............',
        '....CCC..#..',
        '.#r.CCC.....',
        '#...CCC....#',
        '#.........##',
        '####....####',
    ],
    71: [
        '###.....####',
        '#..r.......#',
        '#.......BB.#',
        '..m.....BB..',
        '..M#.....=..',
        '============',
        '.....=.....#',
        '.UUU.=..U...',
        '.UUU.=..U...',
        '#....=..U...',
        '#....=.....#',
        '###..=..####',
    ],
    72: [
        '##......####',
        '#.......O..#',
        '....BB..OO.#',
        '....BB..OO..',
        '.....=......',
        '======......',
        '.....=......',
        'Mm...=..OO..',
        '#....=..OO.#',
        '..r..=.....#',
        '#....=..UU.#',
        '####.=..####',
    ],
    73: [
        '###LLLLLL###',
        '#..LLLLLL..#',
        '#....LLL...#',
        '............',
        '#...........',
        '============',
        '.#....=BB...',
        '......=BB..#',
        '#.....===...',
        'Mm....=..r.#',
        '....====....',
        '##..=..=.###',
    ],
    74: [
        '####.=...S##',
        '#....=...S.#',
        '#..BB=..SS.#',
        '...BB=..S...',
        '....==..S...',
        '.....=======',
        '........S...',
        '.mM#....S...',
        '#.......SS.#',
        '#..r.....S.#',
        '##.......S.#',
        '###......S##',
    ],
};

function components(cells: number[]): number[][] {
    const left = new Set(cells), groups: number[][] = [];
    for (const start of cells) {
        if (!left.has(start)) continue;
        const group = [start]; left.delete(start);
        for (let i = 0; i < group.length; i++) for (const n of tileNeighbors(group[i]!)) if (left.has(n)) { left.delete(n); group.push(n); }
        groups.push(group.sort((a, b) => a - b));
    }
    return groups;
}

const layouts: Record<number, Layout> = {};
const mining: Record<number, { approach: number; target: number }> = {};
const landmarks: Record<number, Landmark[]> = {};

for (const place of SECTOR_PLACES.filter(p => CINDERHOLD_SECTORS.includes(p.id))) {
    const authored = AUTHORED[place.id]!;
    if (authored.length !== 12 || authored.some(r => r.length !== 12)) throw new Error('Bad authored mask ' + place.id);
    const flat = authored.join('');
    const at = (c: string) => [...flat].flatMap((v, n) => v === c ? [n] : []);
    const mask = authored.map(r => r.replace(/[LCSVUFKOM]/g, '#').replace(/[rm]/g, '.'));
    const exits = sectorExits(place.id);
    for (const e of exits) if (mask[Math.floor(e.tile / 12)]![e.tile % 12] !== '=') throw new Error(`Exit ${e.id} is not on the road`);
    const sites: Record<string, Site> = {};
    const strong = at('B');
    let village: Layout['village'];
    if (place.id === 67) {
        village = { name: 'Cinderhold Village', left: 50, top: 50, width: 100 / 3, approach: 102 };
    } else {
        if (strong.length !== 4) throw new Error('Stronghold must be 2x2 in ' + place.id);
        const x = Math.min(...strong.map(n => n % 12)), y = Math.min(...strong.map(n => Math.floor(n / 12)));
        if (strong.join() !== [tile(x, y), tile(x + 1, y), tile(x, y + 1), tile(x + 1, y + 1)].join()) throw new Error('Stronghold not square in ' + place.id);
        sites.stronghold = { left: (x + 1) / 12 * 100, top: (y + 2) / 12 * 100, width: 2 / 12 * 100, approach: tile(x + 1, y + 2), footprint: [x, y, 2] };
    }
    const [rift] = at('r');
    if (rift === undefined) throw new Error('No rift in ' + place.id);
    sites.rift = { left: (rift % 12 + .5) / 12 * 100, top: (Math.floor(rift / 12) + 1) / 12 * 100, width: 100 / 12, approach: rift, footprint: [rift % 12, Math.floor(rift / 12), 1] };
    const [target] = at('M'), [approach] = at('m');
    if (target === undefined || approach === undefined || !tileNeighbors(target).includes(approach)) throw new Error('Bad mining seam in ' + place.id);
    mining[place.id] = { approach, target };
    landmarks[place.artKey] = Object.entries(KINDS).flatMap(([letter, kind]) => components(at(letter)).map(tiles => ({ kind, tiles })));
    const layout: Layout = { sector: place.id, artKey: place.artKey, region: place.region, biome: place.biome, name: place.name,
        mask, sites, bakedLandmarks: true,
        exits: exits.map(e => ({ tile: e.tile, direction: e.direction, destination: e.destinationSector })),
        ...(village ? { village } : {}) };
    // Same rule validateSectorLayouts enforces: painted road == the routes
    // between real destinations, so a stray authored road cell fails here.
    const routed = new Set(sectorRoadRoutes(layout).flat());
    const roads = [...mask.join('')].flatMap((c, n) => c === '=' ? [n] : []);
    if (roads.length !== routed.size || roads.some(n => !routed.has(n))) throw new Error('Purposeless road in ' + place.id);
    layouts[place.artKey] = layout;
}

/**
 * The Lavafront floors. `accepted` is the mask the accepted (pre-Cinderhold)
 * painting was reviewed against; `final` adds only the Cinderhold roads (58
 * also gives one ash-rock cell, 63, to its new west road). Landmarks sit on cells
 * that are blocked in both, never on a mining seam's cells.
 */
const LAVAFRONT: Record<number, { sector: number; accepted: string[]; final: string[]; landmarks: Landmark[] }> = {
    7: {
        sector: 58,
        accepted: [
            '#.........##', '..#.....#..#', '..#....##..#', '.###........', '..#...======', '...#..=....=',
            '.###.==.....', '.####=.....#', '####.=.....#', '##...=.....#', '#....=.....#', '####.=.#####'],
        // The west road to Cinderhold Gates runs in along row 5 and drops one
        // row into the existing junction at 77; ash-rock cell 63 gives way.
        final: [
            '#.........##', '..#.....#..#', '..#....##..#', '.###........', '..#...======', '=====.=....=',
            '.###===.....', '.####=.....#', '####.=.....#', '##...=.....#', '#....=.....#', '####.=.#####'],
        landmarks: [
            { kind: 'lava-fall', tiles: [95, 107, 119, 131, 143, 142, 141, 140, 139] },
            { kind: 'ruin', tiles: [96, 97, 98, 99] },
            { kind: 'cairn', tiles: [20] },
        ],
    },
    66: {
        sector: 66,
        accepted: [
            '####.......#', '#...#.......', '#.###.......', '..####......', '=======.....', '...#..=#....',
            '#..#.==#....', '#####=###...', '#..#.=.#....', '#....=......', '#....=......', '####.=.#####'],
        final: [
            '####.=.....#', '#...#=......', '#.###==.....', '..####=.....', '=======.....', '=..#..=#....',
            '#..#.==#....', '#####=###...', '#..#.=.#....', '#....=......', '#....=......', '####.=.#####'],
        landmarks: [
            { kind: 'lava-fissure', tiles: [67, 79, 91] },
            { kind: 'ruin', tiles: [84, 85, 86, 87, 88] },
            { kind: 'lava-fall', tiles: [143, 142, 141, 140, 139] },
            { kind: 'cairn', tiles: [63] },
        ],
    },
    // 59 and 60 are Midlands now (the map shows them on green and dry hills):
    // repainted from Midlands floors, masks unchanged.
    2: {
        sector: 59,
        accepted: [
            '#..........#', '..T.........', '..T.T.......', '.TTTT.......', '.TTTTT......', '============',
            '.....T......', '...T.T.....#', '#.TTTTT....#', '#....T.....#', '#..........#', '############'],
        final: [],
        landmarks: [
            // The fall comes down the east cliff into a pool in the corner; the
            // seam at 138 stays dry rock.
            { kind: 'waterfall', tiles: [95, 107, 119, 131, 143, 142, 141, 140], fall: [95, 107, 119, 131] },
            { kind: 'standing-stones', tiles: [96, 108, 120] },
        ],
    },
    52: {
        sector: 60,
        accepted: [
            '##.........#', '#####.......', '#.##........', '............', '============', '..####.....=',
            '#..##.......', '#....#......', '#..#.#......', '#.#####.....', '#....#......', '##########.#'],
        final: [],
        landmarks: [
            // The two reviewed ruins (shared/sector-buildings.ts: Obsidian North
            // Watch and Obsidian Road Station, with their restoration paintings
            // and the frontier gear) keep their exact pixels from the accepted
            // floor: the old ash-road station now stands on the hills.
            { kind: 'ruin-in-place', tiles: [0, 1, 12, 13, 14, 15, 16, 24, 26, 27] },
            { kind: 'ruin-in-place', tiles: [62, 63, 64, 65, 75, 76] },
            { kind: 'ruin-in-place', tiles: [89, 99, 101, 110, 111, 112, 113, 114, 125] },
            // the ash brook: it runs down the west edge into a pool
            { kind: 'brook', tiles: [72, 84, 96, 108, 120, 132, 133, 134], fall: [72, 84, 96, 108, 120] },
            { kind: 'shrine-stone', tiles: [11] },
            { kind: 'standing-stones', tiles: [137, 139] },
        ],
    },
};

const MINING_KEEP: Record<number, number[]> = { 7: [26, 31], 66: [92], 2: [138], 52: [] };
const repaints: Record<number, { layout: Layout; accepted: string[]; carved: number[]; landmarks: Landmark[]; mode: 'lavafront' | 'midlands' }> = {};
for (const [art, spec] of Object.entries(LAVAFRONT)) {
    const place = SECTOR_PLACES.find(p => p.id === spec.sector)!;
    const current = SECTOR_FLOOR_LAYOUTS[Number(art)] as unknown as Layout;
    const final = spec.final.length ? spec.final : spec.accepted;
    const carved: number[] = [];
    for (let n = 0; n < 144; n++) {
        const was = spec.accepted[Math.floor(n / 12)]![n % 12]!, now = final[Math.floor(n / 12)]![n % 12]!;
        if (was === now) continue;
        if (now !== '=' || !(was === '.' || (art === '7' && n === 63))) throw new Error(`Unexpected mask change ${art}:${n} ${was}->${now}`);
        carved.push(n);
    }
    const layout: Layout = { ...current, region: place.region, biome: place.biome, name: place.name, mask: final.slice(),
        exits: sectorExits(spec.sector).map(e => ({ tile: e.tile, direction: e.direction, destination: e.destinationSector })) };
    for (const e of layout.exits) if (final[Math.floor(e.tile / 12)]![e.tile % 12] !== '=') throw new Error(`Exit ${spec.sector}@${e.tile} is not on the road`);
    const routed = new Set(sectorRoadRoutes(layout).flat());
    const roads = [...final.join('')].flatMap((c, n) => c === '=' ? [n] : []);
    if (roads.length !== routed.size || roads.some(n => !routed.has(n))) throw new Error('Purposeless road on ' + spec.sector);
    for (const l of spec.landmarks) for (const t of l.tiles) {
        if (!'#T'.includes(final.join('')[t]!)) throw new Error(`Landmark on open ground ${art}:${t}`);
        if (MINING_KEEP[Number(art)]!.includes(t)) throw new Error(`Landmark on a mining seam ${art}:${t}`);
    }
    repaints[Number(art)] = { layout, accepted: spec.accepted, carved, landmarks: spec.landmarks, mode: place.region === 'midlands' ? 'midlands' : 'lavafront' };
}

await fs.writeFile(path.join(out, 'cinderhold-layouts.json'), JSON.stringify({ layouts, mining, landmarks, repaints }, null, 2) + '\n');
for (const l of Object.values(layouts)) console.log(`\n${l.sector} ${l.name}  exits ${l.exits.map(e => `${e.direction}->${e.destination}@${e.tile}`).join(' ')}  mining ${JSON.stringify(mining[l.sector])}\n${AUTHORED[l.sector]!.join('\n')}`);
for (const [art, p] of Object.entries(repaints)) console.log(`\nart ${art} (sector ${p.layout.sector}, ${p.mode}) carved ${p.carved.join(',') || '-'}\n${p.layout.mask.join('\n')}`);
