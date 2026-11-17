/**
 * The Awakening Stone's paid rerolls: their prices and the outcomes they draw
 * from. api/awakening/_roll.ts rolls from these exact pools, and the Awakening
 * screen publishes them as odds before the player pays, so the published odds
 * cannot drift from the real roll. Every outcome in a pool is equally likely.
 */
export const AWAKENING_ELEMENTS = ['Water', 'Wind', 'Earth', 'Lightning', 'Fire'] as const;
export const AWAKENING_REROLL_COST = { single: 10, both: 15 } as const;

/**
 * A single reroll lands on an element the player does not hold, whichever
 * owned element it replaces (2026-10 economy rebalance: a paid roll never pays
 * for nothing).
 */
export function awakeningSingleRerollPool(owned: readonly string[]): string[] {
    return AWAKENING_ELEMENTS.filter((element) => !owned.includes(element));
}

/**
 * The ordered pairs a two-element reroll draws from: any two distinct elements
 * not among the preserved extras, except the pair already held, in either order.
 */
export function awakeningBothRerollPairs(owned: readonly string[]): string[][] {
    const preserved = owned.slice(2);
    const replaced = owned.slice(0, 2);
    const pool = AWAKENING_ELEMENTS.filter((element) => !preserved.includes(element));
    const pairs: string[][] = [];
    for (const a of pool) for (const b of pool) {
        if (a !== b && !(replaced.includes(a) && replaced.includes(b))) pairs.push([a, b]);
    }
    return pairs;
}

/** A uniform chance over `count` outcomes as a percent with at most one decimal (33.3, 25). */
export const awakeningOddsPercent = (count: number) => Math.round(1000 / count) / 10;

/**
 * The odds as plain sentences, shown on the screen and in the confirm dialog.
 * Empty when that reroll has nothing to land on (the server refuses it unpaid).
 */
export function awakeningRerollOddsText(owned: readonly string[], kind: 'single' | 'both'): string {
    if (kind === 'single') {
        const pool = awakeningSingleRerollPool(owned);
        if (!pool.length) return '';
        const names = pool.length > 1 ? `${pool.slice(0, -1).join(', ')} or ${pool[pool.length - 1]}` : pool[0];
        return `A single reroll gives ${names}, each with a ${awakeningOddsPercent(pool.length)}% chance.`;
    }
    // Both orders of a pair are drawn equally, so each unordered pair has the same chance.
    const pairs = awakeningBothRerollPairs(owned).length / 2;
    return pairs ? `Rerolling both gives one of the ${pairs} element pairs you do not hold, each with a ${awakeningOddsPercent(pairs)}% chance. Either element of the new pair is equally likely to be your primary.` : '';
}
