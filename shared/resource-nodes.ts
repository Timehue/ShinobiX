import { isPlayableWildSector, SECTOR_PLACES } from './sector-geo';
import { SECTOR_FLOOR_LAYOUTS } from './sector-floor-layouts';
import { WORLD_LAYOUT_VERSION } from './continuous-world-layout';
import type { ResourceActivity, ResourceFamily, ResourceGrade } from './resource-gathering';
import { nearestInMask, pathInMask, tileNeighbors } from './sector-walk-mask';
import { WORLD_BOSS_CRYSTAL_MAX_NODES } from './world-boss-event';

export type ResourceNode = {
    id: string; name: string; activity: ResourceActivity; sector: number; approach: number; target: number;
    difficulty: 1 | 4 | 7; ceiling: ResourceGrade; family: ResourceFamily; trace?: ResourceFamily;
    layoutVersion: string;
    worldBossCrystal?: true;
};
// Explicit water / rock targets and reachable approaches on reviewed floor masks.
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
];
export const RESOURCE_NODES: readonly ResourceNode[] = placements.map(([sector, activity, approach, target, difficulty, name], index) => {
    const place = SECTOR_PLACES.find(p => p.id === sector)!;
    return { id: `resource-${index + 1}`, name, sector, activity, approach, target, difficulty,
        ceiling: (difficulty === 1 ? 1 : difficulty === 4 ? 2 : 3) as ResourceGrade,
        family: activity === 'fishing' ? 'gather-river-fish' : 'gather-iron-sand',
        trace: activity !== 'mining' || difficulty === 1 ? undefined : place.biome === 'snow' ? 'gather-rime-crystal'
            : place.biome === 'volcano' ? 'gather-ember-ore' : place.biome === 'central' ? 'gather-stormglass-shard' : undefined,
        layoutVersion: WORLD_LAYOUT_VERSION };
});

/** Multiple event-only, mid-level mining sites per playable sector, positioned
 * against distinct reachable rock tiles in the reviewed floor mask. The
 * ordinary sector buttons remain the movement hit targets; these are only
 * world-floor interactions. Keeping at least two veins in every sector lets
 * the shared event meter reach all ten tiers instead of stalling at 20%. */
const worldBossCrystalSitesBySector = SECTOR_PLACES
    .filter(place => isPlayableWildSector(place.id))
    .map(place => {
        const floor = SECTOR_FLOOR_LAYOUTS[place.artKey];
        if (!floor) return [] as ResourceNode[];
        const mask = floor.mask;
        const start = nearestInMask(mask, 78);
        const ordinaryTargets = new Set(RESOURCE_NODES.filter(node => node.sector === place.id).map(node => node.target));
        const wantedTile = (place.id * 37 + 19) % 144;
        const candidateByTarget = new Map<number, { target: number; approach: number }>();
        const candidates = Array.from({ length: 144 }, (_, target) => target)
            .filter(target => mask[Math.floor(target / 12)]?.[target % 12] === '#' && !ordinaryTargets.has(target))
            .flatMap(target => tileNeighbors(target)
                .filter(approach => '.='.includes(mask[Math.floor(approach / 12)]?.[approach % 12] ?? '#')
                    && pathInMask(mask, start, approach) !== null)
                .map(approach => ({ target, approach })))
            .sort((a, b) => Math.abs(a.target - wantedTile) - Math.abs(b.target - wantedTile)
                || a.target - b.target || a.approach - b.approach);
        for (const candidate of candidates) {
            if (!candidateByTarget.has(candidate.target)) candidateByTarget.set(candidate.target, candidate);
        }
        const available = [...candidateByTarget.values()];
        const selected: typeof available = [];
        while (selected.length < 3) {
            const remaining = available.filter(candidate => selected.every(site =>
                candidate.target !== site.target
                && candidate.approach !== site.approach
                && candidate.target !== site.approach
                && candidate.approach !== site.target));
            if (remaining.length === 0) break;
            const nearestDistance = (candidate: typeof available[number]) => Math.min(...selected.map(site =>
                Math.abs(candidate.target % 12 - site.target % 12)
                + Math.abs(Math.floor(candidate.target / 12) - Math.floor(site.target / 12))), Infinity);
            remaining.sort((a, b) => nearestDistance(b) - nearestDistance(a)
                || Math.abs(a.target - wantedTile) - Math.abs(b.target - wantedTile)
                || a.target - b.target || a.approach - b.approach);
            selected.push(remaining[0]!);
        }
        return selected.map((site, index) => ({
            // Preserve the original first-site ID so an in-progress event keeps
            // its already-mined veins claimed across a deployment.
            id: index === 0 ? `world-boss-crystal-${place.id}` : `world-boss-crystal-${place.id}-${index + 1}`,
            name: 'Hollow Shard Vein',
            activity: 'mining' as const,
            sector: place.id,
            approach: site.approach,
            target: site.target,
            difficulty: 4 as const,
            ceiling: 2 as const,
            family: 'gather-stormglass-shard' as const,
            worldBossCrystal: true as const,
            layoutVersion: WORLD_LAYOUT_VERSION,
        }));
    });

const coreWorldBossCrystalNodes = worldBossCrystalSitesBySector.flatMap(sites => sites.slice(0, 2));
const extraWorldBossCrystalNodes = worldBossCrystalSitesBySector
    .filter((_, index) => index % 2 === 0)
    .flatMap(sites => sites.slice(2, 3));
export const WORLD_BOSS_CRYSTAL_NODES: readonly ResourceNode[] = [
    ...coreWorldBossCrystalNodes,
    ...extraWorldBossCrystalNodes,
].slice(0, WORLD_BOSS_CRYSTAL_MAX_NODES);

export function resourceNode(id: unknown): ResourceNode | undefined {
    return RESOURCE_NODES.find(node => node.id === id) ?? WORLD_BOSS_CRYSTAL_NODES.find(node => node.id === id);
}
export function resourceNodePosition(node: ResourceNode) { return { left: ((node.target % 12) + .5) / 12 * 100, top: (Math.floor(node.target / 12) + .5) / 12 * 100 }; }
export function validResourceNodeTerrain(node: ResourceNode): boolean {
    const place = SECTOR_PLACES.find(p => p.id === node.sector), floor = place && SECTOR_FLOOR_LAYOUTS[place.artKey];
    if (!floor) return false;
    const cell = (tile: number) => floor.mask[Math.floor(tile / 12)]?.[tile % 12];
    return ['.', '='].includes(cell(node.approach)) && (node.activity === 'fishing'
        ? Boolean(floor.hydrology?.waterTiles.includes(node.target)) : cell(node.target) === '#');
}
