import type { GatherFamily, ResourceNode, ResourceNodeLevel } from './resource-nodes.js';
import type { ResourceActivity } from './resource-gathering.js';

/** Reviewed work surfaces on the admitted coast floors. Keep these IDs stable for saved attempts. */
const placements: readonly [string, string, ResourceActivity, number, number, number, ResourceNodeLevel, GatherFamily, string][] = [
    ['slip-shoal', 'Slip-side shoal', 'fishing', 101, 85, 84, 1, 'gather-river-fish', 'saltstair-dock-101'],
    ['wrack-fibre', 'Wrack-line fibre', 'harvesting', 102, 56, 44, 1, 'gather-binding-fiber', 'saltstair-harvest-102'],
    ['splitstone', 'Splitstone outcrop', 'mining', 103, 39, 27, 1, 'gather-iron-sand', 'saltstair-mine-103'],
    ['needle-shoal', 'Needle Shoal rock pool', 'fishing', 104, 128, 116, 1, 'gather-river-fish', 'saltstair-fish-104'],
    ['bank-herbs', 'Bank herbs', 'harvesting', 106, 110, 98, 1, 'gather-field-herb', 'saltstair-harvest-106'],
    ['sedge', 'Sedge bed', 'harvesting', 112, 51, 39, 1, 'gather-binding-fiber', 'brackwater-harvest-112'],
    ['pitchwood-lashings', 'Tide-washed spar lashings', 'harvesting', 115, 68, 56, 1, 'gather-binding-fiber', 'brackwater-harvest-115'],
    ['quay-fish', 'Quayside shoal', 'fishing', 116, 63, 51, 1, 'gather-river-fish', 'brackwater-dock-116'],
    ['sounding-pool', 'Sounding pool shoal', 'fishing', 117, 88, 76, 1, 'gather-river-fish', 'brackwater-fish-117'],
    ['cedar-bast', 'Split cedar bast', 'harvesting', 123, 53, 41, 4, 'gather-binding-fiber', 'briarwood-harvest-123'],
    ['thorn-fibre', 'Thorn Brake fibre', 'harvesting', 125, 90, 78, 4, 'gather-binding-fiber', 'briarwood-harvest-125'],
    ['stillfang', 'Stillfang bank', 'fishing', 127, 76, 64, 4, 'gather-river-fish', 'briarwood-fish-127'],
    ['whitevein', 'Whitevein outcrop', 'mining', 133, 54, 42, 4, 'gather-iron-sand', 'whitecrown-outcrop-133'],
    ['tarn', 'Open tarn water', 'fishing', 135, 79, 67, 4, 'gather-river-fish', 'whitecrown-fish-135'],
    ['split-needle', 'Split Needle seam', 'mining', 139, 78, 66, 4, 'gather-iron-sand', 'whitecrown-outcrop-139'],
    ['windroot', 'Windroot herbs', 'harvesting', 142, 66, 54, 7, 'gather-field-herb', 'hushcrown-harvest-142'],
    ['silver-outcrop', 'Silver outcrop', 'mining', 143, 65, 53, 7, 'gather-iron-sand', 'hushcrown-mine-143'],
    ['root-pool', 'Root-sheltered pool', 'fishing', 145, 78, 66, 7, 'gather-river-fish', 'hushcrown-fish-145'],
];

export const COAST_RESOURCE_NODES = placements.map(([slug, name, activity, sector, approach, target, difficulty, family, siteId]): ResourceNode & { siteId: string } => ({
    id: 'coast-resource-' + slug, name, activity, sector, approach, target, difficulty, family, siteId,
    layoutVersion: 'hushstone-saltstair-v1',
    ceiling: activity === 'harvesting' ? 0 : difficulty === 1 ? 1 : difficulty === 4 ? 2 : 3,
    ...(activity === 'mining' && difficulty === 4 ? { trace: 'gather-rime-crystal' as const } : {}),
    ...(activity === 'harvesting' && difficulty >= 4 ? { trace: 'gather-heartwood-bark' as const } : {}),
}));
