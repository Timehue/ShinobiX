import { wildBindingSuccess } from '../../shared/wild-binding.js';

type Character = Record<string, unknown>;
type ItemStack = { itemId?: unknown; count?: unknown };

export function sealCount(character: Character, id: string): number {
    const inventory = Array.isArray(character.inventory) ? character.inventory : [];
    const stacks = Array.isArray(character.itemStacks) ? character.itemStacks as ItemStack[] : [];
    const stacked = stacks.reduce((sum, stack) => stack?.itemId === id
        ? sum + Math.max(0, Math.floor(Number(stack.count) || 0)) : sum, 0);
    return Math.min(9999, inventory.filter((item) => item === id).length + stacked);
}

/** One eligible attempt spends one seal, whether the capture roll succeeds or fails. */
export function resolveSealAttempt(character: Character, id: string, chance: number, roll: () => number):
    { character: Character; success: boolean } | null {
    if (sealCount(character, id) < 1) return null;
    const stacks = Array.isArray(character.itemStacks) ? character.itemStacks as ItemStack[] : [];
    let spent = false;
    const itemStacks = stacks.flatMap((stack) => {
        if (spent || stack?.itemId !== id || Number(stack.count) < 1) return [stack];
        spent = true;
        return Number(stack.count) > 1 ? [{ ...stack, count: Number(stack.count) - 1 }] : [];
    });
    const inventory = Array.isArray(character.inventory) ? character.inventory as string[] : [];
    const index = spent ? -1 : inventory.indexOf(id);
    return {
        character: {
            ...character,
            itemStacks,
            ...(index < 0 ? {} : { inventory: inventory.filter((_, i) => i !== index) }),
        },
        success: wildBindingSuccess(chance, roll()),
    };
}
