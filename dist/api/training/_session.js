"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_TRAINING_RECEIPTS = exports.TRAINING_TOKEN_TTL_SECONDS = void 0;
exports.normalizeActiveTrainingSession = normalizeActiveTrainingSession;
exports.activeTrainingBlocksStart = activeTrainingBlocksStart;
exports.activeTrainingMatches = activeTrainingMatches;
exports.trustedTrainingRewards = trustedTrainingRewards;
const _training_config_js_1 = require("../_training-config.js");
exports.TRAINING_TOKEN_TTL_SECONDS = 25 * 60 * 60;
exports.MAX_TRAINING_RECEIPTS = 256;
function normalizeActiveTrainingSession(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const record = raw;
    const token = typeof record.token === 'string' && /^[A-Za-z0-9]+$/.test(record.token)
        ? record.token
        : '';
    const startedAt = Number(record.startedAt);
    const endsAt = Number(record.endsAt);
    const expiresAt = Number(record.expiresAt);
    if (!token || !Number.isSafeInteger(startedAt) || !Number.isSafeInteger(endsAt) || !Number.isSafeInteger(expiresAt)) {
        return null;
    }
    if (startedAt <= 0 || endsAt <= startedAt || expiresAt <= endsAt)
        return null;
    return { token, startedAt, endsAt, expiresAt };
}
/** Only a live token may keep the single-session lease occupied. */
function activeTrainingBlocksStart(raw, tokenExists, now = Date.now()) {
    const active = normalizeActiveTrainingSession(raw);
    return !!active && tokenExists && active.expiresAt > now;
}
function activeTrainingMatches(raw, token) {
    return normalizeActiveTrainingSession(raw)?.token === token;
}
/**
 * Stat training temporarily uses base rewards only. This function deliberately
 * has no client-input parameters; village and war modifiers can return only
 * after they are derived from trusted server state.
 */
function trustedTrainingRewards(tier) {
    return {
        sealedGain: Math.max(0, Math.round((0, _training_config_js_1.trainingStatGain)(tier, tier.ms, 0))),
        sealedXp: Math.max(0, Math.round(tier.xp)),
    };
}
