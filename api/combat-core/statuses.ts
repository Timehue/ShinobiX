import type { CombatStatus } from './types.js';

export type CombatStatusTiming = {
    activeRound?: number;
};

export type CombatStatusNameMatcher = (actual: string, expected: string) => boolean;

const exactStatusNameMatches: CombatStatusNameMatcher = (actual, expected) => actual === expected;

export function isCombatStatusActive(status: CombatStatusTiming, round: number): boolean {
    return status.activeRound === undefined || status.activeRound <= round;
}

export function activeCombatStatuses<T extends CombatStatusTiming>(statuses: readonly T[], round: number): T[] {
    return statuses.filter(status => isCombatStatusActive(status, round));
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
    } = {},
): T[] {
    const durationFor = opts.durationFor ?? ((_name: string, fallback: number) => fallback);
    const nameMatches = opts.nameMatches ?? exactStatusNameMatches;
    const adjusted = { ...status, rounds: durationFor(status.name, status.rounds) } as T;
    if (opts.isStackable?.(adjusted.name)) return [...statuses, adjusted];
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
        .filter(status => status.rounds > 0);
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
