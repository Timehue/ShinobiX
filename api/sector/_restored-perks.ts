import { keeperWorkshopCraftRyo } from '../../shared/craft-fees.js';
import { BUILDING_RESTORED_PERK } from '../../shared/sector-building-rules.js';
import type { SectorBuilding, SharedBuildingState } from '../../shared/sector-building-types.js';

/** A ruin currently standing restored: its keeper pays and charges on better terms. */
export const buildingStandsRestored = (building: Pick<SectorBuilding, 'kind'>, shared: Pick<SharedBuildingState, 'stage'>) =>
    building.kind === 'ruin' && shared.stage === 3;
/** Server-computed payout; `restored` comes from the sealed order, never the client. */
export const restoredPay = (base: number, restored: boolean) => restored ? Math.round(base * BUILDING_RESTORED_PERK.payMultiplier) : base;
/** The keeper workshop fee schedule, a quarter lower at a restored building. */
export const workshopFeeFor = (restored: boolean): typeof keeperWorkshopCraftRyo => restored
    ? (recipeId, shelfCost, outputCount) => Math.floor(keeperWorkshopCraftRyo(recipeId, shelfCost, outputCount) * BUILDING_RESTORED_PERK.workshopFeeMultiplier)
    : keeperWorkshopCraftRyo;
