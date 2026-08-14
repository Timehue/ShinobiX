import { combatActionAvailability, type CombatDisplayStatus } from "./combat-action-display";

type PvpPaidJutsu = {
    id?: string;
    ap?: number;
    chakraCost?: number;
    staminaCost?: number;
    element?: string;
};

type PvpPaidItem = {
    id?: string;
    name?: string;
    slot?: string;
    apCost?: number;
};

export type PvpPaidActionSnapshot = {
    statuses?: readonly CombatDisplayStatus[];
    round: number;
    availableAp: number;
    availableChakra: number;
    availableStamina: number;
    cooldowns: Readonly<Record<string, number>>;
    actionsThisTurn: number;
    jutsu: readonly PvpPaidJutsu[];
    items: readonly PvpPaidItem[];
    itemCharges?: Readonly<Record<string, number>>;
    rankedItemsDisabled?: boolean;
};

function normalizedSlot(slot: string | undefined): "hand" | "thrown" | "item" | "other" {
    const value = String(slot ?? "").trim().toLowerCase();
    if (value === "hand" || value === "weapon") return "hand";
    if (value === "thrown" || value === "throwing") return "thrown";
    if (value === "item" || value === "potion" || value === "consumable") return "item";
    return "other";
}

/**
 * Current-snapshot paid-action check for ordinary PvP auto-pass. Target/range
 * legality remains owned by the board interactions and server; this function
 * covers every deterministic affordability gate available in the session.
 */
export function hasAffordablePvpPaidAction(input: PvpPaidActionSnapshot): boolean {
    const availability = (
        baseAp: number,
        options: {
            chakraCost?: number;
            staminaCost?: number;
            cooldownRemaining?: number;
            element?: string;
            apModifierMode?: "stack" | "first-active";
        } = {},
    ) => combatActionAvailability({
        statuses: input.statuses,
        round: input.round,
        apModifierMode: "first-active",
        baseAp,
        availableAp: input.availableAp,
        availableChakra: input.availableChakra,
        availableStamina: input.availableStamina,
        actionsThisTurn: input.actionsThisTurn,
        maxActions: 5,
        ...options,
    });

    if (availability(30).affordable) return true; // Move
    if (availability(40, { staminaCost: 10 }).affordable) return true; // Attack
    if (availability(60, { chakraCost: 10, cooldownRemaining: input.cooldowns.basicHeal ?? 0 }).affordable) return true;
    if (availability(60, { cooldownRemaining: input.cooldowns.clear ?? 0 }).affordable) return true;
    if (availability(60, { cooldownRemaining: input.cooldowns.cleanse ?? 0 }).affordable) return true;
    if (availability(100).affordable) return true; // Flee

    if (input.jutsu.some((jutsu) => availability(jutsu.ap ?? 40, {
        apModifierMode: "stack",
        chakraCost: jutsu.chakraCost ?? 0,
        staminaCost: jutsu.staminaCost ?? 0,
        cooldownRemaining: jutsu.id ? input.cooldowns[jutsu.id] ?? 0 : 0,
        element: jutsu.element,
    }).affordable)) return true;

    return input.items.some((item) => {
        const slot = normalizedSlot(item.slot);
        if (slot === "other") return false;
        if (input.rankedItemsDisabled && slot !== "hand") return false;
        const id = item.id ?? "";
        if (slot !== "hand" && id && (input.itemCharges?.[id] ?? 1) <= 0) return false;
        const cooldownKey = id || item.name || "";
        return availability(item.apCost ?? (slot === "item" ? 35 : 40), {
            cooldownRemaining: cooldownKey ? input.cooldowns[cooldownKey] ?? 0 : 0,
        }).affordable;
    });
}
