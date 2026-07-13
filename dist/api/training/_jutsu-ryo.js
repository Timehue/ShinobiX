"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.jutsuRyoTrainingCap = exports.jutsuRyoTrainingDuration = exports.jutsuRyoTrainingCost = void 0;
exports.currentJutsuLevel = currentJutsuLevel;
exports.applyJutsuLevel = applyJutsuLevel;
exports.startJutsuRyoTraining = startJutsuRyoTraining;
exports.settleJutsuRyoTraining = settleJutsuRyoTraining;
const formulas_js_1 = require("../combat-core/formulas.js");
const whole = (value) => Math.max(0, Math.floor(Number(value) || 0));
const jutsuRyoTrainingCost = (levelRaw) => {
    const level = whole(levelRaw);
    return level < 10 ? 2500 + level * 500 : 8000 + Math.max(0, level - 10) * 1200;
};
exports.jutsuRyoTrainingCost = jutsuRyoTrainingCost;
const jutsuRyoTrainingDuration = (levelRaw, bonusPctRaw) => {
    const base = whole(levelRaw) < 10 ? 10 * 60_000 : 30 * 60_000;
    const bonus = Math.max(0, Math.min(60, Number(bonusPctRaw) || 0));
    return Math.max(60_000, Math.floor(base * (1 - bonus / 100)));
};
exports.jutsuRyoTrainingDuration = jutsuRyoTrainingDuration;
const jutsuRyoTrainingCap = (characterLevel) => Math.min(30, (0, formulas_js_1.jutsuLevelCapForLevel)(Math.max(1, whole(characterLevel))));
exports.jutsuRyoTrainingCap = jutsuRyoTrainingCap;
function masteries(character) {
    return Array.isArray(character.jutsuMastery)
        ? character.jutsuMastery.filter((row) => !!row && typeof row === 'object' && typeof row.jutsuId === 'string')
        : [];
}
function currentJutsuLevel(character, jutsuId) {
    return whole(masteries(character).find((row) => row.jutsuId === jutsuId)?.level);
}
function applyJutsuLevel(character, jutsuId, requestedLevel) {
    const rows = masteries(character);
    const current = rows.find((row) => row.jutsuId === jutsuId);
    const level = Math.max(whole(current?.level), Math.min((0, exports.jutsuRyoTrainingCap)(character.level), whole(requestedLevel)));
    return { ...character, jutsuMastery: [...rows.filter((row) => row.jutsuId !== jutsuId), { jutsuId, level, xp: whole(current?.xp) }] };
}
function startJutsuRyoTraining(character, jutsuId, label, token, now, bonusPct) {
    const fromLevel = currentJutsuLevel(character, jutsuId);
    const cap = (0, exports.jutsuRyoTrainingCap)(character.level);
    if (fromLevel >= cap)
        return { ok: false, reason: 'jutsu-at-training-cap' };
    if (fromLevel === 0)
        return { ok: true, character: applyJutsuLevel(character, jutsuId, 1), active: null, cost: 0 };
    const cost = (0, exports.jutsuRyoTrainingCost)(fromLevel);
    if (whole(character.ryo) < cost)
        return { ok: false, reason: 'not-enough-ryo' };
    const duration = (0, exports.jutsuRyoTrainingDuration)(fromLevel, bonusPct);
    const active = { serverToken: token, jutsuId, label: label.slice(0, 80), fromLevel, toLevel: fromLevel + 1, ryoCost: cost, startedAt: now, endsAt: now + duration };
    return { ok: true, character: { ...character, ryo: whole(character.ryo) - cost }, active, cost };
}
function settleJutsuRyoTraining(character, active, action, now) {
    if (action === 'complete') {
        if (now < active.endsAt)
            return { ok: false, reason: 'training-not-finished' };
        return { ok: true, character: applyJutsuLevel(character, active.jutsuId, active.toLevel), active: null, cost: 0, refund: 0 };
    }
    if (action === 'cancel') {
        const refund = Math.floor(whole(active.ryoCost) * 0.5);
        return { ok: true, character: { ...character, ryo: whole(character.ryo) + refund }, active: null, cost: 0, refund };
    }
    const finishCost = Math.max(0, Math.ceil(Math.max(0, active.endsAt - now) / 60_000)) * 500;
    if (whole(character.ryo) < finishCost)
        return { ok: false, reason: 'not-enough-ryo' };
    const debited = { ...character, ryo: whole(character.ryo) - finishCost };
    return { ok: true, character: applyJutsuLevel(debited, active.jutsuId, active.toLevel), active: null, cost: finishCost, refund: 0 };
}
