import { RELIC_ROSTER, RELICS_BY_ID, DUPLICATE_RELIC_SHARDS, ownsRelic } from '../../shared/relics.js';
import { gainXp } from '../_xp-engine.js';
import { isWildSector, sectorBiomeOf } from '../../shared/sector-geo.js';
import { canAppendPackableChronicleCards } from '../card-clash/_collection-cap.js';
import { WILD_BINDING_CHEST_DROP_CHANCE } from '../../shared/wild-binding.js';
import { isStepItemId } from '../../shared/gear-steps.js';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { npcSaleValue } from '../inventory/_sale.js';
import { CARD_DUPLICATE_CONVERSION } from '../card-clash/_pack.js';
import type { SettlementItem } from '../shop/_catalog.js';

export const DAILY_ANCIENT_CHEST_LIMIT = 23;
export type AncientChestLoot = {
    xp: number; ryo?: number; itemId?: string; cardId?: string;
    fateShards?: number; boneCharms?: number; auraStones?: number; auraDust?: number;
    /** Chronicle Points paid for a card already owned. */
    chroniclePoints?: number;
    /** Ryo, already counted inside `ryo`, paid for gear already owned: its NPC sale value. */
    duplicateSaleRyo?: number;
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

const CHEST_GEAR_IDS: ReadonlySet<string> = new Set([...COMMON_GEAR, ...RARE_GEAR]);
const RARE_CARD_IDS: ReadonlySet<string> = new Set(RARE_CARDS);

/**
 * Chest gear that stacks (the throwables and the Rejuvenation Potion) is never a
 * duplicate: one more unit always lands in its itemStacks count. It used to count
 * as owned unique gear, so a second Shuriken or Potion paid nothing (2026-10
 * item-use pass). The pet treats keep their own inventory[] path below.
 */
export function isStackedChestGear(itemId: string): boolean {
    return CHEST_GEAR_IDS.has(itemId) && ITEM_CATALOG[itemId]?.stackable === true;
}

/**
 * The NPC sale value owed for a chest gear roll the backpack already holds, else
 * 0 (economy rebalance 2026-10, framework #38: a completed roll never pays
 * nothing). It uses the same "owned" test as applyAncientChestLoot, so it pays
 * exactly where that drops the second copy. Relics keep their own Fate Shard
 * rule, and gear steps and stacking gear (isStackedChestGear) are always granted.
 * The value is the sale route's own (npcSaleValue), and a parity test holds it to
 * what /api/inventory/sell credits.
 */
export function chestDuplicateGearValue(character: Record<string, unknown>, itemId: string): number {
    if (!CHEST_GEAR_IDS.has(itemId) || isRelicId(itemId) || isStepItemId(itemId) || isStackedChestGear(itemId)) return 0;
    const inventory = Array.isArray(character.inventory) ? character.inventory as unknown[] : [];
    if (!inventory.includes(itemId)) return 0;
    const item = ITEM_CATALOG[itemId];
    if (!item) return 0;
    return npcSaleValue({ ...item, cost: Math.max(0, Math.floor(Number(item.cost) || 0)) } as SettlementItem);
}

/** Chronicle Points for a chest card already owned. The chest pools hold only
 *  common and rare cards, which convert like a surplus pack copy. */
export function chestDuplicateCardPoints(cardId: string): number {
    return CARD_DUPLICATE_CONVERSION[RARE_CARD_IDS.has(cardId) ? 'rare' : 'common'].chroniclePoints;
}

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

/**
 * Fold a gear step drop into a rolled chest. The step takes the place of the
 * usual item, card or shard roll, but never of a chase relic: that band is the
 * rarest outcome of the slot roll (0.15-0.3%) and the 5% step used to erase it
 * (2026-10 item-use pass). The Chakra Ring sits in the ordinary rare-gear band,
 * so a step still replaces it like any other gear roll.
 */
export function withChestStepDrop(loot: AncientChestLoot, stepId: string | null): AncientChestLoot {
    if (!stepId || (loot.itemId && CHEST_RELIC_IDS.includes(loot.itemId))) return loot;
    return { ...loot, itemId: stepId, cardId: undefined, fateShards: undefined, boneCharms: undefined, auraStones: undefined };
}

export function applyAncientChestLoot(character: Record<string, unknown>, loot: AncientChestLoot) {
    const leveled = gainXp(character, loot.xp) as Record<string, unknown>;
    const inventory = Array.isArray(leveled.inventory) ? (leveled.inventory as string[]) : [];
    const itemStacks = Array.isArray(leveled.itemStacks)
        ? leveled.itemStacks as Array<{ itemId: string; count: number }>
        : [];
    const tileCards = Array.isArray(leveled.tileCards) ? (leveled.tileCards as string[]) : [];
    const stackable = loot.itemId === 'pet-treat' || loot.itemId === 'elemental-pet-treat' || loot.itemId === 'ancient-pet-treat';
    // The Tempered Seal and stacking chest gear land in a counted itemStacks entry.
    const counted = loot.itemId === 'beast-seal-tempered' || (!!loot.itemId && isStackedChestGear(loot.itemId));
    const existingStack = itemStacks.find((stack) => stack.itemId === loot.itemId);
    return {
        ...leveled,
        ryo: Math.max(0, Number(leveled.ryo) || 0) + (loot.ryo ?? 0),
        fateShards: Math.max(0, Number(leveled.fateShards) || 0) + (loot.fateShards ?? 0),
        boneCharms: Math.max(0, Number(leveled.boneCharms) || 0) + (loot.boneCharms ?? 0),
        auraStones: Math.max(0, Number(leveled.auraStones) || 0) + (loot.auraStones ?? 0),
        auraDust: Math.max(0, Number(leveled.auraDust) || 0) + (loot.auraDust ?? 0),
        // Only when paid, so a save that never earned a Chronicle Point gains no key.
        ...(loot.chroniclePoints ? { chroniclePoints: Math.max(0, Number(leveled.chroniclePoints) || 0) + loot.chroniclePoints } : {}),
        // A gear step drop is always paid, even when a copy is already owned.
        inventory: loot.itemId && !counted && (stackable || isStepItemId(loot.itemId) || !inventory.includes(loot.itemId)) ? [...inventory, loot.itemId] : inventory,
        itemStacks: counted
            ? existingStack
                ? itemStacks.map((stack) => stack === existingStack ? { ...stack, count: Math.min(9999, stack.count + 1) } : stack)
                : [...itemStacks, { itemId: loot.itemId!, count: 1 }]
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
    // Duplicate gear pays its NPC sale value. The id stays in the loot so the
    // reveal can name the item; applyAncientChestLoot still skips the copy.
    const dupRyo = typeof rolled.itemId === 'string' ? chestDuplicateGearValue(character, rolled.itemId) : 0;
    if (dupRyo > 0) {
        const loot: AncientChestLoot = { ...rolled, ryo: (rolled.ryo ?? 0) + dupRyo, duplicateSaleRyo: dupRyo };
        return { character: applyAncientChestLoot(character, loot), loot };
    }
    // A duplicate card pays Chronicle Points, at the collection cap too: the cap's
    // Fate Shard replacement below is for a NEW card that has no room.
    if (typeof rolled.cardId === 'string' && tileCards.includes(rolled.cardId)) {
        const loot: AncientChestLoot = { ...rolled, chroniclePoints: (rolled.chroniclePoints ?? 0) + chestDuplicateCardPoints(rolled.cardId) };
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
