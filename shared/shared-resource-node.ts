/** Public world availability. No reward draws, transaction IDs or save data. */
export type SharedResourceNodeView = {
    remaining: number; refillAt: number; gatherer?: string; claimExpiresAt?: number;
};
