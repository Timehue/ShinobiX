import { statusMatchesName } from "./tags";

export type CombatDisplayStatus = {
    name: string;
    percent?: number;
    activeRound?: number;
    rounds?: number;
    amount?: number;
    source?: string;
};

export type CombatActionAvailabilityInput = {
    statuses?: readonly CombatDisplayStatus[];
    round?: number;
    apModifierMode?: "stack" | "first-active";
    baseAp: number;
    availableAp: number;
    chakraCost?: number;
    availableChakra?: number;
    staminaCost?: number;
    availableStamina?: number;
    cooldownRemaining?: number;
    element?: string;
    actionsThisTurn?: number;
    maxActions?: number;
};

export type CombatActionAvailability = {
    apCost: number;
    chakraCost: number;
    staminaCost: number;
    sealed: boolean;
    onCooldown: boolean;
    actionLimitReached: boolean;
    affordable: boolean;
};

const BASIC_ELEMENTS = new Set(["Earth", "Wind", "Water", "Lightning", "Fire"]);

export const COMBAT_REJECTION_CODES = [
    "actor-defeated", "already-summoned", "bad-tile", "blocked", "cannot-act", "cannot-forfeit",
    "companion-cannot-summon", "down", "duplicate-move-token", "elementally-sealed", "enemy-cannot-summon",
    "friendly-fire", "invalid-action-type", "invalid-expected-version", "invalid-move", "invalid-move-token",
    "invalid-target", "match-not-found", "member-busy", "move-token-conflict", "no-ammo", "no-chakra",
    "no-companion", "no-item", "no-jutsu", "no-space", "no-stamina", "no-target", "no-weapon",
    "not-a-member", "not-adjacent", "not-your-turn", "objective-locked", "occupied", "on-cooldown",
    "out-of-ammo", "out-of-item", "out-of-range", "rejected", "retreat-sealed", "session-done",
    "session-not-active", "stale-version", "turn-expired", "unknown-action",
] as const;
export type CombatRejectionCode = typeof COMBAT_REJECTION_CODES[number];

const COMBAT_REJECTION_COPY = {
    "actor-defeated": "Your fighter can no longer act.",
    "already-summoned": "Your companion is already on the battlefield.",
    "bad-tile": "That tile is not a legal destination.",
    blocked: "That tile is blocked.",
    "cannot-act": "You need more AP or another action slot before acting.",
    "cannot-forfeit": "This match can no longer be forfeited.",
    "companion-cannot-summon": "A companion cannot summon another companion.",
    down: "That fighter can no longer act.",
    "duplicate-move-token": "That command was already received. Review the confirmed battlefield.",
    "elementally-sealed": "An Elemental Seal prevents that technique.",
    "enemy-cannot-summon": "That fighter cannot summon a companion.",
    "friendly-fire": "You cannot target an ally with that action.",
    "invalid-action-type": "That action is not available.",
    "invalid-expected-version": "That command could not be verified. Refresh the battlefield and try again.",
    "invalid-move": "That is not a legal move destination.",
    "invalid-move-token": "That command could not be verified. Try again.",
    "invalid-target": "That target is no longer valid. Choose a highlighted target.",
    "match-not-found": "That match is no longer available.",
    "member-busy": "Your fighter is already committed to another live battle.",
    "move-token-conflict": "That command identifier was already used. Try the action again.",
    "no-ammo": "You have no uses of that weapon left.",
    "no-chakra": "You do not have enough chakra.",
    "no-companion": "No companion is available to summon.",
    "no-item": "That item is not available.",
    "no-jutsu": "That technique is not available.",
    "no-space": "There is no open tile for your companion.",
    "no-stamina": "You do not have enough stamina.",
    "no-target": "Choose a valid highlighted target.",
    "no-weapon": "That weapon is not available.",
    "not-a-member": "You are not a member of this battle.",
    "not-adjacent": "Choose an adjacent open tile.",
    "not-your-turn": "The turn advanced before that command landed.",
    occupied: "That tile is occupied.",
    "objective-locked": "The objective is protecting that target for now.",
    "on-cooldown": "That action is still on cooldown.",
    "out-of-ammo": "You have no uses of that weapon left.",
    "out-of-item": "You have no uses of that item left.",
    "out-of-range": "That target is out of range.",
    rejected: "That action was not accepted. Choose another highlighted target.",
    "retreat-sealed": "Retreat is sealed in this encounter.",
    "session-done": "This battle has already ended.",
    "session-not-active": "This match is not active.",
    "stale-version": "The battlefield changed before that command landed. Review it and try again.",
    "turn-expired": "That turn expired before the command landed.",
    "unknown-action": "That action is not available.",
} satisfies Readonly<Record<CombatRejectionCode, string>>;

function activeDisplayStatuses(
    statuses: readonly CombatDisplayStatus[] | undefined,
    round?: number,
): readonly CombatDisplayStatus[] {
    if (round === undefined) return statuses ?? [];
    return (statuses ?? []).filter((status) => status.activeRound === undefined || status.activeRound <= round);
}

/** Mirrors the shared server resolver's Lag-then-Overclock AP adjustment. */
export function adjustedCombatApCost(
    statuses: readonly CombatDisplayStatus[] | undefined,
    base: number,
    round?: number,
): number {
    const active = activeDisplayStatuses(statuses, round);
    const lagPct = active
        .filter((status) => statusMatchesName(status, "Lag"))
        .reduce((sum, status) => sum + Number(status.percent ?? 20), 0);
    const overclockPct = active
        .filter((status) => statusMatchesName(status, "Overclock"))
        .reduce((sum, status) => sum + Number(status.percent ?? 20), 0);
    let cost = Math.max(0, Number(base) || 0);
    if (lagPct > 0) cost = Math.ceil(cost * (1 + (lagPct / 100)));
    if (overclockPct > 0) cost = Math.floor(cost * (1 - (overclockPct / 100)));
    return Math.max(1, cost);
}

/** Mirrors ordinary PvP authority, which uses the first active modifier of each kind. */
export function adjustedPvpCombatApCost(
    statuses: readonly CombatDisplayStatus[] | undefined,
    base: number,
    round?: number,
): number {
    const active = activeDisplayStatuses(statuses, round);
    const lag = active.find((status) => statusMatchesName(status, "Lag"));
    const overclock = active.find((status) => statusMatchesName(status, "Overclock"));
    let cost = Math.max(0, Number(base) || 0);
    if (lag) cost = Math.ceil(cost * (1 + (Number(lag.percent ?? 20) / 100)));
    if (overclock) cost = Math.floor(cost * (1 - (Number(overclock.percent ?? 20) / 100)));
    return Math.max(1, cost);
}

/** Mirrors the canonical resolver's five basic elements and active-round seal gate. */
export function isElementallySealedForDisplay(
    statuses: readonly CombatDisplayStatus[] | undefined,
    element: string | undefined,
    round?: number,
): boolean {
    if (!BASIC_ELEMENTS.has(String(element ?? ""))) return false;
    return activeDisplayStatuses(statuses, round).some((status) => statusMatchesName(status, "Elemental Seal"));
}

/**
 * Shared client affordance for server-authoritative paid combat actions. This is
 * deliberately presentation-only: the server still owns resolution, while every
 * control can derive the same adjusted AP, resource, cooldown, seal, and action-cap
 * gate without reimplementing the predicates in each render branch.
 */
export function combatActionAvailability({
    statuses,
    round,
    apModifierMode = "stack",
    baseAp,
    availableAp,
    chakraCost: rawChakraCost = 0,
    availableChakra,
    staminaCost: rawStaminaCost = 0,
    availableStamina,
    cooldownRemaining: rawCooldownRemaining = 0,
    element,
    actionsThisTurn,
    maxActions,
}: CombatActionAvailabilityInput): CombatActionAvailability {
    const apCost = apModifierMode === "first-active"
        ? adjustedPvpCombatApCost(statuses, baseAp, round)
        : adjustedCombatApCost(statuses, baseAp, round);
    const chakraCost = Math.max(0, Number(rawChakraCost) || 0);
    const staminaCost = Math.max(0, Number(rawStaminaCost) || 0);
    const sealed = isElementallySealedForDisplay(statuses, element, round);
    const onCooldown = Math.max(0, Number(rawCooldownRemaining) || 0) > 0;
    const actionLimitReached = maxActions !== undefined
        && actionsThisTurn !== undefined
        && actionsThisTurn >= maxActions;
    const hasChakra = availableChakra === undefined || availableChakra >= chakraCost;
    const hasStamina = availableStamina === undefined || availableStamina >= staminaCost;
    return {
        apCost,
        chakraCost,
        staminaCost,
        sealed,
        onCooldown,
        actionLimitReached,
        affordable: availableAp >= apCost
            && hasChakra
            && hasStamina
            && !sealed
            && !onCooldown
            && !actionLimitReached,
    };
}

/**
 * Returns server-authored barrier cells that are active this round. Tower callers
 * pass `tower-grid:` so an ordinary defensive Barrier status is never mistaken
 * for terrain; Solo PvE intentionally accepts every authored Barrier tile.
 */
export function activeBarrierTilesForDisplay(
    statuses: readonly CombatDisplayStatus[] | undefined,
    round: number,
    tileCount: number,
    sourcePrefix?: string,
): Set<number> {
    const tiles = new Set<number>();
    for (const status of activeDisplayStatuses(statuses, round)) {
        if (!statusMatchesName(status, "Barrier") || Number(status.rounds ?? 0) <= 0) continue;
        if (sourcePrefix && !String(status.source ?? "").startsWith(sourcePrefix)) continue;
        const tile = Number(status.amount);
        if (Number.isSafeInteger(tile) && tile >= 0 && tile < tileCount) tiles.add(tile);
    }
    return tiles;
}

/** Converts canonical reducer reason codes into concise player-facing live-region copy. */
export function combatRejectionMessage(reason: string | null | undefined): string {
    const value = String(reason ?? "").trim();
    if (!value) return "That command could not be completed.";
    const mapped = COMBAT_REJECTION_COPY[value.toLowerCase() as CombatRejectionCode];
    if (mapped) return mapped;
    // Transport failures already arrive as readable sentences; preserve their detail.
    if (/\s|[.!?]/.test(value)) return value;
    return "That command could not be completed. Choose another highlighted target.";
}

export function combatMethodLabel(method: string | undefined): string {
    if (method === "BURST" || method === "AOE_BURST" || method === "AOE_SPIRAL") return "Burst";
    if (method === "CIRCLE" || method === "AOE_CIRCLE" || method === "ALL") return "Circle";
    if (method === "INSTANT_EFFECT") return "Instant";
    return "Single";
}

export function combatTargetLabel(target: string | undefined): string {
    if (target === "SELF") return "Self";
    if (target === "EMPTY_GROUND") return "Ground";
    return "Enemy";
}
