/** Lightweight public rules; authoring catalogs and private-state parsing stay off the client graph. */
/** Personal lifetime milestones; shard claims count batches, never shard units. */
export const BUILDING_REPAIR_REWARDS = {
    ryo: 180,
    boneCharms: { repairs: 3, amount: 3 },
    fateShards: { repairs: 20, amount: 5 },
} as const;
export const BUILDING_DELIVERY_DAILY_CAP = 3;
export const BUILDING_WORK_STEP_MS = 6_000;
export const BUILDING_RECEIPT_LIMIT = 80;
export const BUILDING_RESTORATION_TARGETS = [4, 12, 24] as const;
export const buildingRepairStageName = (stage: number) => ['Work not started','Braced shelter','Weatherproof shelter','Restored public frontage'][Math.max(0,Math.min(3,stage))]!;
