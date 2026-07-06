"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCombatStatusActive = isCombatStatusActive;
exports.activeCombatStatuses = activeCombatStatuses;
exports.hasCombatStatus = hasCombatStatus;
exports.addCombatStatus = addCombatStatus;
exports.countActiveCombatStatuses = countActiveCombatStatuses;
exports.sumActiveCombatStatusPercent = sumActiveCombatStatusPercent;
exports.tickCombatStatuses = tickCombatStatuses;
exports.capCombatStatusStacks = capCombatStatusStacks;
const exactStatusNameMatches = (actual, expected) => actual === expected;
function isCombatStatusActive(status, round) {
    return status.activeRound === undefined || status.activeRound <= round;
}
function activeCombatStatuses(statuses, round) {
    return statuses.filter(status => isCombatStatusActive(status, round));
}
function hasCombatStatus(statuses, name, round, nameMatches = exactStatusNameMatches) {
    return activeCombatStatuses(statuses, round).some(status => nameMatches(status.name, name));
}
function addCombatStatus(statuses, status, opts = {}) {
    const durationFor = opts.durationFor ?? ((_name, fallback) => fallback);
    const nameMatches = opts.nameMatches ?? exactStatusNameMatches;
    const adjusted = { ...status, rounds: durationFor(status.name, status.rounds) };
    if (opts.isStackable?.(adjusted.name))
        return [...statuses, adjusted];
    return [...statuses.filter(existing => !nameMatches(existing.name, adjusted.name)), adjusted];
}
function countActiveCombatStatuses(statuses, name, round, nameMatches = exactStatusNameMatches) {
    return activeCombatStatuses(statuses, round).filter(status => nameMatches(status.name, name)).length;
}
function sumActiveCombatStatusPercent(statuses, name, round, fallback = 30, nameMatches = exactStatusNameMatches) {
    return activeCombatStatuses(statuses, round)
        .filter(status => nameMatches(status.name, name))
        .reduce((sum, status) => sum + (status.percent ?? fallback), 0);
}
function tickCombatStatuses(statuses, round) {
    return statuses
        .map(status => isCombatStatusActive(status, round) ? { ...status, rounds: status.rounds - 1 } : status)
        .filter(status => status.rounds > 0);
}
function capCombatStatusStacks(statuses, name, maxStacks, nameMatches = exactStatusNameMatches) {
    const matches = statuses.filter(status => nameMatches(status.name, name));
    if (matches.length <= maxStacks)
        return statuses;
    const keep = new Set(matches.map((status, index) => ({ status, index }))
        .sort((a, b) => ((b.status.amount ?? 0) - (a.status.amount ?? 0)) || (b.index - a.index))
        .slice(0, maxStacks)
        .map(entry => entry.status));
    return statuses.filter(status => !nameMatches(status.name, name) || keep.has(status));
}
