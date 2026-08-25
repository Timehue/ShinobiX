export const NAMED_FORGE_COST = 1000;

/** Shared by the Crafter UI and the authoritative settlement path. */
export const NAMED_FORGE_CURRENCY_POINTS = {
    boneCharms: 2,
    fateShards: 5,
    auraStones: 15,
    mythicSeals: 75,
} as const;

export type NamedForgeCurrency = keyof typeof NAMED_FORGE_CURRENCY_POINTS;
export type NamedForgeWallet = Partial<Record<NamedForgeCurrency, unknown>>;
export type NamedForgePayment = Readonly<Record<NamedForgeCurrency, number>>;

const CURRENCY_ENTRIES = Object.entries(NAMED_FORGE_CURRENCY_POINTS) as Array<
    [NamedForgeCurrency, (typeof NAMED_FORGE_CURRENCY_POINTS)[NamedForgeCurrency]]
>;

function whole(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

export function namedForgePointTotal(wallet: NamedForgeWallet): number {
    return CURRENCY_ENTRIES.reduce(
        (total, [currency, points]) => total + whole(wallet[currency]) * points,
        0,
    );
}

/**
 * Finds a whole-material payment worth exactly the advertised forge cost.
 * A bounded subset solver is intentional: greedy rounding used to charge more
 * than 1,000 points for some mixed wallets. Earlier currencies win ties so the
 * forge continues to prefer common materials over Mythic Seals.
 */
export function planNamedForgePayment(
    wallet: NamedForgeWallet,
    cost = NAMED_FORGE_COST,
): NamedForgePayment | null {
    const target = Math.max(0, Math.floor(cost));
    if (target === 0) {
        return Object.fromEntries(CURRENCY_ENTRIES.map(([currency]) => [currency, 0])) as NamedForgePayment;
    }
    if (namedForgePointTotal(wallet) < target) return null;

    const plans: Array<number[] | undefined> = new Array(target + 1);
    plans[0] = CURRENCY_ENTRIES.map(() => 0);

    CURRENCY_ENTRIES.forEach(([currency, points], currencyIndex) => {
        const available = Math.min(whole(wallet[currency]), Math.floor(target / points));
        for (let unit = 0; unit < available; unit += 1) {
            for (let subtotal = target; subtotal >= points; subtotal -= 1) {
                if (plans[subtotal]) continue;
                const prior = plans[subtotal - points];
                if (!prior) continue;
                const next = [...prior];
                next[currencyIndex] += 1;
                plans[subtotal] = next;
            }
        }
    });

    const exact = plans[target];
    if (!exact) return null;
    return Object.fromEntries(
        CURRENCY_ENTRIES.map(([currency], index) => [currency, exact[index] ?? 0]),
    ) as NamedForgePayment;
}

export function canPayNamedForge(wallet: NamedForgeWallet): boolean {
    return planNamedForgePayment(wallet) !== null;
}

export function debitNamedForgeWallet<T extends NamedForgeWallet>(wallet: T): T | null {
    const payment = planNamedForgePayment(wallet);
    if (!payment) return null;
    const next = { ...wallet };
    for (const [currency] of CURRENCY_ENTRIES) {
        next[currency] = whole(wallet[currency]) - payment[currency];
    }
    return next;
}
