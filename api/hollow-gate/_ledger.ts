import type { HollowGateRunToken, HgCurrencyKey } from './_run-token.js';

export const HOLLOW_GATE_LEDGER_ITEM_IDS = [
    'dungeon-legendary-fragment',
    'veil-of-the-hollow',
    'elemental-shard',
] as const;

export type HollowGateLedgerItemId = (typeof HOLLOW_GATE_LEDGER_ITEM_IDS)[number];

export type HollowGateRewardCredit = {
    currencies?: Partial<Record<HgCurrencyKey, number>>;
    items?: Partial<Record<HollowGateLedgerItemId, number>>;
};

export type HollowGateRewardLedger = {
    currencies: Partial<Record<HgCurrencyKey, number>>;
    items: Partial<Record<HollowGateLedgerItemId, number>>;
    sourceIds: string[];
};

const amount = (value: unknown): number => Math.max(0, Math.floor(Number(value) || 0));

export function setCountedItem(itemStacks: unknown, itemId: string, amountRaw: unknown): Array<Record<string, unknown>> {
    const target = amount(amountRaw);
    const stacks = Array.isArray(itemStacks) ? itemStacks as Array<Record<string, unknown>> : [];
    const next = stacks.filter((stack) => !stack || String(stack.itemId ?? '') !== itemId);
    return target ? [...next, { itemId, count: target }] : next;
}

export function normalizeHollowGateLedger(run: Pick<HollowGateRunToken, 'rewardLedger' | 'serverCreditedCurrencies'>): HollowGateRewardLedger {
    const stored = run.rewardLedger;
    return {
        currencies: { ...(stored?.currencies ?? run.serverCreditedCurrencies ?? {}) },
        items: { ...(stored?.items ?? {}) },
        sourceIds: Array.isArray(stored?.sourceIds)
            ? stored.sourceIds.filter((id): id is string => typeof id === 'string').slice(-511)
            : [],
    };
}

/** Add one server-derived reward source. Reusing the source identity is a no-op. */
export function creditHollowGateLedger(
    run: HollowGateRunToken,
    sourceId: string,
    credit: HollowGateRewardCredit,
): { ledger: HollowGateRewardLedger; alreadyCredited: boolean } {
    const ledger = normalizeHollowGateLedger(run);
    if (ledger.sourceIds.includes(sourceId)) return { ledger, alreadyCredited: true };
    const currencies = { ...ledger.currencies };
    const items = { ...ledger.items };
    for (const [key, value] of Object.entries(credit.currencies ?? {}) as Array<[HgCurrencyKey, unknown]>) {
        currencies[key] = amount(currencies[key]) + amount(value);
    }
    for (const [key, value] of Object.entries(credit.items ?? {}) as Array<[HollowGateLedgerItemId, unknown]>) {
        items[key] = amount(items[key]) + amount(value);
    }
    return {
        alreadyCredited: false,
        ledger: { currencies, items, sourceIds: [...ledger.sourceIds, sourceId].slice(-512) },
    };
}

/** Exact run-ledger reconciliation. Spending during the run is preserved, but a
 * browser can never retain more than entry + the server-recorded gain. */
export function reconcileLedgerAmount(current: unknown, entry: unknown, credited: unknown, retention = 1): number {
    const cur = amount(current);
    const baseline = amount(entry);
    const retained = Math.floor(amount(credited) * Math.max(0, Math.min(1, Number(retention) || 0)));
    return Math.min(cur, baseline + retained);
}

export function hollowGateDeathRetention(character: Record<string, unknown>): number {
    const attunement = character.hollowGateAttunement && typeof character.hollowGateAttunement === 'object'
        ? character.hollowGateAttunement as Record<string, unknown>
        : {};
    const greedyHands = Math.max(0, Math.min(3, Math.floor(Number(attunement['greedy-hands']) || 0)));
    return Math.min(0.8, 0.5 + greedyHands * 0.1);
}

export function multiplyHollowGateCurrencyCredit(credit: HollowGateRewardCredit, multiplierRaw: unknown): HollowGateRewardCredit {
    const multiplier = Math.max(1, Number(multiplierRaw) || 1);
    const currencies = Object.fromEntries(
        Object.entries(credit.currencies ?? {}).map(([key, value]) => [key, Math.floor(amount(value) * multiplier)]),
    ) as Partial<Record<HgCurrencyKey, number>>;
    return { ...credit, currencies };
}
