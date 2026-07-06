"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tickCombatCooldowns = tickCombatCooldowns;
function tickCombatCooldowns(cooldowns) {
    const next = {};
    for (const [key, turns] of Object.entries(cooldowns)) {
        if (turns > 1)
            next[key] = turns - 1;
    }
    return next;
}
