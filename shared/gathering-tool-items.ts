export type GatheringToolSlot = 'fishingPole' | 'pickaxe';
export const GATHERING_TOOLS = [
    { id: 'tool-basic-fishing-pole', name: 'Basic Fishing Pole', slot: 'fishingPole', cost: 150, rarity: 'common', durability: 50 },
    { id: 'tool-basic-pickaxe', name: 'Basic Pickaxe', slot: 'pickaxe', cost: 150, rarity: 'common', durability: 50 },
    { id: 'tool-golden-fishing-pole', name: 'Golden Fishing Pole', slot: 'fishingPole', cost: 50, rarity: 'legendary', durability: null },
    { id: 'tool-golden-pickaxe', name: 'Golden Pickaxe', slot: 'pickaxe', cost: 50, rarity: 'legendary', durability: null },
] as const;
export type GatheringTool = typeof GATHERING_TOOLS[number];
