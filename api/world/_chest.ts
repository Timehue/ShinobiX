import { gainXp } from '../_xp-engine.js';
import { isWildSector } from '../../shared/sector-geo.js';

export const DAILY_ANCIENT_CHEST_LIMIT = 23;
export type AncientChestLoot = {
    xp: number; ryo?: number; itemId?: string; cardId?: string;
    fateShards?: number; boneCharms?: number; auraStones?: number; auraDust?: number;
};

const TREATS = ['pet-treat', 'elemental-pet-treat', 'ancient-pet-treat'] as const;
const cardIds = (ranges: Array<[number, number]>) => ranges.flatMap(([from, to]) =>
    Array.from({ length: to - from + 1 }, (_, i) => `tc-${String(from + i).padStart(2, '0')}`));
// Mirrors the rarity split in shared/tile-cards.ts — every common and every
// rare in the catalog, so a chest can drop the same card set the client's own
// roll used to. `tc-91`..`tc-95` were the five rares this table used to miss.
const COMMON_CARDS = cardIds([[1, 20], [51, 70]]);
const RARE_CARDS = cardIds([[21, 40], [71, 95]]);
// Mirrors the chest-eligible gear in shinobij.client/src/data/starter-items.ts
// (rarity common/rare, excluding the `item` slot). Kept in sync by the parity
// assertions in _chest.test.ts — the client used to pick at random from these,
// and this table previously collapsed each tier to a single fixed item.
const COMMON_GEAR = [
    'shinobi-vest', 'thrown-shuriken', 'cloth-hood', 'cloth-robe', 'cloth-sash', 'cloth-pants',
    'cloth-sandals', 'rustfang-kunai', 'training-katana', 'ash-wrapped-tanto',
    'rookie-chain-sickle', 'cracked-bone-dagger',
];
const RARE_GEAR = [
    'chakra-ring', 'thrown-senbon', 'thrown-serpent-dust', 'potion-rejuvenation', 'iron-kabuto',
    'rare-chest-plate', 'chain-obi', 'rare-greaves', 'rare-tabi', 'mistfang-tanto',
    'ashen-leaf-saber', 'riverbone-spear', 'iron-fang-knuckles', 'blue-thread-dagger',
];

export function rollAncientChestLoot(sectorRaw: unknown, random: () => number): AncientChestLoot | null {
    const sector = Math.floor(Number(sectorRaw));
    // Shared world registry, not a literal — see the note in _explore.ts.
    if (!isWildSector(sector)) return null;
    const unit = () => Math.max(0, Math.min(0.999999999, Number(random()) || 0));
    // Character XP is retired (leveling-without-xp map): the old xp line
    // (50 + sector·2) folds into a guaranteed ryo floor; the roll table below
    // is unchanged. `xp` stays in the shape as 0 for old clients.
    const loot: AncientChestLoot = { xp: 0, ryo: 40 + sector * 2 };
    if (unit() < 0.5) loot.ryo = (loot.ryo ?? 0) + 100 + Math.floor(unit() * 401);
    const roll = unit();
    if (roll < 0.2) loot.itemId = TREATS[Math.floor(unit() * TREATS.length)];
    else if (roll < 0.55) loot.itemId = COMMON_GEAR[Math.floor(unit() * COMMON_GEAR.length)];
    else if (roll < 0.65) loot.itemId = RARE_GEAR[Math.floor(unit() * RARE_GEAR.length)];
    else if (roll < 0.83) loot.cardId = COMMON_CARDS[Math.floor(unit() * COMMON_CARDS.length)];
    else if (roll < 0.92) loot.cardId = RARE_CARDS[Math.floor(unit() * RARE_CARDS.length)];
    else if (roll < 0.97) loot.fateShards = 1;
    else if (roll < 0.99) loot.boneCharms = 1;
    else loot.auraStones = 1;
    if (unit() < 0.2) loot.auraDust = 5 + Math.floor(unit() * 11);
    return loot;
}

export function applyAncientChestLoot(character: Record<string, unknown>, loot: AncientChestLoot) {
    const leveled = gainXp(character, loot.xp) as Record<string, unknown>;
    const inventory = Array.isArray(leveled.inventory) ? (leveled.inventory as string[]) : [];
    const tileCards = Array.isArray(leveled.tileCards) ? (leveled.tileCards as string[]) : [];
    const stackable = loot.itemId === 'pet-treat' || loot.itemId === 'elemental-pet-treat' || loot.itemId === 'ancient-pet-treat';
    return {
        ...leveled,
        ryo: Math.max(0, Number(leveled.ryo) || 0) + (loot.ryo ?? 0),
        fateShards: Math.max(0, Number(leveled.fateShards) || 0) + (loot.fateShards ?? 0),
        boneCharms: Math.max(0, Number(leveled.boneCharms) || 0) + (loot.boneCharms ?? 0),
        auraStones: Math.max(0, Number(leveled.auraStones) || 0) + (loot.auraStones ?? 0),
        auraDust: Math.max(0, Number(leveled.auraDust) || 0) + (loot.auraDust ?? 0),
        inventory: loot.itemId && (stackable || !inventory.includes(loot.itemId)) ? [...inventory, loot.itemId] : inventory,
        tileCards: loot.cardId && !tileCards.includes(loot.cardId) ? [...tileCards, loot.cardId] : tileCards,
    };
}
