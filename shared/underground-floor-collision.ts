import type { UndergroundFloorFeature } from './underground-floor-features.js';

export const undergroundFeatureBlocks = (features: readonly UndergroundFloorFeature[] | undefined, index: number) => features?.some(f => f.cells.includes(index)) === true;
export function undergroundFeatureWalkable(walkable: string, features: readonly UndergroundFloorFeature[] | undefined): string {
    if (!features?.length) return walkable;
    const cells = [...walkable];
    for (const feature of features) for (const index of feature.cells) cells[index] = '0';
    return cells.join('');
}
