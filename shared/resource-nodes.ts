import { SECTOR_PLACES } from './sector-geo';
import { SECTOR_FLOOR_LAYOUTS } from './sector-floor-layouts';
import { WORLD_LAYOUT_VERSION } from './continuous-world-layout';
import type { ResourceActivity, ResourceFamily, ResourceGrade } from './resource-gathering';
import { RESOURCE_ROCK_TILES } from './resource-node-terrain';
import { RESOURCE_CRYSTAL_SITES } from './resource-crystal-sites';

export type ResourceNode = {
    id: string; name: string; activity: ResourceActivity; sector: number; approach: number; target: number;
    difficulty: 1 | 4 | 7; ceiling: ResourceGrade; family: ResourceFamily; trace?: ResourceFamily;
    layoutVersion: string;
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
];
const historicalNodes: readonly ResourceNode[] = placements.map(([sector, activity, approach, target, difficulty, name], index) => {
    const place = SECTOR_PLACES.find(p => p.id === sector)!;
    return { id: `resource-${index + 1}`, name, sector, activity, approach, target, difficulty,
        ceiling: (difficulty === 1 ? 1 : difficulty === 4 ? 2 : 3) as ResourceGrade,
        family: activity === 'fishing' ? 'gather-river-fish' : 'gather-iron-sand',
        trace: activity !== 'mining' || difficulty === 1 ? undefined : place.biome === 'snow' ? 'gather-rime-crystal'
            : place.biome === 'volcano' ? 'gather-ember-ore' : place.biome === 'central' ? 'gather-stormglass-shard' : undefined,
        layoutVersion: WORLD_LAYOUT_VERSION };
});

/** Retired locations remain resolvable for already admitted attempts and old
 * receipts. Do not splice placements: resource IDs are durable save keys. */
export const RETIRED_RESOURCE_NODE_IDS:readonly string[]=['resource-19','resource-23','resource-24','resource-76','resource-78','resource-85','resource-88'];
export const RESOURCE_NODES:readonly ResourceNode[]=historicalNodes.filter(node=>!RETIRED_RESOURCE_NODE_IDS.includes(node.id));
export const WORLD_BOSS_CRYSTAL_NODES:readonly ResourceNode[]=RESOURCE_CRYSTAL_SITES.map(([sector,slot,approach,target])=>({
    id:slot===1?`world-boss-crystal-${sector}`:`world-boss-crystal-${sector}-${slot}`,
    name:'Hollow Shard Vein',activity:'mining',sector,approach,target,difficulty:4,ceiling:2,
    family:'gather-stormglass-shard',worldBossCrystal:true,layoutVersion:WORLD_LAYOUT_VERSION,
    // The cliff continues into this snowy cell; center the icon on its exposed
    // upper-right face instead of the snow at the old tile center.
    ...(sector===30&&slot===2?{markerOffset:[.75,.25] as const}:{}),
}));

export function resourceNode(id: unknown): ResourceNode | undefined {
    return historicalNodes.find(node => node.id === id) ?? WORLD_BOSS_CRYSTAL_NODES.find(node => node.id === id);
}
export function resourceNodePosition(node: ResourceNode) { return { left: ((node.target % 12) + (node.markerOffset?.[0]??.5)) / 12 * 100, top: (Math.floor(node.target / 12) + (node.markerOffset?.[1]??.5)) / 12 * 100 }; }
export function validResourceNodeTerrain(node: ResourceNode): boolean {
    const place = SECTOR_PLACES.find(p => p.id === node.sector), floor = place && SECTOR_FLOOR_LAYOUTS[place.artKey];
    if (!floor||RETIRED_RESOURCE_NODE_IDS.includes(node.id)) return false;
    const cell = (tile: number) => floor.mask[Math.floor(tile / 12)]?.[tile % 12];
    return ['.', '='].includes(cell(node.approach)) && (node.activity === 'fishing'
        ? Boolean(floor.hydrology?.waterTiles.includes(node.target)) : cell(node.target) === '#'&&Boolean(RESOURCE_ROCK_TILES[node.sector]?.includes(node.target)));
}
