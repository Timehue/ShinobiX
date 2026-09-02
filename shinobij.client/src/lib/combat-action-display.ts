import { statusMatchesName } from "./tags";

export type CombatDisplayStatus = {
    name: string;
    percent?: number;
    activeRound?: number;
    inactiveRound?: number;
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

export function activeCombatDisplayStatuses<TStatus extends CombatDisplayStatus>(
    statuses: readonly TStatus[] | undefined,
    round?: number,
): readonly TStatus[] {
    if (round === undefined) return statuses ?? [];
    return (statuses ?? []).filter((status) => (
        (status.activeRound === undefined || status.activeRound <= round)
        && (status.inactiveRound === undefined || status.inactiveRound > round)
    ));
}

/** Splits a sealed snapshot into mechanically live, deferred, and retired effects. */
export function partitionCombatDisplayStatuses<TStatus extends CombatDisplayStatus>(
    statuses: readonly TStatus[],
    round?: number,
): { active: readonly TStatus[]; pending: readonly TStatus[]; retired: readonly TStatus[] } {
    if (round === undefined) return { active: statuses, pending: [], retired: [] };
    return {
        active: activeCombatDisplayStatuses(statuses, round),
        pending: statuses.filter((status) => (
            (status.inactiveRound === undefined || status.inactiveRound > round)
            && status.activeRound !== undefined
            && status.activeRound > round
        )),
        retired: statuses.filter((status) => status.inactiveRound !== undefined && status.inactiveRound <= round),
    };
}

/**
 * Flat AP swing of the two tempo tags — KEEP IN SYNC with TEMPO_AP_SWING in
 * api/combat-core/resources.ts, which is the server's authority. Duplicated
 * rather than imported: this module is the presentation mirror and stays free
 * of the api/ import chain.
 */
export const TEMPO_AP_SWING = 10;

/**
 * Mirrors the shared server resolver's Lag-then-Overclock AP adjustment.
 *
 * Both tags are a FLAT ±TEMPO_AP_SWING, so only PRESENCE matters — the stored
 * percent is never read and a second stack cannot deepen the swing. That makes
 * the old "sum every stack" and "use the first stack" mirrors identical, which
 * is why adjustedPvpCombatApCost now just delegates here.
 */
export function adjustedCombatApCost(
    statuses: readonly CombatDisplayStatus[] | undefined,
    base: number,
    round?: number,
): number {
    const active = activeCombatDisplayStatuses(statuses, round);
    let cost = Math.max(0, Number(base) || 0);
    if (active.some((status) => statusMatchesName(status, "Lag"))) cost += TEMPO_AP_SWING;
    if (active.some((status) => statusMatchesName(status, "Overclock"))) cost -= TEMPO_AP_SWING;
    return Math.max(1, cost);
}

/**
 * Mirrors ordinary PvP authority. Kept as a distinct export because callers
 * branch on runtime, but the flat swing makes it identical to the shared mirror.
 */
export function adjustedPvpCombatApCost(
    statuses: readonly CombatDisplayStatus[] | undefined,
    base: number,
    round?: number,
): number {
    return adjustedCombatApCost(statuses, base, round);
}

/** Mirrors the canonical resolver's five basic elements and active-round seal gate. */
export function isElementallySealedForDisplay(
    statuses: readonly CombatDisplayStatus[] | undefined,
    element: string | undefined,
    round?: number,
): boolean {
    if (!BASIC_ELEMENTS.has(String(element ?? ""))) return false;
    return activeCombatDisplayStatuses(statuses, round).some((status) => statusMatchesName(status, "Elemental Seal"));
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
    for (const status of activeCombatDisplayStatuses(statuses, round)) {
        if (!statusMatchesName(status, "Barrier") || Number(status.rounds ?? 0) <= 0) continue;
        if (sourcePrefix && !String(status.source ?? "").startsWith(sourcePrefix)) continue;
        const tile = Number(status.amount);
        if (Number.isSafeInteger(tile) && tile >= 0 && tile < tileCount) tiles.add(tile);
    }
    return tiles;
}

/**
 * Chooses the ward VFX from effects that are mechanically active this round.
 * Deferred jutsu statuses are present in the authoritative snapshot immediately,
 * but must not look live until their `activeRound` begins.
 */
export function pvpCombatWardKey(
    fighter: { shield: number; statuses?: readonly CombatDisplayStatus[] },
    round: number,
): "shield" | "reflect" | "absorb" | null {
    const active = activeCombatDisplayStatuses(fighter.statuses, round);
    if (fighter.shield > 0 || active.some((status) => statusMatchesName(status, "Shield") || statusMatchesName(status, "Barrier"))) return "shield";
    if (active.some((status) => statusMatchesName(status, "Reflect"))) return "reflect";
    if (active.some((status) => statusMatchesName(status, "Absorb"))) return "absorb";
    return null;
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
