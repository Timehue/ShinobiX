import { SECTOR_PLACES } from './sector-geo';
import { SECTOR_FLOOR_LAYOUTS } from './sector-floor-layouts';
import { WORLD_LAYOUT_VERSION } from './continuous-world-layout';
import { RESOURCE_REFILL_MS, type ResourceActivity, type ResourceFamily, type ResourceGrade } from './resource-gathering';
import { RESOURCE_MEADOW_TILES, RESOURCE_ROCK_TILES } from './resource-node-terrain';
import { RESOURCE_CRYSTAL_SITES } from './resource-crystal-sites';
import { harvestTraceFor, type HarvestCommonId, type HarvestTraceId } from './harvesting';

export type ResourceNodeLevel = 1 | 4 | 7;
/** What a node pays: a graded fishing/mining family, or a plain harvest id. */
export type GatherFamily = ResourceFamily | HarvestCommonId;
export type GatherTrace = ResourceFamily | HarvestTraceId;
export type ResourceNode = {
    id: string; name: string; activity: ResourceActivity; sector: number; approach: number; target: number;
    /** The placement's base level. Live play uses resourceNodeOffer instead. */
    difficulty: ResourceNodeLevel; ceiling: ResourceGrade; family: GatherFamily; trace?: GatherTrace;
    layoutVersion: string;
    /** A meadow with nothing growing in this half-hour bloom (harvestNodeAt). */
    dormant?: true;
    worldBossCrystal?: true;
    markerOffset?: readonly [number,number];
};
// Durable placement IDs; active sites also require reviewed natural surfaces.
// A target is decorative terrain; the approach is where the character stands.
const placements: readonly [number, ResourceActivity, number, number, 1 | 4 | 7, string][] = [
    [2, 'fishing', 99, 98, 1, 'Dockside shoal'], [2, 'fishing', 125, 124, 4, 'Deep harbor shoal'],
    [6, 'fishing', 39, 27, 1, 'Stillwater shoal'], [6, 'fishing', 38, 37, 4, 'Reedwater shoal'],
    [8, 'fishing', 39, 38, 4, 'Canal current'], [8, 'fishing', 123, 122, 7, 'Deep canal current'],
    [18, 'fishing', 27, 26, 1, 'Jade river shoal'], [18, 'fishing', 99, 98, 4, 'Jade river bend'],
    [22, 'fishing', 30, 29, 4, 'Moonlit shoal'], [22, 'fishing', 42, 41, 7, 'Cove depths'],
    [38, 'fishing', 39, 38, 4, 'Gorge current'], [38, 'fishing', 123, 122, 7, 'Gorge depths'],
    [2, 'mining', 74, 73, 1, 'Harbor iron seam'], [2, 'mining', 130, 142, 4, 'Harbor stormglass seam'],
    [27, 'mining', 34, 35, 4, 'Glacial seam'], [27, 'mining', 130, 142, 7, 'Glacier heart'],
    [29, 'mining', 13, 1, 1, 'Highpass iron seam'], [29, 'mining', 121, 120, 4, 'Highpass crystal seam'],
    [38, 'mining', 30, 31, 4, 'Gorge iron seam'], [38, 'mining', 58, 59, 7, 'Gorge stormglass seam'],
    [58, 'mining', 25, 26, 1, 'Cinder iron seam'], [58, 'mining', 30, 31, 4, 'Cinder ember seam'],
    [60, 'mining', 28, 27, 4, 'Obsidian seam'], [60, 'mining', 98, 99, 7, 'Obsidian heart'],
    // 2026-10-14 world-wide pass. APPEND ONLY: a node's id is its index here
    // (resource-N), so reordering would re-point saved gathering state. The
    // original pass forced seams into sectors without natural rock. Those
    // entries are now retired below, while their historical IDs remain intact.
    [1, 'mining', 6, 7, 1, 'Roadside iron seam'],
    [3, 'fishing', 49, 50, 1, 'Millpond shoal'],
    [3, 'fishing', 14, 26, 4, 'Reedbank shoal'],
    [4, 'fishing', 62, 50, 1, 'Millpond shoal'],
    [4, 'fishing', 14, 26, 4, 'Reedbank shoal'],
    [5, 'fishing', 86, 98, 1, 'Millpond shoal'],
    [5, 'fishing', 121, 122, 4, 'Reedbank shoal'],
    [7, 'fishing', 86, 98, 1, 'Millpond shoal'],
    [7, 'fishing', 137, 136, 4, 'Reedbank shoal'],
    [9, 'mining', 125, 137, 1, 'Rootbound iron seam'],
    [10, 'mining', 6, 18, 1, 'Rootbound iron seam'],
    [11, 'mining', 18, 6, 1, 'Rootbound iron seam'],
    [12, 'mining', 86, 98, 1, 'Rootbound iron seam'],
    [13, 'mining', 18, 6, 1, 'Rootbound iron seam'],
    [14, 'mining', 63, 75, 1, 'Rootbound iron seam'],
    [15, 'mining', 124, 136, 1, 'Rootbound iron seam'],
    [16, 'mining', 76, 88, 1, 'Rootbound iron seam'],
    [17, 'mining', 4, 3, 1, 'Gloom iron seam'],
    [19, 'fishing', 53, 54, 1, 'Blackwater shoal'],
    [19, 'fishing', 17, 18, 4, 'Gloomreed pool'],
    [20, 'fishing', 65, 53, 1, 'Blackwater shoal'],
    [21, 'fishing', 92, 104, 1, 'Blackwater shoal'],
    [21, 'fishing', 106, 118, 4, 'Gloomreed pool'],
    [23, 'fishing', 54, 55, 4, 'Gloomreed pool'],
    [23, 'fishing', 30, 31, 7, 'Blackwater depths'],
    [24, 'fishing', 45, 57, 4, 'Gloomreed pool'],
    [24, 'fishing', 19, 31, 7, 'Blackwater depths'],
    [25, 'fishing', 56, 68, 4, 'Gloomreed pool'],
    [26, 'mining', 126, 138, 4, 'Rime crystal seam'],
    [28, 'mining', 66, 54, 4, 'Rime crystal seam'],
    [30, 'mining', 65, 77, 4, 'Rime crystal seam'],
    [31, 'mining', 18, 6, 4, 'Rime crystal seam'],
    [32, 'mining', 54, 53, 4, 'Rime crystal seam'],
    [33, 'mining', 83, 95, 4, 'Ember seam'],
    [34, 'fishing', 43, 31, 4, 'Floe-edge pool'],
    [34, 'fishing', 21, 33, 7, 'Glacier-fed depths'],
    [35, 'fishing', 62, 74, 4, 'Floe-edge pool'],
    [35, 'fishing', 3, 2, 7, 'Glacier-fed depths'],
    [36, 'mining', 69, 81, 4, 'Quarry stormglass seam'],
    [37, 'mining', 82, 83, 4, 'Quarry stormglass seam'],
    [39, 'mining', 126, 138, 4, 'Quarry stormglass seam'],
    [40, 'mining', 78, 90, 4, 'Quarry stormglass seam'],
    [41, 'mining', 126, 138, 4, 'Quarry stormglass seam'],
    [42, 'mining', 68, 80, 4, 'Quarry stormglass seam'],
    [43, 'mining', 83, 95, 4, 'Quarry stormglass seam'],
    [44, 'mining', 41, 53, 4, 'Quarry stormglass seam'],
    [45, 'mining', 82, 83, 7, 'Stormglass heart'],
    [46, 'mining', 68, 80, 7, 'Stormglass heart'],
    [47, 'mining', 126, 138, 7, 'Stormglass heart'],
    [48, 'mining', 42, 43, 7, 'Stormglass heart'],
    [49, 'mining', 5, 6, 7, 'Stormglass heart'],
    [50, 'mining', 68, 80, 7, 'Stormglass heart'],
    [51, 'mining', 18, 6, 7, 'Stormglass heart'],
    [52, 'mining', 73, 74, 7, 'Stormglass heart'],
    [53, 'mining', 126, 138, 7, 'Stormglass heart'],
    [55, 'mining', 18, 6, 7, 'Duskstone heart'],
    [56, 'mining', 87, 75, 7, 'Duskstone heart'],
    [57, 'mining', 82, 83, 7, 'Duskstone heart'],
    [59, 'mining', 126, 138, 7, 'Magma heart'],
    [61, 'mining', 73, 72, 7, 'Stormglass heart'],
    [62, 'mining', 89, 90, 7, 'Stormglass heart'],
    [63, 'mining', 82, 83, 7, 'Stormglass heart'],
    [64, 'mining', 103, 102, 7, 'Duskstone heart'],
    [65, 'mining', 82, 83, 7, 'Rime heart'],
    [66, 'mining', 80, 92, 7, 'Magma heart'],
    [7, 'fishing', 72, 84, 4, 'Reedbank shoal'],
    [35, 'fishing', 121, 122, 7, 'Glacier-fed depths'],
    // Cinderhold (67-74), 2026-11-08 — one ash-rock seam per sector (67's moved
    // north of the walled village on 2026-11-09).
    [67, 'mining', 32, 33, 4, 'Ember seam'],
    [68, 'mining', 102, 103, 4, 'Ember seam'],
    [69, 'mining', 16, 15, 7, 'Magma heart'],
    [70, 'mining', 28, 29, 7, 'Magma heart'],
    [71, 'mining', 88, 100, 4, 'Ember seam'],
    [72, 'mining', 4, 16, 7, 'Magma heart'],
    [73, 'mining', 25, 26, 7, 'Magma heart'],
    [74, 'mining', 82, 81, 4, 'Ember seam'],
];
function levelRewards(sector: number, activity: ResourceActivity, difficulty: ResourceNodeLevel): Pick<ResourceNode, 'ceiling' | 'trace'> {
    const place = SECTOR_PLACES.find(p => p.id === sector)!;
    // Harvest ids are ungraded: no ceiling, and only forest/shadow carry a trace.
    if (activity === 'harvesting') return { ceiling: 0, trace: harvestTraceFor(place.biome, difficulty) };
    return { ceiling: (difficulty === 1 ? 1 : difficulty === 4 ? 2 : 3) as ResourceGrade,
        trace: activity !== 'mining' || difficulty === 1 ? undefined : place.biome === 'snow' ? 'gather-rime-crystal'
            : place.biome === 'volcano' ? 'gather-ember-ore' : place.biome === 'central' ? 'gather-stormglass-shard' : undefined };
}
/** A meadow's name by biome and plant: Glade (forest), Dusk (shadow), Meadow (central). */
function harvestName(sector: number, family: HarvestCommonId): string {
    const biome = SECTOR_PLACES.find(place => place.id === sector)?.biome;
    const herb = family === 'gather-field-herb';
    return biome === 'shadow' ? herb ? 'Duskmoss herb patch' : 'Duskreed fiber bed'
        : `${biome === 'forest' ? 'Glade' : 'Meadow'} ${herb ? 'herb patch' : 'fiber reeds'}`;
}
const historicalNodes: readonly ResourceNode[] =placements.map(([sector, activity, approach, target, difficulty, name], index) => {
    return { id: `resource-${index + 1}`, name, sector, activity, approach, target, difficulty,
        ...levelRewards(sector, activity, difficulty),
        family: activity === 'fishing' ? 'gather-river-fish' : 'gather-iron-sand',
        layoutVersion: WORLD_LAYOUT_VERSION };
});

/** Retired locations remain resolvable for already admitted attempts and old
 * receipts. Do not splice placements: resource IDs are durable save keys. */
export const RETIRED_RESOURCE_NODE_IDS:readonly string[]=['resource-19','resource-23','resource-24','resource-76','resource-78','resource-85','resource-88'];
export const RESOURCE_NODES:readonly ResourceNode[]=historicalNodes.filter(node=>!RETIRED_RESOURCE_NODE_IDS.includes(node.id));

/** Kama Reaping meadows (docs/harvesting-minigame-plan.md §5). APPEND ONLY: a
 * node's id is `harvest-<index + 1>`, a durable save key in its own namespace,
 * so the `resource-N` table above is never touched. One reviewed grass cell per
 * forest, shadow and central wild sector (RESOURCE_MEADOW_TILES). Kept out of
 * RESOURCE_NODES until the client shows harvesting (Phase 3), because the map,
 * Outpost panel, road cast and marker placement all read that list. */
// Six characters per meadow, in id order: sector and approach tile as two base-36
// digits each, then the target tile (a = 12 tiles up, b = 12 down, c = 1 right) and
// the base level. Packed because the table ships in the world chunk; the shared
// tests check every decoded cell against RESOURCE_MEADOW_TILES. The authored plant
// alternates herb and fiber by position and only matters to fixed-level QA
// fixtures: live play takes each half hour's bloom (harvestNodeAt), and the name
// follows the plant.
const HARVEST_PLACEMENTS = '012ya1022ua1032va1043aa1051ma1062ka1072va1081rb1093aa40a2sa40b2va40c39a40d2ua40e2ua40f1va40g2pa40h2ya70i3ia70j31a70k2ka70l2fa70m34a70n22c70o2pa70p2fa7102hc1112ta1122ua1132ra11431a11532a1162ga11735a1182ra1192ta11a2sa11b2ta11c2sa11d2ia11e3ua11f2ua11g2ia11h2pa11j36a71k2va71l38a71p2ua11q19a11r3ta11s1ta7';
export const HARVEST_NODES: readonly ResourceNode[] = Array.from({ length: HARVEST_PLACEMENTS.length / 6 }, (_, index) => {
    const row = HARVEST_PLACEMENTS.slice(index * 6, index * 6 + 6), sector = parseInt(row.slice(0, 2), 36), approach = parseInt(row.slice(2, 4), 36);
    const target = approach + { a: -12, b: 12, c: 1 }[row[4] as 'a' | 'b' | 'c'], difficulty = Number(row[5]) as ResourceNodeLevel;
    const family: HarvestCommonId = index % 2 ? 'gather-binding-fiber' : 'gather-field-herb';
    return { id: `harvest-${index + 1}`, name: harvestName(sector, family), sector, activity: 'harvesting', approach, target, difficulty,
        ...levelRewards(sector, 'harvesting', difficulty), family, layoutVersion: WORLD_LAYOUT_VERSION };
});
export const WORLD_BOSS_CRYSTAL_NODES:readonly ResourceNode[]=RESOURCE_CRYSTAL_SITES.map(([sector,slot,approach,target])=>({
    id:slot===1?`world-boss-crystal-${sector}`:`world-boss-crystal-${sector}-${slot}`,
    name:'Hollow Shard Vein',activity:'mining',sector,approach,target,difficulty:4,ceiling:2,
    family:'gather-stormglass-shard',worldBossCrystal:true,layoutVersion:WORLD_LAYOUT_VERSION,
    // The cliff continues into this snowy cell; center the icon on its exposed
    // upper-right face instead of the snow at the old tile center.
    ...(sector===30&&slot===2?{markerOffset:[.75,.25] as const}:{}),
}));

/**
 * Wild blooms (owner request, 2026-11-06). Every half hour each meadow spot
 * rolls 50/50 whether anything grows there, and 50/50 whether it is a herb patch
 * or fiber reeds, so players crossing the world come across fresh plants by
 * luck. The roll is seeded by the spot and the half hour, never per player: the
 * server and every client see the same meadows. A started attempt keeps the
 * plant it sealed.
 */
export const HARVEST_BLOOM_MS = 30 * 60_000;
export const HARVEST_BLOOM_CHANCE = 0.5;
/** FNV-1a of `text`, then mulberry32 steps: the same draw dealLevels uses. */
function hashText(text: string): number {
    let seed = 2166136261;
    for (const char of text) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
    return seed;
}
function mixDraw(seed: number): number {
    let mixed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
}
const seededDraw = (text: string) => mixDraw((hashText(text) + 0x6D2B79F5) | 0);
export const harvestBloomCycle = (at: number) => Math.floor(at / HARVEST_BLOOM_MS);
export function harvestBloom(node: Pick<ResourceNode, 'id'>, at: number): { present: boolean; family: HarvestCommonId } {
    const cycle = harvestBloomCycle(at);
    return { present: seededDraw(`bloom:${node.id}:${cycle}`) < HARVEST_BLOOM_CHANCE,
        family: seededDraw(`kind:${node.id}:${cycle}`) < .5 ? 'gather-field-herb' : 'gather-binding-fiber' };
}
/** Meadow markers draw this many tiles above their plant, so the pin points into
 * the painted patch (shinobij.client/src/lib/meadow-patch.ts). Placement tests
 * measure clearance from the lifted spot, where the marker really is. */
export const HARVEST_MARKER_LIFT = .55;
/** A meadow growing `family` (or dormant), named for that plant. The one place a
 * plant is applied, so the name can never disagree with what grows. */
export function harvestNodeAs(node: ResourceNode, family: HarvestCommonId, present: boolean): ResourceNode {
    const { dormant: _dormant, ...rest } = node; void _dormant;
    return { ...rest, family, name: harvestName(node.sector, family), ...(present ? {} : { dormant: true as const }) };
}
/** A meadow as it stands at `at`: this half hour's plant, or dormant. */
export function harvestNodeAt(node: ResourceNode, at: number): ResourceNode {
    if (node.activity !== 'harvesting') return node;
    const bloom = harvestBloom(node, at);
    return harvestNodeAs(node, bloom.family, bloom.present);
}

export function resourceNode(id: unknown): ResourceNode | undefined {
    return historicalNodes.find(node => node.id === id) ?? HARVEST_NODES.find(node => node.id === id)
        ?? WORLD_BOSS_CRYSTAL_NODES.find(node => node.id === id);
}

/** A cycle deals exactly half of an activity's sites level 1 and splits the rest
 * between 4 and 7. Refills use the same clock, so an emptied site always returns
 * on a new deal. Untouched sites redeal too: a level 7 site nobody can work would
 * otherwise never empty, and the world would drift away from level 1. */
function dealLevels(activity: ResourceActivity, cycle: number): ReadonlyMap<string, ResourceNodeLevel> {
    const sites = (activity === 'harvesting' ? HARVEST_NODES : RESOURCE_NODES).filter(node => node.activity === activity).map(node => node.id);
    let seed = hashText(`${activity}:${cycle}`);
    const draw = () => mixDraw(seed = (seed + 0x6D2B79F5) | 0);
    for (let i = sites.length - 1; i > 0; i--) {
        const j = Math.floor(draw() * (i + 1));
        [sites[i], sites[j]] = [sites[j], sites[i]];
    }
    const basic = Math.ceil(sites.length / 2), rich = basic + Math.ceil((sites.length - basic) / 2);
    return new Map(sites.map((id, index) => [id, index < basic ? 1 : index < rich ? 4 : 7]));
}
const lastDeal: Partial<Record<ResourceActivity, { cycle: number; levels: ReadonlyMap<string, ResourceNodeLevel> }>> = {};
export function resourceNodeAtLevel(node: ResourceNode, difficulty: ResourceNodeLevel): ResourceNode {
    return node.worldBossCrystal ? node : { ...node, difficulty, ...levelRewards(node.sector, node.activity, difficulty) };
}
/** What a site offers at `at`. Event crystals and retired sites keep their rules. */
export function resourceNodeOffer(node: ResourceNode, at: number): ResourceNode {
    const cycle = Math.floor(at / RESOURCE_REFILL_MS);
    let deal = lastDeal[node.activity];
    if (deal?.cycle !== cycle) deal = lastDeal[node.activity] = { cycle, levels: dealLevels(node.activity, cycle) };
    const level = deal.levels.get(node.id);
    // Meadows also take this half hour's bloom: its plant, or nothing.
    return harvestNodeAt(level ? resourceNodeAtLevel(node, level) : node, at);
}
export function resourceNodePosition(node: ResourceNode) { return { left: ((node.target % 12) + (node.markerOffset?.[0]??.5)) / 12 * 100, top: (Math.floor(node.target / 12) + (node.markerOffset?.[1]??.5)) / 12 * 100 }; }
export function validResourceNodeTerrain(node: ResourceNode): boolean {
    const place = SECTOR_PLACES.find(p => p.id === node.sector), floor = place && SECTOR_FLOOR_LAYOUTS[place.artKey];
    if (!floor||RETIRED_RESOURCE_NODE_IDS.includes(node.id)) return false;
    const cell = (tile: number) => floor.mask[Math.floor(tile / 12)]?.[tile % 12];
    if (!['.', '='].includes(cell(node.approach))) return false;
    if (node.activity === 'fishing') return Boolean(floor.hydrology?.waterTiles.includes(node.target));
    // A meadow plant stands on open ground; the gatherer stands beside it.
    if (node.activity === 'harvesting') return cell(node.target) === '.' && node.approach !== node.target
        && !floor.hydrology?.waterTiles.includes(node.target) && !floor.hydrology?.bridgeTiles.includes(node.target)
        && Boolean(RESOURCE_MEADOW_TILES[node.sector]?.includes(node.target));
    return cell(node.target) === '#'&&Boolean(RESOURCE_ROCK_TILES[node.sector]?.includes(node.target));
}
