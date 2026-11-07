import { HARVEST_MARKER_LIFT, resourceNodePosition, type ResourceNode } from '../../../shared/resource-nodes';
import { sectorBiomeOf } from '../../../shared/sector-geo';

/**
 * The painted meadow patch under each harvest marker
 * (shinobij.client/art-source/harvest-kama/README.md). Herb or fiber by this
 * half hour's bloom, with the dusk variants in shadow sectors.
 */
export function meadowPatchArt(node: Pick<ResourceNode, 'sector' | 'family'>): string {
    const dusk = sectorBiomeOf(node.sector) === 'shadow' ? 'dusk-' : '';
    const kind = node.family === 'gather-binding-fiber' ? 'fiber' : 'herb';
    return `/assets/harvesting/meadow-patch-${dusk}${kind}-v1.webp`;
}

/** A fixed turn per spot, so neighbouring sectors never look stamped. */
export function meadowPatchTurn(node: Pick<ResourceNode, 'id'>): number {
    const index = Number(node.id.split('-')[1]) || 0;
    return (index * 47) % 360;
}

/** Meadow markers float half a tile up, so their pin points into the painted
 * patch instead of covering it. Every other marker keeps its usual spot. */
export const MEADOW_MARKER_LIFT = HARVEST_MARKER_LIFT;
export function meadowMarkerPosition(node: ResourceNode): { left: number; top: number } {
    const position = resourceNodePosition(node);
    return node.activity === 'harvesting' ? { left: position.left, top: position.top - MEADOW_MARKER_LIFT / 12 * 100 } : position;
}
