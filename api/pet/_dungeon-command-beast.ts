import type { Pet } from '../_pet-sim/pet-types.js';
import { PET_CATALOG } from './_catalog.js';
import { buildDungeonRareBeast } from './_dungeon-battle.js';

/** Current command boss. Historical cinematic snapshots stay immutable. */
export function buildDungeonCommandBeast(): Pet {
    const archetype = PET_CATALOG['rare-2'];
    if (!archetype || archetype.rarity !== 'rare' || archetype.element !== 'Earth') throw new Error('The Dungeon command archetype is unavailable.');
    const authored = buildDungeonRareBeast();
    // Use the same stat/growth budget as a rare companion. The old cinematic
    // 900/110/100 frame overwhelms this resolver even with level-65 opponents.
    return {
        ...archetype, ...authored, templateId: String(archetype.id), role: 'tracker',
        hp: Number(archetype.hp), attack: Number(archetype.attack), defense: Number(archetype.defense), speed: Number(archetype.speed),
        growthBaseStats: { hp: Number(archetype.hp), attack: Number(archetype.attack), defense: Number(archetype.defense), speed: Number(archetype.speed) },
        growthAllocation: { vitality: 14, power: 14, guard: 13, agility: 13 },
    };
}
