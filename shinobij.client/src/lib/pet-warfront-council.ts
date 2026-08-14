import type { ArenaRole } from "./pet-arena-sim";
import {
    WF_STACK_CAP,
    type WarfrontChoice,
    type WfBuildPackage,
    type WfPowerupKind,
} from "./pet-warfront-sim";

export type WfCouncilBuyState = Array<{
    petId: string;
    petName: string;
    role: ArenaRole;
    stacks: Record<WfPowerupKind, number>;
    costs: Record<WfPowerupKind, number>;
}>;

const PACKAGE_PLAN: Record<WfBuildPackage, { roles: readonly ArenaRole[]; kinds: readonly WfPowerupKind[] }> = {
    "hold-line": { roles: ["defender", "sage", "tracker", "assassin"], kinds: ["guard", "vitality"] },
    "blood-hunt": { roles: ["assassin", "tracker", "sage", "defender"], kinds: ["strike", "swift"] },
    "escort-rite": { roles: ["sage", "defender", "tracker", "assassin"], kinds: ["mend", "vitality"] },
};

export function councilPackageChoices(buyState: WfCouncilBuyState, choice: WfBuildPackage, budget = Number.POSITIVE_INFINITY): WarfrontChoice[] {
    const plan = PACKAGE_PLAN[choice];
    let petIndex = 0;
    for (const role of plan.roles) {
        const match = buyState.findIndex((pet) => pet.role === role);
        if (match >= 0) { petIndex = match; break; }
    }
    const pet = buyState[petIndex];
    if (!pet) return [];
    const choices: WarfrontChoice[] = [];
    let spent = 0;
    for (const kind of plan.kinds) {
        if (pet.stacks[kind] >= WF_STACK_CAP) continue;
        const price = pet.costs[kind];
        if (spent + price > budget) continue;
        choices.push({ petIndex, kind });
        spent += price;
    }
    return choices;
}

export function councilCartCost(buyState: WfCouncilBuyState, cart: readonly WarfrontChoice[]): number {
    const counts = new Map<string, number>();
    let total = 0;
    for (const choice of cart) {
        const pet = buyState[choice.petIndex];
        if (!pet) continue;
        const key = `${choice.petIndex}:${choice.kind}`;
        const extra = counts.get(key) ?? 0;
        let price = pet.costs[choice.kind];
        for (let index = 0; index < extra; index++) price = Math.round(price * 1.35 / 5) * 5;
        total += price;
        counts.set(key, extra + 1);
    }
    return total;
}

export const visiblePackageActivationLabel = (count: number): string =>
    `${count} visible activation${count === 1 ? "" : "s"}`;
