import type { CraftIngredient, CraftMaterialSelection } from './crafting-recipes.js';

export type BuildingService = 'reception' | 'tea' | 'survey' | 'repair' | 'courier' | 'watch' | 'workshop' | 'intelligence' | 'register' | 'festival';
export type BuildingPoint = { sector: number; tile: number; label: string; description: string };
export type SectorBuilding = {
    id: string; sector: number; name: string; kind: 'stronghold' | 'village' | 'shrine' | 'ruin' | 'workplace' | 'road-place';
    keeper: string; role: string; description: string; services: readonly BuildingService[];
    left: number; top: number; width: number; height: number; footprint: readonly number[]; approach: number;
    art: string; region: string; village?: string; shrineId?: string; storyPointId?: string;
    restorationSite?: {left:number;top:number;width:number;height:number;footprint:readonly number[]};
    evidence?: readonly BuildingPoint[]; watchPoints?: readonly BuildingPoint[];
    restoredWatchPoint?: BuildingPoint;
    contactPoints?: readonly BuildingPoint[];
};
export type BuildingReward = { ryo: number; boneCharms: number; fateShards: number };
export type BuildingReceipt = {
    id: string; requestId: string; buildingId: string; action: string; at: number; message: string;
    reward: BuildingReward; materials?: Record<string, number>;
    buildingName?:string; sector?:number;
};
export type BuildingStanding = {
    metAt: number; trust: number; visits: number; visitDay: string; repairCount: number;
    survey?: { step: number; evidence: string[]; recordedAt?: number; interpretation?: string };
    registerEntry?: string; suspicionUntil?: number; intelDay?: string; festivalDay?: string; watchDay?: string; teaUntil?: number;
};
export type BuildingWorkOrder = {
    id: string; buildingId: string; kind: 'repair' | 'courier' | 'watch' | 'intelligence' | 'festival' | 'tea';
    startedAt: number; stepAt: number; step: number; day: string;
    materials?: Record<string, number>; route?: string[]; observations?: string[];
    protocol?: 'cedar' | 'reed' | 'stone';
    watchStage?: number;
};
export type SectorBuildingProgress = {
    version: 1; standing: Record<string, BuildingStanding>; active?: BuildingWorkOrder;
    repairs: number; deliveries: number; watches: number; surveys: number;
    day: string; repairsToday: number; deliveriesToday: number; rewardsToday: number;
    /** Number of paid 20-repair milestones, independent of the shards in each payout. */
    shardClaims: number; receipts: BuildingReceipt[]; titles: string[];
};
export type SharedBuildingState = {
    version: 1; revision: number; repairs: number; stage: number; updatedAt: number;
    contributors: { name: string; repairs: number }[];
    reports: { name: string; at: number; text: string }[];
};
export type BuildingAction = {
    action: 'visit' | 'survey' | 'record' | 'begin' | 'step' | 'cancel' | 'craft' | 'register' | 'tea';
    requestId: string; buildingId: string; orderId?: string; step?: number;
    service?: BuildingWorkOrder['kind']; choice?: string; materials?: CraftMaterialSelection; recipeId?: string;
};
export type BuildingMaterialRow = CraftIngredient & { owned: { id: string; name: string; count: number }[] };
export type BuildingServiceView = {
    service: BuildingService; title: string; description: string; available: boolean; reason?: string;
};
export type BuildingWorkView = {
    order: BuildingWorkOrder; target: BuildingPoint; instruction: string; actionLabel: string;
    readyAt: number; choices?: { id: string; label: string }[]; final: boolean;
    itinerary?:{name:string;sector:number;stamped:boolean}[];
};
export type BuildingDetailView = {
    building: SectorBuilding; greeting: string; standing: BuildingStanding;
    services: BuildingServiceView[]; shared: SharedBuildingState; materials: BuildingMaterialRow[];
    work?: BuildingWorkView; survey?: { step: number; target?: BuildingPoint; complete: boolean; recorded: boolean;
        title:string; testimony:string; evidence:BuildingPoint[]; account?:string; question?:string };
    relationship: { title:string; text:string; benefits:string[] }; conditions:string;
    register: { id: string; title: string; text: string; eligible: boolean; reason?: string }[];
    recipes: { id: string; name: string; ingredients: BuildingMaterialRow[]; level: number; trust:number; available:boolean }[];
    leads: { buildingId: string; sector: number; approach:number; name: string; reason: string }[];
};
export type BuildingWorldView = {
    sector: number; buildings: BuildingDetailView[]; progress: SectorBuildingProgress; saveVersion:number; serverNow: number;
    work?:BuildingWorkView; activeBuilding?:SectorBuilding;
};
