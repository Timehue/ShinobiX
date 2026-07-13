"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tickCombatCooldowns = tickCombatCooldowns;
const _utils_js_1 = require("../_utils.js");
function tickCombatCooldowns(cooldowns) {
    const next = {};
    for (const [key, turns] of Object.entries(cooldowns)) {
        if (turns > 1)
            (0, _utils_js_1.setSafeRecordValue)(next, key, turns - 1);
    }
    return next;
}
