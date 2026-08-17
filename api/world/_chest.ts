import { gainXp } from '../_xp-engine.js';
import { isWildSector, sectorBiomeOf } from '../../shared/sector-geo.js';
import { canAppendPackableChronicleCards } from '../card-clash/_collection-cap.js';

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

/*
 * Wild relics — the open-world chase drop.
 *
 * The `relic` slot's other occupants are handed out by the story (one per
 * Reckoning) or sold for 600 ryo, so they are the FLOOR of the pool. These are
 * the ceiling, and they have exactly TWO faucets — keep them out of every shop
 * and every other reward table:
 *   1. Ancient Chests, BIOME-LOCKED (below) — seven of the eight.
 *   2. The Weekly Boss — `relic-hollow-gate-cinder` only, top-10 cohort, 8% on a
 *      stable per-(week,boss,player) hash. See api/weekly-boss.ts.
 *
 * A duplicate pays DUPLICATE_RELIC_FATE_SHARDS instead of vanishing: these are
 * unique gear, so applyAncientChestLoot would otherwise silently swallow the
 * rarest roll in the game.
 *
 * SAFE BY CONSTRUCTION: a relic's combat power is stat bonuses (clamped by the
 * per-rank stat cap, so it cannot lift a capped fighter) plus PvE-ONLY
 * percentages that the PvP engine never reads at all. RNG buys speed toward the
 * shared ceiling in PvE, never a higher PvP ceiling. Do NOT add
 * damagePercent/absorb/reflect/lifesteal/shield to a relic — those apply in PvP
 * and sit OUTSIDE the stat cap, so luck would raise real PvP power.
 */
/**
 * Per-relic chance, per chest. Deliberately tiny — these are the game's rarest
 * drop. At the 23-chest daily cap, farming a single-relic biome is
 * 1-(1-0.0015)^23 ≈ 3.4% a day, so a specific relic averages roughly a month of
 * focused hunting. Tune HERE; everything else derives from it.
 */
export const WILD_RELIC_DROP_CHANCE = 0.0015;

/**
 * BIOME-LOCKED sourcing: a relic drops only where its lore says it came from, so
 * the world tells you where to hunt and a player can PURSUE one instead of
 * praying at a slot machine. Sector→biome comes from the shared world registry,
 * and rollAncientChestLoot already receives the sector, so this costs no new
 * plumbing.
 *
 * `relic-hollow-gate-cinder` is deliberately ABSENT — it fell out of a rift, not
 * out of the ground, and comes off the Weekly Boss instead (api/weekly-boss.ts).
 * Central carries three because it is half the map (30 of 66 wild sectors); each
 * still rolls at exactly WILD_RELIC_DROP_CHANCE, so no relic is rarer than
 * another by accident of geography.
 */
const RELICS_BY_BIOME: Readonly<Record<string, readonly string[]>> = {
    volcano: ['relic-ashfall-reliquary'],
    forest: ['relic-rootbound-effigy'],
    snow: ['relic-rimeglass-lens'],
    shadow: ['relic-umbral-knot'],
    central: ['relic-stormglass-pendulum', 'relic-gravewatch-fang', 'relic-drownstone-compass'],
};

/** Every relic a chest can yield, for tests and tooling. */
export const CHEST_RELIC_IDS: readonly string[] = Object.values(RELICS_BY_BIOME).flat();

/**
 * Payout for rolling a relic you already own. Relics are unique gear, so a second
 * copy is worthless — but the roll is the rarest event in the game and must never
 * pay nothing. 15 Fate Shards is a meaningful consolation without becoming a
 * reason to WANT the duplicate.
 */
export const DUPLICATE_RELIC_FATE_SHARDS = 15;

/**
 * The eight CHASE relics — the ones a duplicate should compensate for. Kept as an
 * explicit list rather than an `id.startsWith('relic-')` convention, which would
 * silently miss a relic named differently and silently include anything that ever
 * borrowed the prefix.
 *
 * Deliberately NOT every relic-slot item: `chakra-ring` sits in the chest's
 * ordinary RARE_GEAR pool, so a duplicate of it should behave like any other
 * duplicate gear (swallowed) rather than paying premium currency.
 */
export const WILD_RELIC_IDS: readonly string[] = [...CHEST_RELIC_IDS, 'relic-hollow-gate-cinder'];

function isRelicId(id: string): boolean {
    return WILD_RELIC_IDS.includes(id);
}

/**
 * The relic band for a sector: width scales with how many relics that biome
 * hosts, so each individual relic keeps the same per-chest chance.
 */
export function relicBandForSector(sector: number): { width: number; pool: readonly string[] } {
    const biome = String(sectorBiomeOf(sector) ?? '');
    const pool = RELICS_BY_BIOME[biome] ?? [];
    return { width: pool.length * WILD_RELIC_DROP_CHANCE, pool };
}

/**
 * Pick the relic from the winning roll's POSITION inside the band rather than
 * drawing again — that keeps the seeded sequence identical for every other
 * outcome, so this band changed no existing chest result.
 */
export function wildRelicForRoll(roll: number, sector: number): string | null {
    const { width, pool } = relicBandForSector(sector);
    if (pool.length === 0 || roll >= width) return null;
    const t = Math.max(0, Math.min(0.999999999, roll / width));
    return pool[Math.min(pool.length - 1, Math.floor(t * pool.length))];
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
    const inventory = Array.isArray(character.inventory)
        ? (character.inventory as unknown[]).filter((id): id is string => typeof id === 'string')
        : [];
    if (typeof rolled.itemId === 'string' && isRelicId(rolled.itemId) && inventory.includes(rolled.itemId)) {
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
