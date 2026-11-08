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
/** A fully repaired ruin stands intact this long, then weathers back to its painted ruin. */
export const BUILDING_RUIN_INTACT_MS = 7 * 24 * 60 * 60 * 1000;
/** An unfinished restoration with no completed repair for this long falls back to the bare ruin. */
export const BUILDING_RUIN_IDLE_FADE_MS = 14 * 24 * 60 * 60 * 1000;
/** While a ruin stands restored: work begun at its counter (courier, watch, contact,
 * festival, a recorded field account) pays a quarter more, and its workshop charges
 * a quarter less. The bonus is sealed into the order when the work is accepted. */
export const BUILDING_RESTORED_PERK = { payMultiplier: 1.25, workshopFeeMultiplier: 0.75 } as const;
/** A verified world PvP fight in a ruin's sector damages it: a standing restoration
 * loses `standingMs` (it may fall early); unfinished work loses `cycleRepairs`.
 * Each battle counts once per building, at most `dailyLimit` fights per UTC day
 * of the battle's end. */
export const BUILDING_RUIN_BATTLE_DAMAGE = { standingMs: 12 * 60 * 60 * 1000, cycleRepairs: 2, dailyLimit: 4 } as const;
export const buildingRepairStageName = (stage: number, kind?: string) => (kind === 'ruin'
    // Named for the restoration sprites: timber frame, canvas cover, tiled roof.
    ? ['Ruin','Braced frame','Covered frame','Restored']
    : ['Work not started','Braced shelter','Weatherproof shelter','Restored public frontage'])[Math.max(0,Math.min(3,stage))]!;
