/*
 * Ranked Format — the equalized loadout shared by ranked 1v1 and ranked 2v2.
 *
 * Every ranked fighter enters with maxed stats, maximum HP/chakra/stamina, and
 * identical neutral legendary gear (armor/throwable/consumables). The one thing a player still chooses is
 * their weapon (picked from a small legendary set before queueing); their
 * bloodline and jutsu/technique loadout stay exactly theirs. This keeps ranked
 * outcomes about weapon choice + bloodline/jutsu skill, not who ground more
 * stats or owns better armor.
 *
 * `projectRankedFormatCharacter` produces a save-shaped character with only
 * `.stats` and `.equipment` overridden, then callers feed it into the SAME
 * `hydrateCharacterFromSave` (api/pvp/session.ts) every other combat mode
 * uses — so armor factor, bloodline multiplier, item passives, and vitals are
 * all derived by the one canonical code path instead of a second one that
 * could drift from it.
 */
import { MAX_STAT, STAT_CAP_FIELDS } from '../combat-core/formulas.js';
import { CHAKRA_CAP_V2, HP_CAP, STAMINA_CAP_V2 } from '../_xp-engine.js';

export const RANKED_FORMAT_MAX_STATS: Record<string, number> = Object.fromEntries(
    STAT_CAP_FIELDS.map((field) => [field, MAX_STAT] as const),
);

/** Every ranked battle uses the same fully restored combat-resource pools. */
export const RANKED_FORMAT_MAX_HP = HP_CAP;
export const RANKED_FORMAT_MAX_CHAKRA = CHAKRA_CAP_V2;
export const RANKED_FORMAT_MAX_STAMINA = STAMINA_CAP_V2;

/** The only legendary weapons a ranked fighter may bring — hand slot only. */
export const RANKED_FORMAT_LEGENDARY_WEAPON_IDS = [
    'black-lotus-dagger',
    'elderbranch-katana',
    'tempest-fang-blade',
    'frostfang-oathblade',
] as const;

export type RankedFormatWeaponId = typeof RANKED_FORMAT_LEGENDARY_WEAPON_IDS[number];

/** Used whenever a fighter never chose (or has an invalid) ranked weapon. */
export const RANKED_FORMAT_DEFAULT_WEAPON_ID: RankedFormatWeaponId = RANKED_FORMAT_LEGENDARY_WEAPON_IDS[0];

const RANKED_FORMAT_WEAPON_ID_SET: ReadonlySet<string> = new Set(RANKED_FORMAT_LEGENDARY_WEAPON_IDS);

export function isRankedFormatWeaponId(value: unknown): value is RankedFormatWeaponId {
    return typeof value === 'string' && RANKED_FORMAT_WEAPON_ID_SET.has(value);
}

/** Never trust a client-claimed weapon id — always resolve through this. */
export function resolveRankedFormatWeaponId(preferred: unknown): RankedFormatWeaponId {
    return isRankedFormatWeaponId(preferred) ? preferred : RANKED_FORMAT_DEFAULT_WEAPON_ID;
}

/**
 * Fixed neutral equipment for every ranked fighter, EXCLUDING `hand` (the
 * player-chosen weapon slot — callers add it themselves). The five armor
 * pieces are the "Ranked Seal" legendary set (see
 * shinobij.client/src/data/starter-items.ts): the same +30-all-stats
 * magnitude as every other legendary set, but with NO passive, so ranked
 * fights don't quietly gain an always-on combat effect that doesn't exist
 * anywhere else in the game. Consumables are the standard rare-tier kit
 * (Attack/Defense Pill, Smoke Bomb, Rejuvenation Potion) — real, existing
 * items, just guaranteed rather than inventory-dependent.
 */
export const RANKED_FORMAT_NEUTRAL_EQUIPMENT: Readonly<Record<string, string>> = {
    head: 'ranked-format-crown',
    body: 'ranked-format-mantle',
    waist: 'ranked-format-obi',
    legs: 'ranked-format-greaves',
    feet: 'ranked-format-sabatons',
    thrown: 'ranked-format-kunai',
    item1: 'item-attack-pill',
    item2: 'item-defense-pill',
    item3: 'item-smoke-bomb',
    potion: 'potion-rejuvenation',
};

/**
 * Per-battle charge count for the neutral kunai/pill/smoke-bomb slots —
 * matches the existing POTION_USES_PER_BATTLE pattern (api/pvp/session.ts).
 * Fixed, not owned-inventory-derived: nothing here is spent from a real
 * inventory, so there is no double-spend surface to defend against.
 */
export const RANKED_FORMAT_CONSUMABLE_CHARGES = 2;

/** Session stamp that distinguishes the neutral, non-inventory-backed kit. */
export const RANKED_FORMAT_VERSION = 1 as const;

/**
 * Seal fixed per-battle charges for the neutral kit. Every ranked fighter
 * gets the same counts regardless of what they actually own — this is what
 * lets ranked 1v1 turn throwables/consumables back ON (they were previously
 * zeroed outright to prevent double-spending a real, inventory-backed charge)
 * and what makes ranked 2v2 stop depending on each player's real stock.
 */
export function sealRankedFormatItemCharges(): Record<string, number> {
    return {
        [RANKED_FORMAT_NEUTRAL_EQUIPMENT.thrown]: RANKED_FORMAT_CONSUMABLE_CHARGES,
        [RANKED_FORMAT_NEUTRAL_EQUIPMENT.item1]: RANKED_FORMAT_CONSUMABLE_CHARGES,
        [RANKED_FORMAT_NEUTRAL_EQUIPMENT.item2]: RANKED_FORMAT_CONSUMABLE_CHARGES,
        [RANKED_FORMAT_NEUTRAL_EQUIPMENT.item3]: RANKED_FORMAT_CONSUMABLE_CHARGES,
        [RANKED_FORMAT_NEUTRAL_EQUIPMENT.potion]: RANKED_FORMAT_CONSUMABLE_CHARGES,
    };
}

/**
 * Verify the terminal charge/usage ledger for one ranked-format fighter.
 * Every granted neutral item must still be represented, every count must be
 * bounded, and remaining + used must equal the fixed starting allowance.
 * This lets durable ranked settlement accept the free neutral kit without
 * weakening its fail-closed handling of forged or legacy inventory usage.
 */
export function isValidRankedFormatItemLedger(
    remaining: Record<string, number> | undefined,
    used: Record<string, number>,
): boolean {
    if (!remaining) return false;
    const expected = new Set([
        RANKED_FORMAT_NEUTRAL_EQUIPMENT.thrown,
        RANKED_FORMAT_NEUTRAL_EQUIPMENT.item1,
        RANKED_FORMAT_NEUTRAL_EQUIPMENT.item2,
        RANKED_FORMAT_NEUTRAL_EQUIPMENT.item3,
        RANKED_FORMAT_NEUTRAL_EQUIPMENT.potion,
    ]);
    if (Object.keys(remaining).length !== expected.size) return false;
    if (Object.keys(used).some((id) => !expected.has(id))) return false;
    return [...expected].every((id) => {
        const left = Number(remaining[id]);
        const spent = used[id] === undefined ? 0 : Number(used[id]);
        return Number.isSafeInteger(left)
            && Number.isSafeInteger(spent)
            && left >= 0
            && spent >= 0
            && left + spent === RANKED_FORMAT_CONSUMABLE_CHARGES;
    });
}

/**
 * Project a save's `.character` into the ranked-format equalized shape:
 * maxed stats and combat resources + neutral gear + the fighter's own chosen
 * weapon. Everything else (name, level, equippedJutsuIds, equippedBloodlineId, legacy,
 * specialty, …) passes through untouched, so jutsu/bloodline resolution
 * downstream in hydrateCharacterFromSave still reads the fighter's real data.
 */
export function projectRankedFormatCharacter(
    saveCharacter: Record<string, unknown>,
    weaponId: RankedFormatWeaponId,
): Record<string, unknown> {
    return {
        ...saveCharacter,
        stats: { ...RANKED_FORMAT_MAX_STATS },
        hp: RANKED_FORMAT_MAX_HP,
        maxHp: RANKED_FORMAT_MAX_HP,
        chakra: RANKED_FORMAT_MAX_CHAKRA,
        maxChakra: RANKED_FORMAT_MAX_CHAKRA,
        stamina: RANKED_FORMAT_MAX_STAMINA,
        maxStamina: RANKED_FORMAT_MAX_STAMINA,
        equipment: { ...RANKED_FORMAT_NEUTRAL_EQUIPMENT, hand: weaponId },
    };
}
