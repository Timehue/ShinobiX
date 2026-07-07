/*
 * Reward-currency helpers — normalize / apply / format the bonus currency
 * payouts (fate shards, honor seals, bone charms, aura stones/dust, mythic
 * seals) attached to missions, hunts, bosses and events.
 *
 * Pure functions depending only on the type modules and lib/progression.
 * Extracted from App.tsx (Region A).
 */

import { displayCharacterXpGain } from "./progression";
import type { Character, RewardCurrencyKey, CurrencyRewards } from "../types/character";

export const rewardCurrencyOptions: Array<{ key: RewardCurrencyKey; label: string }> = [
    { key: "fateShards", label: "Fate Shards" },
    { key: "honorSeals", label: "Honor Seals" },
    { key: "boneCharms", label: "Bone Charms" },
    { key: "auraStones", label: "Aura Stones" },
    { key: "auraDust", label: "Aura Dust" },
    { key: "mythicSeals", label: "Mythic Seals" },
];

export function normalizeCurrencyRewards(rewards?: CurrencyRewards): CurrencyRewards {
    const normalized: CurrencyRewards = {};
    rewardCurrencyOptions.forEach(({ key }) => {
        const value = Math.max(0, Math.floor(Number(rewards?.[key] ?? 0)));
        if (value > 0) normalized[key] = value;
    });
    return normalized;
}

export function singleCurrencyReward(key: RewardCurrencyKey, amount: number): CurrencyRewards | undefined {
    const value = Math.max(0, Math.floor(Number(amount)));
    return value > 0 ? ({ [key]: value } as CurrencyRewards) : undefined;
}

export function firstCurrencyReward(rewards?: CurrencyRewards): { key: RewardCurrencyKey; amount: number } {
    const normalized = normalizeCurrencyRewards(rewards);
    const found = rewardCurrencyOptions.find(({ key }) => (normalized[key] ?? 0) > 0);
    return { key: found?.key ?? "fateShards", amount: found ? normalized[found.key] ?? 0 : 0 };
}

export function applyCurrencyRewards(character: Character, rewards?: CurrencyRewards): Character {
    const normalized = normalizeCurrencyRewards(rewards);
    return rewardCurrencyOptions.reduce<Character>((updated, { key }) => {
        const amount = normalized[key] ?? 0;
        return amount > 0 ? { ...updated, [key]: (updated[key] ?? 0) + amount } : updated;
    }, character);
}

export function formatCurrencyRewards(rewards?: CurrencyRewards): string {
    const normalized = normalizeCurrencyRewards(rewards);
    return rewardCurrencyOptions
        .filter(({ key }) => (normalized[key] ?? 0) > 0)
        .map(({ key, label }) => `+${normalized[key]} ${label}`)
        .join(" / ");
}

export interface RewardSummaryOptions {
    territoryScrolls?: number;
    items?: readonly string[];
    itemCount?: number;
    includeZero?: boolean;
}

function rewardAmount(value: unknown): number {
    const n = Math.floor(Number(value) || 0);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export function rewardSummaryParts(
    xp: number,
    ryo: number,
    stamina: number,
    rewards?: CurrencyRewards,
    character?: Pick<Character, "elderFocus">,
    options: RewardSummaryOptions = {},
): string[] {
    const parts: string[] = [];
    const xpShown = displayCharacterXpGain(xp, character);
    if (options.includeZero || rewardAmount(xpShown) > 0) parts.push(`+${xpShown} XP`);
    if (options.includeZero || rewardAmount(ryo) > 0) parts.push(`+${rewardAmount(ryo)} ryo`);
    if (options.includeZero || rewardAmount(stamina) > 0) parts.push(`+${rewardAmount(stamina)} stamina`);
    const currency = formatCurrencyRewards(rewards);
    if (currency) parts.push(currency);
    const scrolls = rewardAmount(options.territoryScrolls);
    if (scrolls > 0) parts.push(`+${scrolls} Territory Control Scroll${scrolls === 1 ? "" : "s"}`);
    const itemCount = rewardAmount(options.itemCount ?? options.items?.length ?? 0);
    if (itemCount > 0) {
        const namedItems = options.items?.filter(Boolean).slice(0, 3) ?? [];
        const itemLabel = namedItems.length > 0
            ? namedItems.join(", ") + (itemCount > namedItems.length ? ` +${itemCount - namedItems.length} more` : "")
            : `${itemCount} item${itemCount === 1 ? "" : "s"}`;
        parts.push(`+${itemLabel}`);
    }
    return parts;
}

export function rewardSummary(
    xp: number,
    ryo: number,
    stamina: number,
    rewards?: CurrencyRewards,
    character?: Pick<Character, "elderFocus">,
    options: RewardSummaryOptions = {},
): string {
    const parts = rewardSummaryParts(xp, ryo, stamina, rewards, character, options);
    return parts.length > 0 ? parts.join(" / ") : "No direct reward";
}
