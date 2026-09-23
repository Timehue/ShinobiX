/** Wild-pet binding balance. All thresholds use Resolve as a percentage of max. */
export const WILD_BINDING_SEALS = [
    { id: 'beast-seal-worn', name: 'Worn Beast Seal', resolveThreshold: 20, captureBonus: 0 },
    { id: 'beast-seal-reinforced', name: 'Reinforced Beast Seal', resolveThreshold: 35, captureBonus: 8 },
    { id: 'beast-seal-tempered', name: 'Tempered Beast Seal', resolveThreshold: 50, captureBonus: 16 },
    { id: 'beast-seal-master', name: 'Master Beast Seal', resolveThreshold: 65, captureBonus: 25 },
    { id: 'beast-seal-ancient', name: 'Ancient Beast Seal', resolveThreshold: 80, captureBonus: 30 },
] as const;

export type WildBindingSealId = typeof WILD_BINDING_SEALS[number]['id'];

export function wildBindingSeal(id: unknown) {
    return WILD_BINDING_SEALS.find((seal) => seal.id === id) ?? null;
}

/** A first release baseline. Keep the table centralized so live capture data can tune it. */
export const WILD_BINDING_BASE_CHANCE: Readonly<Record<string, number>> = {
    standard: 32,
    rare: 24,
    legendary: 18,
    mythic: 12,
};

export const WILD_BINDING_FOCUS_RESOLVE = 14;
export const WILD_BINDING_CHEST_DROP_CHANCE = 0.04;

/** Wild traits affect how the pet responds to battle choices, not capture odds. */
export const WILD_TRAIT_BEHAVIOR = {
    Loyal: { rest: 30, guard: 22, hitBonus: 0, hint: 'Calms quickly when you Rest; Guard also earns its trust.' },
    Aggressive: { rest: 10, guard: 12, hitBonus: 9, hint: 'Resists quiet approaches. Landing attacks lowers its Resolve faster.' },
    Guardian: { rest: 22, guard: 30, hitBonus: -5, hint: 'Responds best when your companion Guards.' },
    Swift: { rest: 14, guard: 16, hitBonus: 6, hint: 'Hard to settle by resting. A landed attack can stop its momentum.' },
    Lucky: { rest: 22, guard: 16, hitBonus: 0, hint: 'On every third battle turn, a useful action gives an extra opening.' },
    Battleborn: { rest: 12, guard: 12, hitBonus: 10, hint: 'Respects a landed attack more than Rest or Guard.' },
} as const;

export function wildTraitHint(trait: unknown): string | null {
    return typeof trait === 'string' && trait in WILD_TRAIT_BEHAVIOR
        ? WILD_TRAIT_BEHAVIOR[trait as keyof typeof WILD_TRAIT_BEHAVIOR].hint : null;
}

export function wildResolveLoss(input: {
    trait: unknown;
    kind: 'rest' | 'guard' | 'move' | 'super' | 'switch' | undefined;
    damage: number;
    maxHp: number;
    round: number;
    acted: boolean;
}): number {
    if (!input.acted) return 0;
    const behavior = typeof input.trait === 'string' && input.trait in WILD_TRAIT_BEHAVIOR
        ? WILD_TRAIT_BEHAVIOR[input.trait as keyof typeof WILD_TRAIT_BEHAVIOR] : null;
    const base = input.kind === 'rest' ? behavior?.rest ?? 22
        : input.kind === 'guard' ? behavior?.guard ?? 16
            : input.damage > 0 ? Math.round(12 + 18 * input.damage / Math.max(1, input.maxHp))
                + (behavior?.hitBonus ?? 0) : 0;
    return Math.max(0, base + (input.trait === 'Lucky' && base > 0 && input.round > 0 && input.round % 3 === 0 ? 8 : 0));
}

export function wildBindingChance(input: {
    rarity: string;
    hpPercent: number;
    resolvePercent: number;
    sealId: WildBindingSealId;
    statusBonus?: number;
    progressionBonus?: number;
}): number {
    const seal = wildBindingSeal(input.sealId);
    if (!seal) return 0;
    const hp = Math.max(0, Math.min(100, input.hpPercent));
    const resolve = Math.max(0, Math.min(100, input.resolvePercent));
    if (hp <= 0 || resolve > seal.resolveThreshold) return 0;
    const base = WILD_BINDING_BASE_CHANCE[input.rarity] ?? WILD_BINDING_BASE_CHANCE.standard;
    const status = Math.max(0, Math.min(10, input.statusBonus ?? 0));
    const progression = Math.max(0, Math.min(10, input.progressionBonus ?? 0));
    return Math.max(5, Math.min(95, Math.round(base + (100 - resolve) * 0.35
        + (100 - hp) * 0.12 + seal.captureBonus + status + progression)));
}

export function wildBindingOpportunity(chance: number): 'Very difficult' | 'Difficult' | 'Favorable' | 'Strong opportunity' | 'Excellent opportunity' {
    if (chance < 25) return 'Very difficult';
    if (chance < 45) return 'Difficult';
    if (chance < 65) return 'Favorable';
    if (chance < 85) return 'Strong opportunity';
    return 'Excellent opportunity';
}

/** Roll only after the chosen seal has passed ownership and Resolve checks. */
export function wildBindingSuccess(chance: number, roll: number): boolean {
    if (chance >= 100) return true;
    if (chance <= 0 || !Number.isFinite(roll)) return false;
    return Math.max(0, Math.min(0.999999999, roll)) * 100 < chance;
}
