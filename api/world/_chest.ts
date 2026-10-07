import { RELIC_ROSTER, RELICS_BY_ID, DUPLICATE_RELIC_SHARDS, ownsRelic } from '../../shared/relics.js';
import { gainXp } from '../_xp-engine.js';
import { isWildSector, sectorBiomeOf } from '../../shared/sector-geo.js';
import { canAppendPackableChronicleCards } from '../card-clash/_collection-cap.js';
import { WILD_BINDING_CHEST_DROP_CHANCE } from '../../shared/wild-binding.js';
import { isStepItemId } from '../../shared/gear-steps.js';

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

/** Legendary chest relic chance; Epic relics have a wider band in the roster. */
export const WILD_RELIC_DROP_CHANCE = 0.0015;
const chestRelics = RELIC_ROSTER.filter(item => item.source.kind === 'chest' && item.source.biome !== 'any');
export const CHEST_RELIC_IDS: readonly string[] = chestRelics.map(item => item.id);
export const WILD_RELIC_IDS: readonly string[] = [...CHEST_RELIC_IDS, 'relic-hollow-gate-cinder'];
export const DUPLICATE_RELIC_FATE_SHARDS = DUPLICATE_RELIC_SHARDS;
function isRelicId(id: string): boolean { return RELICS_BY_ID.has(id); }

export function relicBandForSector(sector: number): { width: number; pool: readonly string[] } {
    const pool = chestRelics.filter(item => item.source.kind === 'chest' && item.source.biome === sectorBiomeOf(sector));
    return { width: pool.reduce((sum, item) => sum + (item.source.kind === 'chest' ? item.source.chance : 0), 0), pool: pool.map(item => item.id) };
}

/** One weighted band; no second random draw, level gate, or retry reroll. */
export function wildRelicForRoll(roll: number, sector: number): string | null {
    if (!Number.isFinite(roll) || roll < 0 || roll >= 1) return null;
    let ceiling = 0;
    for (const item of chestRelics) {
        if (item.source.kind !== 'chest' || item.source.biome !== sectorBiomeOf(sector)) continue;
        ceiling += item.source.chance;
        if (roll < ceiling) return item.id;
    }
    return null;
}

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
    // The relic band is carved off the BOTTOM of the treats band, the most
    // abundant and least valuable slot, so nothing meaningful lost rate. Its width
    // depends on the sector's biome (see relicBandForSector), and a biome with no
    // relic simply has a zero-width band — that sector's chests behave exactly as
    // they did before relics existed.
    const relicId = wildRelicForRoll(roll, sector);
    if (relicId) loot.itemId = relicId;
    // Carve the Tempered Seal from the abundant treat band. The rare relic
    // band and every other reward band retain their original probability.
    else if (roll >= 0.2 - WILD_BINDING_CHEST_DROP_CHANCE && roll < 0.2) loot.itemId = 'beast-seal-tempered';
    else if (roll < 0.2) loot.itemId = TREATS[Math.floor(unit() * TREATS.length)];
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
    const itemStacks = Array.isArray(leveled.itemStacks)
        ? leveled.itemStacks as Array<{ itemId: string; count: number }>
        : [];
    const tileCards = Array.isArray(leveled.tileCards) ? (leveled.tileCards as string[]) : [];
    const stackable = loot.itemId === 'pet-treat' || loot.itemId === 'elemental-pet-treat' || loot.itemId === 'ancient-pet-treat';
    const tempered = loot.itemId === 'beast-seal-tempered';
    const existingTempered = itemStacks.find((stack) => stack.itemId === loot.itemId);
    return {
        ...leveled,
        ryo: Math.max(0, Number(leveled.ryo) || 0) + (loot.ryo ?? 0),
        fateShards: Math.max(0, Number(leveled.fateShards) || 0) + (loot.fateShards ?? 0),
        boneCharms: Math.max(0, Number(leveled.boneCharms) || 0) + (loot.boneCharms ?? 0),
        auraStones: Math.max(0, Number(leveled.auraStones) || 0) + (loot.auraStones ?? 0),
        auraDust: Math.max(0, Number(leveled.auraDust) || 0) + (loot.auraDust ?? 0),
        // A gear step drop is always paid, even when a copy is already owned.
        inventory: loot.itemId && !tempered && (stackable || isStepItemId(loot.itemId) || !inventory.includes(loot.itemId)) ? [...inventory, loot.itemId] : inventory,
        itemStacks: tempered
            ? existingTempered
                ? itemStacks.map((stack) => stack === existingTempered ? { ...stack, count: Math.min(9999, stack.count + 1) } : stack)
                : [...itemStacks, { itemId: 'beast-seal-tempered', count: 1 }]
            : itemStacks,
        tileCards: loot.cardId && !tileCards.includes(loot.cardId) ? [...tileCards, loot.cardId] : tileCards,
    };
}

/**
 * Resolve capacity before the chest receipt is written. A player at the card
 * ceiling receives an explicit Fate Shard replacement instead of being told a
 * card was granted only for a later full-save sanitizer to discard it.
 */
export function settleAncientChestLoot(character: Record<string, unknown>, rolled: AncientChestLoot): {
    character: Record<string, unknown>;
    loot: AncientChestLoot;
} {
    const tileCards = Array.isArray(character.tileCards)
        ? (character.tileCards as unknown[]).filter((id): id is string => typeof id === 'string')
        : [];
    // A DUPLICATE RELIC would otherwise be swallowed whole: applyAncientChestLoot
    // only appends a non-stackable id when the player does not already own it, so
    // landing the game's rarest drop twice used to pay literally nothing. Convert
    // it, same as the over-cap card below, so the roll is never wasted.
    if (typeof rolled.itemId === 'string' && isRelicId(rolled.itemId) && ownsRelic(character, rolled.itemId)) {
        const loot: AncientChestLoot = {
            ...rolled,
            itemId: undefined,
            fateShards: (rolled.fateShards ?? 0) + DUPLICATE_RELIC_FATE_SHARDS,
        };
        return { character: applyAncientChestLoot(character, loot), loot };
    }
    const addsUniqueCard = typeof rolled.cardId === 'string' && !tileCards.includes(rolled.cardId);
    if (!addsUniqueCard || canAppendPackableChronicleCards(tileCards, 1)) {
        return { character: applyAncientChestLoot(character, rolled), loot: rolled };
    }
    const loot: AncientChestLoot = {
        ...rolled,
        cardId: undefined,
        fateShards: (rolled.fateShards ?? 0) + 1,
    };
    return { character: applyAncientChestLoot(character, loot), loot };
}
