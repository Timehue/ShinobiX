"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyTrainingGrant = applyTrainingGrant;
const _xp_engine_js_1 = require("../_xp-engine.js");
const _stat_growth_js_1 = require("../_stat-growth.js");
function applyTrainingGrant(character, stat, sealedGain, sealedXp) {
    const leveled = (0, _xp_engine_js_1.gainXp)(character, Math.max(0, Math.floor(sealedXp)));
    const cap = (0, _stat_growth_js_1.statCapForLevel)(Math.max(1, Number(leveled.level) || 1));
    const stats = { ...(leveled.stats ?? {}) };
    const current = Math.max(10, Math.floor(Number(stats[stat]) || 10));
    const next = Math.min(cap, current + Math.max(0, Math.floor(sealedGain)));
    const applied = Math.max(0, next - current);
    stats[stat] = next;
    return {
        character: {
            ...leveled,
            stats,
            totalStatsTrained: Math.max(0, Math.floor(Number(leveled.totalStatsTrained) || 0)) + applied,
        },
        applied,
        cap,
    };
}
