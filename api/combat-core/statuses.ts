import type { CombatStatus } from './types.js';

export type CombatStatusTiming = {
    activeRound?: number;
    inactiveRound?: number;
};

export type CombatStatusNameMatcher = (actual: string, expected: string) => boolean;

const exactStatusNameMatches: CombatStatusNameMatcher = (actual, expected) => actual === expected;

export function isCombatStatusActive(status: CombatStatusTiming, round: number): boolean {
    return (status.activeRound === undefined || status.activeRound <= round)
        && (status.inactiveRound === undefined || status.inactiveRound > round);
}

export function activeCombatStatuses<T extends CombatStatusTiming>(statuses: readonly T[], round: number): T[] {
    return statuses.filter(status => isCombatStatusActive(status, round));
}

/**
 * Remove only statuses of `kind` that are already active in `round`.
 *
 * Cleanup actions must preserve deferred effects: deleting an `activeRound =
 * round + 1` status before it can activate gives the round closer a cleanup
 * window that the opener does not receive for start-of-turn effects.
 */
export function removeActiveCombatStatusesByKind<T extends CombatStatus>(
    statuses: readonly T[],
    kind: T['kind'],
    round: number,
): { statuses: T[]; removed: T[] } {
    const removed = statuses.filter(status => status.kind === kind && isCombatStatusActive(status, round));
    return {
        statuses: statuses.filter(status => status.kind !== kind || !isCombatStatusActive(status, round)),
        removed,
    };
}

/** Consume statuses by name only when they are active in `round`. */
export function removeActiveCombatStatusesByName<T extends CombatStatus>(
    statuses: readonly T[],
    names: readonly string[],
    round: number,
    nameMatches: CombatStatusNameMatcher = exactStatusNameMatches,
): { statuses: T[]; removed: T[] } {
    const matches = (status: T) => names.some(name => nameMatches(status.name, name));
    const removed = statuses.filter(status => matches(status) && isCombatStatusActive(status, round));
    return {
        statuses: statuses.filter(status => !matches(status) || !isCombatStatusActive(status, round)),
        removed,
    };
}

export function hasCombatStatus<T extends CombatStatus>(
    statuses: readonly T[],
    name: string,
    round: number,
    nameMatches: CombatStatusNameMatcher = exactStatusNameMatches,
): boolean {
    return activeCombatStatuses(statuses, round).some(status => nameMatches(status.name, name));
}

export function addCombatStatus<T extends CombatStatus>(
    statuses: readonly T[],
    status: T,
    opts: {
        durationFor?: (name: string, fallback: number) => number;
        isStackable?: (name: string) => boolean;
        nameMatches?: CombatStatusNameMatcher;
        /** Enables gap-free replacement when the new status activates later. */
        currentRound?: number;
    } = {},
): T[] {
    const durationFor = opts.durationFor ?? ((_name: string, fallback: number) => fallback);
    const nameMatches = opts.nameMatches ?? exactStatusNameMatches;
    const adjusted = { ...status, rounds: durationFor(status.name, status.rounds) } as T;
    if (opts.isStackable?.(adjusted.name)) return [...statuses, adjusted];
    if (
        opts.currentRound !== undefined
        && adjusted.activeRound !== undefined
        && adjusted.activeRound > opts.currentRound
    ) {
        const activationRound = adjusted.activeRound;
        const retained = statuses.flatMap((existing): T[] => {
            if (!nameMatches(existing.name, adjusted.name)) return [existing];
            // Keep the currently-active copy through this round, but make it
            // invisible at the exact boundary where the refresh activates.
            if (isCombatStatusActive(existing, opts.currentRound!)) {
                return [{
                    ...existing,
                    inactiveRound: Math.min(existing.inactiveRound ?? activationRound, activationRound),
                } as T];
            }
            // A newer deferred refresh replaces an older pending copy.
            return [];
        });
        return [...retained, adjusted];
    }
    return [...statuses.filter(existing => !nameMatches(existing.name, adjusted.name)), adjusted];
}

export function countActiveCombatStatuses<T extends CombatStatus>(
    statuses: readonly T[],
    name: string,
    round: number,
    nameMatches: CombatStatusNameMatcher = exactStatusNameMatches,
): number {
    return activeCombatStatuses(statuses, round).filter(status => nameMatches(status.name, name)).length;
}

export function sumActiveCombatStatusPercent<T extends CombatStatus>(
    statuses: readonly T[],
    name: string,
    round: number,
    fallback = 30,
    nameMatches: CombatStatusNameMatcher = exactStatusNameMatches,
): number {
    return activeCombatStatuses(statuses, round)
        .filter(status => nameMatches(status.name, name))
        .reduce((sum, status) => sum + (status.percent ?? fallback), 0);
}

export function tickCombatStatuses<T extends CombatStatus>(statuses: readonly T[], round: number): T[] {
    return statuses
        .map(status => isCombatStatusActive(status, round) ? { ...status, rounds: status.rounds - 1 } as T : status)
        .filter(status => status.rounds > 0 && (status.inactiveRound === undefined || status.inactiveRound > round));
}

/**
 * Plan a stack cap for a future activation boundary without evicting stacks
 * that are still active in the current round. Pending losers can be dropped
 * immediately; current losers receive an `inactiveRound` boundary.
 */
export function capDeferredCombatStatusStacks<T extends CombatStatus>(
    statuses: readonly T[],
    name: string,
    maxStacks: number,
    currentRound: number,
    activationRound: number,
    nameMatches: CombatStatusNameMatcher = exactStatusNameMatches,
): T[] {
    const max = Math.max(0, Math.floor(maxStacks));
    const scheduledAtBoundary = (status: T) => (
        nameMatches(status.name, name)
        && status.rounds > 0
        && (status.activeRound === undefined || status.activeRound <= activationRound)
        && (status.inactiveRound === undefined || status.inactiveRound > activationRound)
        // Current one-round remnants expire at the boundary tick. Treat them as
        // losers now so they cannot reserve a future stack slot.
        && !(isCombatStatusActive(status, currentRound) && status.rounds <= 1)
    );
    const winners = new Set(
        statuses.map((status, index) => ({ status, index }))
            .filter(entry => scheduledAtBoundary(entry.status))
            .sort((a, b) => ((b.status.amount ?? 0) - (a.status.amount ?? 0)) || (b.index - a.index))
            .slice(0, max)
            .map(entry => entry.status),
    );

    return statuses.flatMap((status): T[] => {
        if (!nameMatches(status.name, name) || winners.has(status)) return [status];
        if (isCombatStatusActive(status, currentRound)) {
            return [{
                ...status,
                inactiveRound: Math.min(status.inactiveRound ?? activationRound, activationRound),
            } as T];
        }
        // Drop a losing pending/stale copy, but leave a later-future schedule
        // untouched because this boundary does not govern it yet.
        if (status.activeRound === undefined || status.activeRound <= activationRound) return [];
        return [status];
    });
}

export function capCombatStatusStacks<T extends CombatStatus>(
    statuses: readonly T[],
    name: string,
    maxStacks: number,
    nameMatches: CombatStatusNameMatcher = exactStatusNameMatches,
): readonly T[] {
    const matches = statuses.filter(status => nameMatches(status.name, name));
    if (matches.length <= maxStacks) return statuses;
    const keep = new Set(
        matches.map((status, index) => ({ status, index }))
            .sort((a, b) => ((b.status.amount ?? 0) - (a.status.amount ?? 0)) || (b.index - a.index))
            .slice(0, maxStacks)
            .map(entry => entry.status),
    );
    return statuses.filter(status => !nameMatches(status.name, name) || keep.has(status));
}
