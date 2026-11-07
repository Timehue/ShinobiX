import type { ResourceNodeLevel } from './resource-nodes';
import type { HarvestCommonId } from './harvesting';

/** Public world availability. No reward draws, transaction IDs or save data. */
export type SharedResourceNodeView = {
    remaining: number; refillAt: number; gatherer?: string; claimExpiresAt?: number;
    /** The level this site offers now. */
    difficulty?: ResourceNodeLevel;
    /** Meadows only: this half hour's plant, and whether nothing grows at all. */
    family?: HarvestCommonId; dormant?: true;
};
