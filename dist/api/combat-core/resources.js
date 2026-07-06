"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adjustedApCost = adjustedApCost;
function adjustedApCost(base, modifiers = {}) {
    let cost = base;
    if (modifiers.lagPct !== undefined && modifiers.lagPct !== null) {
        cost = Math.ceil(cost * (1 + modifiers.lagPct / 100));
    }
    if (modifiers.overclockPct !== undefined && modifiers.overclockPct !== null) {
        cost = Math.floor(cost * (1 - modifiers.overclockPct / 100));
    }
    return Math.max(1, cost);
}
