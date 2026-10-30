/*
 * Which hall takes which donation (2026-10-29).
 *
 * Both treasury-donate endpoints used to accept the same five currencies and
 * any item, so a player had no reason to pick one hall over the other, and half
 * of what the village took had nothing to spend it on.
 *
 * The Town Hall takes what a village war SPENDS. Ryo pays mercenary bands and
 * war preparations, Honor Seals pay upgrades and structures, Bone Charms pay
 * preparations, and supplies and hunt materials stock the Village Stores
 * (api/_treasury-stores-donate.ts).
 *
 * The Clan Hall takes what a small group KEEPS and hands round. Ryo pays clan
 * upgrades, Fate Shards and Aura Stones earn clan XP and leadership gifts them
 * to members, and loose items are the clan's shared bank. Ration packs go to
 * either hall: both kinds of war eat them, and the two share one daily cap, so a
 * pack is credited once.
 *
 * Mythic Seals go to neither. They have no faucet (standing ruling), a treasury
 * cannot gift them, and nothing in a treasury spends them.
 *
 * Shared by the server (which refuses) and both screens (which only offer what
 * the server takes), so the two lists cannot drift.
 */
import { PREP_BONE_CHARMS_PER_WR, RYO_PER_WR } from './war-treasury-costs.js';

export const VILLAGE_DONATION_CURRENCIES = ['ryo', 'honorSeals', 'boneCharms'] as const;
export const CLAN_DONATION_CURRENCIES = ['ryo', 'fateShards', 'auraStones'] as const;
export type VillageDonationCurrency = typeof VILLAGE_DONATION_CURRENCIES[number];
export type ClanDonationCurrency = typeof CLAN_DONATION_CURRENCIES[number];

const LABELS: Readonly<Record<string, string>> = {
    ryo: 'Ryo',
    honorSeals: 'Honor Seals',
    boneCharms: 'Bone Charms',
    fateShards: 'Fate Shards',
    auraStones: 'Aura Stones',
    mythicSeals: 'Mythic Seals',
};

/** Why the Town Hall refuses `currency`, or null when it takes it. */
export function villageDonationCurrencyRefusal(currency: string): string | null {
    if ((VILLAGE_DONATION_CURRENCIES as readonly string[]).includes(currency)) return null;
    if (currency === 'mythicSeals') return 'Mythic Seals cannot be donated. No treasury spends them.';
    if (currency === 'fateShards' || currency === 'auraStones') return `${LABELS[currency]} go to your clan treasury. The village takes ryo, Honor Seals, Bone Charms and supplies.`;
    return `Unsupported currency: ${currency}`;
}

/** Why the Clan Hall refuses `currency`, or null when it takes it. */
export function clanDonationCurrencyRefusal(currency: string): string | null {
    if ((CLAN_DONATION_CURRENCIES as readonly string[]).includes(currency)) return null;
    if (currency === 'mythicSeals') return 'Mythic Seals cannot be donated. No treasury spends them.';
    if (currency === 'boneCharms') return 'Bone Charms go to your village Town Hall, where they pay for war preparations.';
    if (currency === 'honorSeals') return 'Honor Seals go to the clan Seal Pool or your village Town Hall.';
    return `Unsupported currency: ${currency}`;
}

/** The Town Hall's refusal for an item the Village Stores did not take. */
export const VILLAGE_LOOSE_ITEM_REFUSAL = 'The village takes ration packs, supply goods and hunt materials. Donate other items to your clan treasury.';

/*
 * The ryo each village currency counts as toward Village Merit
 * (api/village/_village-merit.ts meritForDonation). Every unit used to count
 * as one ryo, so the Honor Seals that fund every village upgrade earned no
 * merit at all. Both rates come from prices the game already charges:
 *   - a Bone Charm is worth the treasury ryo a war preparation charges beside
 *     it (RYO_PER_WR / PREP_BONE_CHARMS_PER_WR = 500);
 *   - an Honor Seal is an eighth of that, the rate a war reward pays a
 *     non-Vanguard in Bone Charms instead of seals (api/war/_reward.ts).
 */
export const HONOR_SEALS_PER_BONE_CHARM = 8;
export const BONE_CHARM_DONATION_RYO_VALUE = RYO_PER_WR / PREP_BONE_CHARMS_PER_WR;
export const VILLAGE_DONATION_RYO_VALUE: Readonly<Record<VillageDonationCurrency, number>> = {
    ryo: 1,
    boneCharms: BONE_CHARM_DONATION_RYO_VALUE,
    honorSeals: BONE_CHARM_DONATION_RYO_VALUE / HONOR_SEALS_PER_BONE_CHARM,
};

/** Village Merit one donation can earn (api/village/_village-merit.ts). */
export const VILLAGE_MERIT_PER_DONATION_CAP = 25;

/** Ryo-value of a village currency donation, for Village Merit and contribution. */
export function villageCurrencyDonationRyoValue(currency: string, amount: number): number {
    const rate = VILLAGE_DONATION_RYO_VALUE[currency as VillageDonationCurrency] ?? 0;
    return Math.floor(Math.max(0, Math.floor(Number(amount) || 0)) * rate);
}

/*
 * The seated Kage can gift treasury Honor Seals back out untaxed and Bone Charms
 * at a 10% levy (api/_treasury-gift-tax.ts). Once a donated seal earned Merit,
 * a Kage and a friend could pass the same 200 seals back and forth and reach
 * the 250-Merit Kage-challenge gate in about 21 round trips, at no cost, and
 * the Legacy `villageDonations` count with it. So seals and charms earn Merit
 * and Legacy credit only up to a daily ryo-value allowance per donor. The
 * treasury still receives every seal and charm donated past it.
 *
 * 10,000 ryo-value is 160 seals, a little over a Vanguard's 150-a-day PvP seal
 * cap, so an honest day's seals still count in full. It is 10 Merit a day, half
 * of what the daily agenda pays for nothing. Ryo keeps its old uncapped basis:
 * every ryo gift is taxed.
 */
export const VILLAGE_RARE_MERIT_DAILY_RYO = 10_000;
export const VILLAGE_RARE_MERIT_DATE_FIELD = 'villageRareMeritDate';
export const VILLAGE_RARE_MERIT_VALUE_FIELD = 'villageRareMeritToday';

function nonNegative(value: unknown): number {
    const n = Math.floor(Number(value) || 0);
    return n > 0 ? n : 0;
}

/** Seal and charm ryo-value this donor has already had counted toward Merit today (UTC). */
export function villageRareMeritUsedToday(character: object, now: number = Date.now()): number {
    const c = character as Record<string, unknown>;
    return String(c[VILLAGE_RARE_MERIT_DATE_FIELD] ?? '') === new Date(now).toISOString().slice(0, 10)
        ? nonNegative(c[VILLAGE_RARE_MERIT_VALUE_FIELD]) : 0;
}

/**
 * The ryo-value of a currency donation that earns Village Merit and Legacy
 * credit, and the counter fields to write on the donor. Ryo counts in full and
 * writes nothing; seals and charms count up to what is left of today's
 * allowance.
 */
export function villageDonationMeritPlan(character: object, currency: string, amount: number, now: number = Date.now()): { ryoValue: number; stamp: Record<string, unknown> } {
    const value = villageCurrencyDonationRyoValue(currency, amount);
    if (currency === 'ryo') return { ryoValue: value, stamp: {} };
    const used = villageRareMeritUsedToday(character, now);
    const counted = Math.min(value, Math.max(0, VILLAGE_RARE_MERIT_DAILY_RYO - used));
    return {
        ryoValue: counted,
        stamp: { [VILLAGE_RARE_MERIT_DATE_FIELD]: new Date(now).toISOString().slice(0, 10), [VILLAGE_RARE_MERIT_VALUE_FIELD]: used + counted },
    };
}
