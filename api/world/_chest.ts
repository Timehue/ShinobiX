import { gainXp } from '../_xp-engine.js';

export const DAILY_ANCIENT_CHEST_LIMIT = 23;
export type AncientChestLoot = {
    xp: number; ryo?: number; itemId?: string; cardId?: string;
    fateShards?: number; boneCharms?: number; auraStones?: number; auraDust?: number;
};

const TREATS = ['pet-treat', 'elemental-pet-treat', 'ancient-pet-treat'] as const;
const COMMON_CARDS = [...Array.from({ length: 20 }, (_, i) => i + 1), ...Array.from({ length: 20 }, (_, i) => i + 51)]
    .map((n) => `tc-${String(n).padStart(2, '0')}`);
const RARE_CARDS = [...Array.from({ length: 20 }, (_, i) => i + 21), ...Array.from({ length: 20 }, (_, i) => i + 71)]
    .map((n) => `tc-${String(n).padStart(2, '0')}`);

export function rollAncientChestLoot(sectorRaw: unknown, random: () => number): AncientChestLoot | null {
    const sector = Math.floor(Number(sectorRaw));
    if (!Number.isFinite(sector) || sector < 1 || sector > 60) return null;
    const unit = () => Math.max(0, Math.min(0.999999999, Number(random()) || 0));
    // Character XP is retired (leveling-without-xp map): the old xp line
    // (50 + sector·2) folds into a guaranteed ryo floor; the roll table below
    // is unchanged. `xp` stays in the shape as 0 for old clients.
    const loot: AncientChestLoot = { xp: 0, ryo: 40 + sector * 2 };
    if (unit() < 0.5) loot.ryo = (loot.ryo ?? 0) + 100 + Math.floor(unit() * 401);
    const roll = unit();
    if (roll < 0.2) loot.itemId = TREATS[Math.floor(unit() * TREATS.length)];
    else if (roll < 0.55) loot.itemId = 'shinobi-vest';
    else if (roll < 0.65) loot.itemId = 'chakra-ring';
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
