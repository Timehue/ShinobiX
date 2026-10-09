import type { GameItem } from '../types/combat';
import { GATHERING_TOOLS } from '../../../shared/gathering-tool-items';
import { RESOURCE_ITEMS } from '../../../shared/resource-items';

export const outpostItems: GameItem[] = [
    ...GATHERING_TOOLS.map(tool => ({
        id: tool.id, name: tool.name, slot: tool.slot, cost: tool.cost, rarity: tool.rarity,
        serviceItem: true, levelReq: 1, bonuses: {}, image: `/items/${tool.id}.svg`,
        description: `${tool.slot === 'pickaxe' ? 'Equip to mine rock formations with Fracture Chain.' : 'Equip to fish at water nodes.'} ${tool.durability === null ? 'Permanent tool. Same gathering rates as a basic tool.' : 'Breaks after 50 attempts, including unsuccessful attempts.'}`,
    })),
    // Common minerals already exist; their ids and exploration uses stay compatible.
    ...RESOURCE_ITEMS.filter(item => item.grade > 0 || item.activity === 'fishing').map(item => ({
        id: item.id, name: item.name, slot: 'item' as const, cost: 0, rarity: 'common' as const,
        bonuses: {}, image: item.activity === 'fishing' ? '/items/gather-river-fish.svg' : `/items/${item.family}-v1.webp`,
        description: item.activity === 'fishing'
            ? `${['Common', 'Fine', 'Superior', 'Pristine'][item.grade]} fish. Cook five with a Field Herb and Heartwood Bark at the Noodle Den for ${(item.grade + 1) * 5} Ration Packs.`
            : `${['Common', 'Fine', 'Superior', 'Pristine'][item.grade]} mineral. Used in grade-specific forging recipes at the Crafter.`,
    })),
];
