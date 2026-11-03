import type { CraftIngredient } from '../../../shared/crafting-recipes';

export type CraftChecklistState = 'missing' | 'partial' | 'done';
export type CraftChecklistRow = {
    /** Full recipe label, kept for the tooltip and screen readers. */
    label: string;
    /** Label without the trailing grade note; `orBetter` carries it instead. */
    name: string;
    orBetter: boolean;
    /** Owned count, capped at `need` so a full row reads 8/8, not 15/8. */
    have: number;
    need: number;
    /** Owned past what this craft needs. */
    extra: number;
    state: CraftChecklistState;
};

const STATE_ORDER: Record<CraftChecklistState, number> = { missing: 0, partial: 1, done: 2 };

/**
 * One row per ingredient, the ones still to gather first. Rows draw on stock in
 * recipe order the way planCraftIngredients does, so a material two rows accept
 * is never counted toward both.
 */
export function craftChecklistRows(ingredients: readonly CraftIngredient[], owned: (id: string) => number, quantity = 1): CraftChecklistRow[] {
    const spent: Record<string, number> = {};
    return ingredients.map(ingredient => {
        const need = ingredient.count * quantity;
        let have = 0;
        let total = 0;
        for (const id of ingredient.ids) {
            const available = Math.max(0, Math.floor(owned(id)) - (spent[id] ?? 0));
            const take = Math.min(need - have, available);
            if (take > 0) spent[id] = (spent[id] ?? 0) + take;
            have += take;
            total += available;
        }
        const orBetter = / or better$/.test(ingredient.label);
        return {
            label: ingredient.label,
            name: orBetter ? ingredient.label.replace(/ or better$/, '') : ingredient.label,
            orBetter,
            have,
            need,
            extra: Math.max(0, total - need),
            state: have >= need ? 'done' : have > 0 ? 'partial' : 'missing',
        } satisfies CraftChecklistRow;
    }).map((row, index) => ({ row, index }))
        .sort((a, b) => STATE_ORDER[a.row.state] - STATE_ORDER[b.row.state] || a.index - b.index)
        .map(({ row }) => row);
}
