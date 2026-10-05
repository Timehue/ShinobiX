export const NAMED_FORGE_COST = 1000;

/** Shared by the Crafter UI and the authoritative settlement path. */
export const NAMED_FORGE_CURRENCY_POINTS = {
    fateShards: 5,
} as const;
export const NAMED_FORGE_FATE_SHARD_COST = NAMED_FORGE_COST / NAMED_FORGE_CURRENCY_POINTS.fateShards;

export type NamedForgeCurrency = keyof typeof NAMED_FORGE_CURRENCY_POINTS;
export type NamedForgeWallet = Partial<Record<NamedForgeCurrency | 'boneCharms' | 'auraStones' | 'mythicSeals', unknown>>;
export type NamedForgePayment = Readonly<Record<NamedForgeCurrency, number>>;

export function namedForgeFateShardTotal(wallet: NamedForgeWallet): number {
    const parsed = Number(wallet.fateShards);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

export function namedForgePointTotal(wallet: NamedForgeWallet): number {
    return namedForgeFateShardTotal(wallet) * NAMED_FORGE_CURRENCY_POINTS.fateShards;
}

/**
 * Only Fate Shards fund named gear. Preserve the existing five-point conversion.
 */
export function planNamedForgePayment(
    wallet: NamedForgeWallet,
    cost = NAMED_FORGE_COST,
): NamedForgePayment | null {
    if (!Number.isFinite(cost) || cost < 0) return null;
    const shards = cost / NAMED_FORGE_CURRENCY_POINTS.fateShards;
    if (!Number.isSafeInteger(shards) || namedForgeFateShardTotal(wallet) < shards) return null;
    return { fateShards: shards };
}

export function canPayNamedForge(wallet: NamedForgeWallet): boolean {
    return planNamedForgePayment(wallet) !== null;
}

export function debitNamedForgeWallet<T extends NamedForgeWallet>(wallet: T): T | null {
    const payment = planNamedForgePayment(wallet);
    if (!payment) return null;
    return { ...wallet, fateShards: namedForgeFateShardTotal(wallet) - payment.fateShards };
}
