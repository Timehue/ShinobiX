"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_TRAINING_RECEIPTS = exports.TRAINING_TOKEN_TTL_SECONDS = void 0;
exports.normalizeActiveTrainingSession = normalizeActiveTrainingSession;
exports.activeTrainingBlocksStart = activeTrainingBlocksStart;
exports.activeTrainingMatches = activeTrainingMatches;
exports.storedTrainingGrant = storedTrainingGrant;
exports.trustedTrainingRewards = trustedTrainingRewards;
const _training_config_js_1 = require("../_training-config.js");
exports.TRAINING_TOKEN_TTL_SECONDS = 25 * 60 * 60;
exports.MAX_TRAINING_RECEIPTS = 256;
const TRAINING_STATS = new Set([
    'strength', 'speed', 'intelligence', 'willpower',
    'ninjutsuOffense', 'ninjutsuDefense', 'taijutsuOffense', 'taijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense', 'bukijutsuOffense', 'bukijutsuDefense',
]);
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
/** A server-owned saved lease remains redeemable even after its cache token ages out. */
function activeTrainingBlocksStart(raw) {
    return normalizeActiveTrainingSession(raw) !== null;
}
function activeTrainingMatches(raw, token) {
    return normalizeActiveTrainingSession(raw)?.token === token;
}
/**
 * Recover the sealed reward from the server-owned save lease when the short-lived
 * KV acceleration token has expired. Generic saves cannot replace activeTraining,
 * so this is the same authority boundary as the original token record.
 */
function storedTrainingGrant(raw, token) {
    const active = normalizeActiveTrainingSession(raw);
    if (!active || active.token !== token || !raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const record = raw;
    const stat = typeof record.stat === 'string' ? record.stat : '';
    const sealedGain = Math.floor(Number(record.statGain));
    const sealedXp = Math.floor(Number(record.xp));
    if (!TRAINING_STATS.has(stat))
        return null;
    if (!Number.isFinite(sealedGain) || sealedGain < 0 || sealedGain > 300)
        return null;
    if (!Number.isFinite(sealedXp) || sealedXp < 0 || sealedXp > 750)
        return null;
    return { stat, startedAt: active.startedAt, endsAt: active.endsAt, sealedGain, sealedXp };
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
